require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { initializeFirebase } = require('./lib/firebase');
const userService = require('./services/userService');
const foodService = require('./services/foodService');
const rewardsService = require('./services/rewardsService');
const foodAnalysisService = require('./services/enhancedFoodAnalysisService');

// Import new advanced services
const ingredientAnalyzer = require('./services/ingredientAnalyzer');
const personalizationEngine = require('./services/personalizationEngine');
const weeklyAnalysisCrew = require('./services/weeklyAnalysisCrew');
const healthRiskDetector = require('./services/healthRiskDetector');
const enhancedFoodAnalysisService = require('./services/enhancedFoodAnalysisService');
const mealPlanningService = require('./services/mealPlanningService');
const exportService = require('./services/exportService');
const webhookService = require('./services/webhookService');
const enhancedFormatter = require('./services/enhancedIngredientFormatter');
const toxinTracker = require('./services/toxinTracker');
const brutalAnalyzer = require('./services/brutalIngredientAnalyzer');
const { parseFoodDescription, formatNutritionResponse } = require('./lib/nutrition');
const cacheService = require('./lib/cacheService');
const { handleSmartProfileSetup } = require('./handlers/smartProfileHandler');
const { parseProfileFromText, getMissingFields, formatIncompleteProfile } = require('./lib/userOnboarding');
const { getTodayIST } = require('./lib/dateHelper');
const { sanitizeForPuchAI } = require('./lib/puch-ai-safe-mode');
const { extractPuchImageData, generateImageResponse, prepareImageForAnalysis } = require('./lib/puch-ai-image-fix');
const puchImageFetcher = require('./services/puchImageFetcher');
// Import simple security module
const {
  validateToken,
  generateToken,
  rateLimiters,
  validateInput,
  securityHeaders,
  corsOptions,
  errorHandler,
  validateEnv,
  validateImage
} = require('./lib/simple-security');

// Validate environment variables before starting
validateEnv();

// Initialize Firebase
initializeFirebase();


const app = express();
const PORT = process.env.PORT || 523;

// Import comprehensive fixes
const { configureApp } = require('./lib/comprehensive-fix');

// Import Puch AI compatibility layer
const {
  puchAICompatibilityMiddleware,
  puchAIErrorHandler,
  formatPuchAIResponse
} = require('./lib/puch-ai-compatibility');

// Configure app with all fixes
configureApp(app);

// ======================================
// SECURITY MIDDLEWARE STACK
// ======================================

// 1. Security headers
app.use(securityHeaders);

// 2. CORS with restrictions
app.use(cors(corsOptions));

// 3. Body parsing with size limits (10MB for images)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 4. Basic input validation
app.use(validateInput);

// 5. General API rate limiting
app.use(rateLimiters.api);

// 6. Puch AI compatibility middleware (after rate limiting)
app.use(puchAICompatibilityMiddleware);

// Disable X-Powered-By header
app.disable('x-powered-by');

// ======================================
// HEALTH & MONITORING ENDPOINTS
// ======================================

// Health check endpoint with basic rate limiting
app.get('/', rateLimiters.api, (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Scanlyf MCP Server',
    version: '2.0.0',
    security: 'standard'
  });
});


// ======================================
// MAIN MCP ENDPOINT
// ======================================

// Add GET handler for Puch AI compatibility
app.get('/mcp', rateLimiters.api, async (req, res) => {
  return res.json({
    status: 'ok',
    message: 'Scanlyf MCP Server Ready',
    version: '2.0.0',
    endpoint: 'https://scanlyf.com/mcp'
  });
});

app.post('/mcp', rateLimiters.api, async (req, res, next) => {
  // Log ALL requests for debugging
  console.log('MCP Request:', {
    method: req.method,
    url: req.url,
    headers: req.headers,
    body: req.body,
    userAgent: req.headers['user-agent']
  });
  
  // Handle empty request for Puch AI compatibility
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.json({
      status: 'ok',
      message: 'Scanlyf MCP Server Ready',
      version: '2.0.0'
    });
  }
  
  const { id, method, params } = req.body;
  
  try {
    // Validate request structure - only method is required for Puch AI
    if (!method) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: id || null,
        error: {
          code: -32600,
          message: 'Invalid Request - method is required'
        }
      });
    }

    // Initialize method - no auth required
    if (method === 'initialize') {
      // Match Puch AI's expected response exactly
      return res.json({
        jsonrpc: '2.0',
        id: id || 0,  // Use 0 to match what Puch AI sends
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'scanlyf-mcp-server',
            version: '2.0.0'
          }
        }
      });
    }
    
    // List tools method - no auth required
    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id: id || 1,  // Default to 1 if no ID provided
        result: {
          tools: getToolsList()
        }
      });
    }
    
    // Handle tool calls with authentication and specific rate limits
    if (method === 'tools/call') {
      const { name, arguments: args = {} } = params;
      
      console.log('Tool call received:', {
        toolName: name,
        args: args,
        hasAuthHeader: !!req.headers.authorization
      });
      
      // Apply operation-specific rate limits
      let rateLimiter = null;
      switch (name) {
        case 'scan_food':
          rateLimiter = rateLimiters.scanFood;
          break;
        case 'get_weekly_analysis':
          rateLimiter = rateLimiters.weeklyAnalysis;
          break;
        // Other operations use general API rate limit
      }
      
      // Apply rate limiter if exists
      if (rateLimiter) {
        await new Promise((resolve, reject) => {
          rateLimiter(req, res, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        // Check if rate limiter already sent response
        if (res.headersSent) return;
      }
      
      // Additional validation for image uploads
      if ((name === 'scan_food' || name === 'add_food') && args.input && args.type === 'image') {
        const validation = validateImage(args.input);
        if (!validation.valid) {
          return res.json({
            jsonrpc: '2.0',
            id: id,
            result: {
              content: [{
                type: 'text',
                text: `Error: ${validation.error}`
              }],
              isError: true
            }
          });
        }
      }
      
      try {
        let result;
        
        // Add logging for debugging
        console.log(`Processing tool: ${name} with args:`, JSON.stringify(args, null, 2));
        
        switch (name) {
          case 'validate':
            result = await handleValidate(args, req);
            break;
            
          case 'commands':
            result = await handleCommands(args, req);
            break;
            
          case 'hello':
            result = await handleHello(args, req);
            break;
            
          case 'setup_profile':
            result = await handleSetupProfile(args, req);
            break;
            
          case 'scan_food':
            result = await handleScanFood(args, req);
            break;
            
          case 'add_food':
            result = await handleAddFood(args, req);
            break;
            
          case 'scan_and_add_food':
            result = await handleScanAndAddFood(args, req);
            break;
            
          case 'get_progress':
            result = await handleGetProgress(args, req);
            break;
            
          case 'list_today_foods':
            result = await handleListTodayFoods(args, req);
            break;
            
          case 'remove_food':
            result = await handleRemoveFood(args, req);
            break;
            
          case 'get_leaderboard':
            result = await handleGetLeaderboard(args, req);
            break;
            
          case 'check_balance':
            result = await handleCheckBalance(args, req);
            break;
            
          case 'view_rewards':
            result = await handleViewRewards(args, req);
            break;
            
          case 'generate_meal_plan':
            result = await handleGenerateMealPlan(args, req);
            break;
            
          case 'get_weekly_analysis':
            result = await handleGetWeeklyAnalysis(args, req);
            break;
            
          case 'get_toxin_summary':
            result = await handleGetToxinSummary(args, req);
            break;
            
          case 'export_data':
            result = await handleExportData(args, req);
            break;
            
          case 'get_personalization':
            result = await handleGetPersonalization(args, req);
            break;
            
          case 'about':
            result = await handleAbout(args, req);
            break;
            
          case 'configure_webhook':
            result = await handleConfigureWebhook(args, req);
            break;
            
          default:
            return res.json({
              jsonrpc: '2.0',
              id: id,
              error: {
                code: -32601,
                message: `Unknown tool: ${name}`
              }
            });
        }
        
        // Format response using Puch AI compatible format
        // Pass response type for better formatting
        const responseType = name === 'scan_food' ? 'scan_food' : 'general';
        
        // Apply content sanitization for Puch AI if enabled
        // Exclude setup_profile from sanitization to avoid false positives
        let sanitizedResult = result;
        if ((process.env.PUCH_AI_SAFE_MODE === 'true' || name === 'get_leaderboard' || name === 'get_weekly_analysis') && name !== 'setup_profile') {
          const { sanitizeForPuchAI } = require('./lib/puch-ai-safe-mode');
          if (typeof result === 'string') {
            sanitizedResult = sanitizeForPuchAI(result);
          }
        }
        
        const puchResponse = formatPuchAIResponse(sanitizedResult, false, responseType);
        
        return res.json({
          jsonrpc: '2.0',
          id: id,
          result: puchResponse
        });
        
      } catch (error) {
        console.error(`Tool execution error for ${name}:`, error.message);
        
        // Log tool errors
        console.error('Tool error:', name, error.message);
        
        // Format error response using Puch AI compatible format
        const errorResponse = formatPuchAIResponse(error.message, true);
        
        return res.json({
          jsonrpc: '2.0',
          id: id,
          result: errorResponse
        });
      }
    }
    
    // Unknown method
    res.json({
      jsonrpc: '2.0',
      id: id,
      error: {
        code: -32601,
        message: 'Method not found'
      }
    });
    
  } catch (error) {
    next(error);
  }
});

// ======================================
// TOOL HANDLER FUNCTIONS
// ======================================

// Import robust token extraction from Puch AI compatibility
const { extractPuchAIToken } = require('./lib/puch-ai-compatibility');

// Helper function to extract token from args or headers
function getTokenFromRequest(args, req) {
  const token = extractPuchAIToken(args, req);
  
  // Debug logging only in development
  if (process.env.NODE_ENV !== 'production') {
    console.log('Token extraction:', {
      argToken: args?.bearer_token,
      hasAuthHeader: !!req?.headers?.authorization,
      extractedToken: token ? 'found' : 'not found'
    });
  }
  
  return token;
}

// Internal function for actual token validation
async function validateAndGetPhone(token) {
  const phone = await validateToken(token);
  if (!phone) {
    throw new Error('Invalid bearer token');
  }
  return phone;
}

// Helper function to get user identifier (puch_user_id or phone from token)
async function getUserIdentifier(args, req) {
  // If puch_user_id is provided, use it directly
  if (args.puch_user_id) {
    console.log('Using puch_user_id:', args.puch_user_id);
    
    // Check if puch_user_id is truncated (ends with ...)
    if (args.puch_user_id.endsWith('...')) {
      console.error('WARNING: puch_user_id appears to be truncated:', args.puch_user_id);
      // Try to use bearer token as fallback
      const token = getTokenFromRequest(args, req);
      if (token) {
        console.log('Falling back to token-based auth due to truncated puch_user_id');
        return await validateAndGetPhone(token);
      }
      throw new Error('Received truncated puch_user_id. Please provide full user ID or valid bearer token.');
    }
    
    return args.puch_user_id;
  }
  
  // Otherwise fall back to token-based authentication
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Authentication required. Please provide puch_user_id or bearer token.');
  }
  
  return await validateAndGetPhone(token);
}

async function handleCommands(args, req) {
  return `📱 SCANLYF COMMANDS REFERENCE

🔐 AUTHENTICATION
• validate - Connect to Scanlyf
• setup_profile - Set up your health profile

🍽️ FOOD TRACKING
• add_food - Log food by text description
• scan_food - Scan food with camera (shows ingredients!)
• list_today_foods - See everything you ate today
• remove_food - Delete a logged item (e.g., remove_food 2)

📊 PROGRESS & INSIGHTS
• get_progress - Check daily nutrition vs targets
• get_weekly_analysis - AI-powered health analysis with 5 experts
• get_toxin_summary - View your toxin tracking & clean streak
• get_personalization - View your eating patterns

🎯 PLANNING & EXPORT
• generate_meal_plan - Get personalized meal suggestions
• export_data - Export nutrition data (CSV/PDF/Excel)

🎮 GAMIFICATION
• get_leaderboard - View community rankings
• check_balance - Check ScanlyfCoins
• view_rewards - See available rewards

🔧 ADVANCED
• configure_webhook - Set up notifications
• commands - Show this help (you're here!)

💡 USAGE TIPS:
• Just type the command name to use it
• For corrections: Use add_food with correct name
• Scan_food shows harmful ingredients in products!

🧪 INGREDIENT ANALYSIS:
When you scan packaged foods, I'll show:
• All ingredients with E-numbers decoded
• Harmful additives highlighted in red
• Health risks based on your conditions
• Better alternatives suggestions

Type any command to get started!`;
}

async function handleValidate(args, req) {
  // Use standardized Puch AI compatible token extraction
  const token = getTokenFromRequest(args, req);
  
  if (!token) {
    // For Puch AI, return default phone number when no token
    return `✅ Connected to Scanlyf!

🤖 AVAILABLE COMMANDS:
• setup_profile - Set up your health profile
• add_food - Log what you ate (text)
• scan_food - Scan food with camera
• list_today_foods - See everything you ate today
• remove_food - Delete logged items
• get_progress - Check daily targets
• get_weekly_analysis - Get AI health insights
• generate_meal_plan - Get meal suggestions
• export_data - Export nutrition data

💡 Start by typing: setup_profile

Phone: ${(process.env.TEST_PHONE || 'Not configured').replace(/^\+/, '')}`;
  }
  
  // Try to validate the token and return the phone number
  try {
    const phone = await validateToken(token);
    if (phone) {
      // Return phone number without + sign
      const cleanPhone = phone.replace(/^\+/, '');
      return `✅ Connected to Scanlyf!

🤖 AVAILABLE COMMANDS:
• setup_profile - Set up your health profile
• add_food - Log what you ate (text)
• scan_food - Scan food with camera
• list_today_foods - See everything you ate today
• remove_food - Delete logged items
• get_progress - Check daily targets
• get_weekly_analysis - Get AI health insights
• generate_meal_plan - Get meal suggestions
• export_data - Export nutrition data

💡 Type any command to get started!

Phone: ${cleanPhone}`;
    }
  } catch (err) {
    // Fall back to fixed phone number for Puch AI compatibility
    console.log('Token validation failed, using default phone:', err.message);
  }
  
  // Default return for Puch AI
  return `✅ Connected to Scanlyf!

🤖 AVAILABLE COMMANDS:
• setup_profile - Set up your health profile
• add_food - Log what you ate (text)
• scan_food - Scan food with camera
• list_today_foods - See everything you ate today
• remove_food - Delete logged items
• get_progress - Check daily targets
• get_weekly_analysis - Get AI health insights
• generate_meal_plan - Get meal suggestions
• export_data - Export nutrition data

💡 Start by typing: setup_profile

Phone: ${(process.env.TEST_PHONE || 'Not configured').replace(/^\+/, '')}`;
}

async function handleHello(args, req) {
  const { name = 'there' } = args;
  
  // Check if user has a profile
  const token = getTokenFromRequest(args, req);
  let hasProfile = false;
  let phone = null;
  
  try {
    if (token) {
      phone = await getUserIdentifier({ bearer_token: token }, req);
      const profile = await userService.getProfile(phone);
      hasProfile = !!profile;
    }
  } catch (e) {
    // Ignore errors, just means no profile
  }
  
  if (!hasProfile) {
    return `Hello ${name}! Welcome to Scanlyf - your AI nutrition assistant! 🍎

I'm here to help you track your nutrition and reach your health goals.

To get started, please tell me about yourself:
- Your name
- Age
- Weight (in kg)
- Height (in cm)
- Gender
- Any health conditions

For example: "My name is Raj, I'm 30 years old, 70 kg, 175 cm tall, male, no health conditions"

Or simply say: "Set up my profile"`;
  } else {
    return `Welcome back ${name}! 👋

Here's what I can help you with today:
📱 "I ate 2 chapati with dal" - Track your meals
📸 "Scan this food" (with image) - Analyze food photos
📊 "Show my progress" - See today's nutrition
📅 "Weekly analysis" - Get AI health insights
🥗 "Create meal plan" - Get personalized meals

What would you like to do?`;
  }
}

async function handleSetupProfile(args, req) {
  const { puch_user_id, bearer_token, text, ...explicitData } = args;
  
  // Special handling for setup_profile with truncated puch_user_id
  let phone;
  try {
    phone = await getUserIdentifier(args, req);
  } catch (error) {
    // If puch_user_id is truncated and no token, generate a unique ID from profile data
    if (puch_user_id && puch_user_id.endsWith('...') && explicitData.name) {
      const crypto = require('crypto');
      // Generate deterministic ID from name + age (or other unique combo)
      const uniqueString = `${explicitData.name}_${explicitData.age || 'unknown'}_${Date.now()}`;
      phone = crypto.createHash('md5').update(uniqueString).digest('hex').substring(0, 12);
      console.log('Generated unique ID for user:', phone, 'from:', uniqueString);
    } else {
      throw error;
    }
  }
  
  let profileData = { ...explicitData };
  
  // If text is provided, parse it for profile information
  if (text && typeof text === 'string') {
    const parsedProfile = parseProfileFromText(text);
    // Merge parsed data with explicit data (explicit data takes precedence)
    profileData = { ...parsedProfile, ...profileData };
  }
  
  // Clean up None/null values from Puch AI
  Object.keys(profileData).forEach(key => {
    if (profileData[key] === null || profileData[key] === undefined || profileData[key] === 'None') {
      delete profileData[key];
    }
  });
  
  // Check if we have at least some basic info
  const hasName = profileData.name && profileData.name.trim().length > 0;
  const hasAnyPhysicalData = profileData.age || profileData.weight_kg || profileData.height_cm;
  
  if (!hasName && !hasAnyPhysicalData) {
    return `👋 Welcome to Scanlyf! Let's set up your profile.

Please tell me about yourself. You can say something like:
• "I'm Raj, 30 years old, 70 kg, 175 cm, male, diabetic"
• "My name is Priya, I'm 25, female, 55 kg, have thyroid"
• "I'm 28 years old, 65 kg, suffer from hypertension"
• "Amit, male, 40 years, no health issues"

💡 You can mention ANY health condition (diabetes, BP, PCOS, allergies, etc.)
📝 We'll use smart defaults for anything you don't mention.`;
  }
  
  // Set smart defaults based on what we have
  if (!profileData.name) {
    profileData.name = 'Friend';
  }
  
  // Gender defaults
  if (!profileData.gender) {
    // Try to guess from name or default
    profileData.gender = 'female'; // Default for safety
  }
  
  // Age defaults based on context
  if (!profileData.age) {
    profileData.age = 30; // Default adult age
  }
  
  // Weight defaults based on gender
  if (!profileData.weight_kg) {
    profileData.weight_kg = profileData.gender === 'male' ? 70 : 55;
  }
  
  // Height defaults based on gender
  if (!profileData.height_cm) {
    profileData.height_cm = profileData.gender === 'male' ? 170 : 160;
  }
  
  // Validate ranges for provided data
  if (profileData.age && (profileData.age < 1 || profileData.age > 120)) {
    profileData.age = 30; // Reset to default if invalid
  }
  if (profileData.height_cm && (profileData.height_cm < 50 || profileData.height_cm > 300)) {
    profileData.height_cm = profileData.gender === 'male' ? 170 : 160;
  }
  if (profileData.weight_kg && (profileData.weight_kg < 10 || profileData.weight_kg > 500)) {
    profileData.weight_kg = profileData.gender === 'male' ? 70 : 55;
  }
  
  // Set defaults for optional fields
  profileData.activity_level = profileData.activity_level || 'moderate';
  profileData.dietary_restrictions = profileData.dietary_restrictions || [];
  profileData.health_goals = profileData.health_goals || ['maintain'];
  profileData.timezone = profileData.timezone || 'Asia/Kolkata';
  
  // Handle health conditions more flexibly
  if (!profileData.health_conditions || profileData.health_conditions.length === 0) {
    profileData.health_conditions = [];
  } else if (profileData.health_conditions.includes('none')) {
    profileData.health_conditions = [];
  }
  
  // Normalize health conditions but allow any condition
  if (profileData.health_conditions && profileData.health_conditions.length > 0) {
    // Normalize condition names to lowercase with underscores
    profileData.health_conditions = profileData.health_conditions.map(condition => {
      if (typeof condition === 'string') {
        return condition.toLowerCase().trim().replace(/\s+/g, '_');
      }
      return condition;
    }).filter(condition => condition && condition !== 'none');
    
    // Remove duplicates
    profileData.health_conditions = [...new Set(profileData.health_conditions)];
  }
  
  // Log the final profile data for debugging
  console.log('Final profile data:', JSON.stringify(profileData, null, 2));
  
  // Create or update profile
  const profile = await userService.createOrUpdateProfile(phone, profileData);
  
  // Check if we used defaults and inform user
  const usedDefaults = [];
  const originalData = { ...explicitData };
  if (!originalData.age && (!text || !text.match(/\d+\s*(?:years?\s*old|yrs?\s*old)/i))) {
    usedDefaults.push(`age (${profile.age})`);
  }
  if (!originalData.weight_kg && (!text || !text.match(/\d+(?:\.\d+)?\s*(?:kg|kilograms?)/i))) {
    usedDefaults.push(`weight (${profile.weight_kg} kg)`);
  }
  if (!originalData.height_cm && (!text || !text.match(/\d+(?:\.\d+)?\s*(?:cm|centimeters?)/i))) {
    usedDefaults.push(`height (${profile.height_cm} cm)`);
  }
  
  let response = `✅ Great ${profile.name}! Your profile is all set up!

Your Daily Nutrition Targets:
• Calories: ${profile.calorie_target}
• Protein: ${profile.protein_target}g
• Carbs: ${profile.carb_target}g
• Fat: ${profile.fat_target}g`;

  // Show health conditions if any
  if (profile.health_conditions && profile.health_conditions.length > 0) {
    response += `\n\n🏥 Health Conditions Noted: ${profile.health_conditions.map(c => c.replace(/_/g, ' ')).join(', ')}`;
  }

  if (usedDefaults.length > 0) {
    response += `\n\n📝 Note: I used default values for: ${usedDefaults.join(', ')}
You can update these anytime by running setup_profile again.`;
  }

  response += `\n\n🤖 COMMANDS TO GET STARTED:
• add_food - Log what you ate (text)
• scan_food - Scan food with camera
• get_progress - Check your daily intake
• get_weekly_analysis - Get AI health insights
• generate_meal_plan - Get meal suggestions

💡 Just type the command name to use it!
🥗 Get meal plans: "Create a meal plan"

What did you have for your last meal?`;

  // Add confirmation that profile was saved
  response += `\n\n✅ Profile saved successfully!`;
  
  // Log for debugging
  console.log(`Profile saved for user: ${phone}, Name: ${profile.name}`);

  return response;
}

async function handleScanFood(args, req) {
  const { puch_user_id, bearer_token, barcode, type } = args;
  
  // IGNORE auto_add - scan_food should NOT auto add
  delete args.auto_add;
  
  // Only process image data if type is 'image'
  let imageResult = { type: 'none' };
  
  if (type === 'image') {
    // Extract image data using the comprehensive Puch AI fix
    imageResult = extractPuchImageData(args);
    
    // Debug logging
    console.log('ScanFood called with image:', {
      imageResult: imageResult,
      allArgs: Object.keys(args)
    });
    
    // Use the new image fetcher service to resolve image data
    const fetchResult = await puchImageFetcher.resolveImage(args, req);
    console.log('Puch image fetch result:', {
      success: fetchResult.success,
      source: fetchResult.source,
      hasFallback: !!fetchResult.fallback
    });
    
    // If we successfully fetched image data, update our imageResult
    if (fetchResult.success) {
      imageResult = {
        type: 'base64',
        data: fetchResult.data,
        source: `puch_fetcher_${fetchResult.source}`
      };
      console.log('Successfully resolved image data via puchImageFetcher');
    }
    
    // Generate appropriate response for missing image scenarios
    const imageResponse = generateImageResponse(imageResult, args);
    
    if ((imageResponse || imageResult.type === 'image_id' || imageResult.type === 'missing') && !fetchResult.success) {
      // Generate user message based on fallback scenario
      const userMessage = puchImageFetcher.generateUserMessage(fetchResult, args);
      
      if (userMessage) {
        // Handle different message types
        if (userMessage.type === 'fallback_with_suggestion') {
          // Continue with text analysis using the suggestion
          console.log('Using fallback food suggestion:', userMessage.suggestion);
          args.type = 'text';
          args.input = userMessage.suggestion;
          imageResult.type = 'text_fallback';
        } else {
          // Return the message to user
          const response = sanitizeForPuchAI(userMessage.message);
          return {
            content: [
              {
                type: 'text',
                text: response
              }
            ]
          };
        }
      }
    }
  } else {
    // For non-image types, just log what we're doing
    console.log('ScanFood called with:', {
      type: type,
      hasBarcode: !!barcode,
      hasInput: !!args.input
    });
  }
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first to scan food.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get user profile for health conditions
  const profile = await userService.getProfile(phone);
  if (!profile) {
    throw new Error('Welcome! I need to know a bit about you first. Please say: "My name is [your name], I\'m [age] years old, [weight] kg, [height] cm tall, [gender], [any health conditions or none]"');
  }
  
  let analysisResult;
  let nutritionData = null;
  let harmfulIngredients = [];
  let context = {
    location: args.location || 'unknown',
    socialContext: args.social_context || 'alone',
    mood: args.mood || 'neutral'
  };
  
  // Prepare image for analysis if we have valid data
  let imageInput = null;
  if (imageResult.type === 'base64' || imageResult.type === 'url') {
    imageInput = prepareImageForAnalysis(imageResult);
  }
  
  // Process based on type
  if (type === 'barcode' || barcode) {
    analysisResult = await enhancedFoodAnalysisService.analyzeFood(barcode, 'barcode', profile);
  } else if (type === 'text' || (args.type === 'text' && args.input)) {
    const textInput = args.input || input;
    if (!textInput || typeof textInput !== 'string' || textInput.length > 500) {
      throw new Error('Please describe what you want to scan. For example: "chapati", "rice and dal", or "masala dosa"');
    }
    analysisResult = await enhancedFoodAnalysisService.analyzeFood(textInput, 'text', profile);
  } else if (type === 'image' || imageInput) {
    if (imageInput) {
      // We have valid image data - analyze it
      console.log('Processing image with length:', imageInput.length);
      analysisResult = await enhancedFoodAnalysisService.analyzeFood(imageInput, 'image', profile);
    } else {
      // This case is already handled by generateImageResponse above
      const response = sanitizeForPuchAI([
        `📸 Please upload an image or describe what you ate.`,
        ``,
        `Example: "1 bowl of bikano bhujia"`,
        `         "2 chapati with dal"`,
        `         "paneer tikka"`
      ].join('\n'));
      
      return {
        content: [
          {
            type: 'text',
            text: response
          }
        ]
      };
    }
  } else {
    throw new Error('Invalid input type');
  }
  
  // Note: Image ID fallback is now handled earlier by generateImageResponse()
  
  // Handle multi-item confirmation flow
  if (analysisResult.needsConfirmation) {
    return analysisResult.confirmationMessage;
  }
  
  if (!analysisResult.success) {
    // Check if this is our image ID fallback without suggestion
    if (analysisResult.message) {
      return analysisResult.message;
    }
    throw new Error(`Failed to analyze food: ${analysisResult.error}`);
  }
  
  nutritionData = analysisResult.nutrition || analysisResult.nutritionData;
  
  // Validate nutrition data ranges
  if (nutritionData.calories < 0 || nutritionData.calories > 9999) {
    console.warn('Suspicious nutrition data:', {
      userId: phone,
      data: nutritionData
    });
    throw new Error('Invalid nutrition data detected');
  }
  
  // HEALTH RISK DETECTION (without adding to log)
  const riskAnalysis = await healthRiskDetector.detectRisks(nutritionData, profile, context);
  
  // Generate scan ID early for quick-add feature
  const scanId = `scan_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // INGREDIENT ANALYSIS
  let ingredientReport = '';
  let useBrutalAnalyzer = false;
  
  if (nutritionData.ingredients) {
    const ingredientAnalysis = await ingredientAnalyzer.analyzeIngredients(
      nutritionData.ingredients,
      profile
    );
    
    // Store harmful ingredients in nutritionData for brutal analyzer
    if (ingredientAnalysis.harmfulIngredients && ingredientAnalysis.harmfulIngredients.length > 0) {
      nutritionData.harmfulIngredients = ingredientAnalysis.harmfulIngredients;
      nutritionData.processingLevel = ingredientAnalysis.processingLevel;
      nutritionData.healthScore = ingredientAnalysis.healthScore;
      useBrutalAnalyzer = true;
    }
  }
  
  // Check if we should use brutal analyzer for text inputs with known processed foods
  if (!useBrutalAnalyzer && type === 'text' && nutritionData.harmfulIngredients && nutritionData.harmfulIngredients.length > 0) {
    useBrutalAnalyzer = true;
  }
  
  // If harmful ingredients found, use BRUTAL ANALYZER
  if (useBrutalAnalyzer && nutritionData.harmfulIngredients && nutritionData.harmfulIngredients.length > 0) {
    // Store scan data for quick-add before returning
    await cacheService.set(`scan:${scanId}`, {
      nutritionData,
      analysisResult,
      context,
      phone,
      timestamp: new Date().toISOString()
    }, 300); // 5 minute expiry
    
    const brutalReport = await brutalAnalyzer.analyzeFoodWithBrutalHonesty({
      name: nutritionData.name,
      harmfulIngredients: nutritionData.harmfulIngredients,
      processingLevel: nutritionData.processingLevel || 'processed'
    }, profile);
    
    // Sanitize brutal report for Puch AI to avoid content filter issues
    const sanitizedReport = sanitizeForPuchAI(brutalReport);
    
    // Create final report
    const fullReport = sanitizedReport + `\n\n📝 Ready to log this food?
⚠️ WARNING: Multiple harmful ingredients detected!

To add to your daily log:
Use the add_food tool with parameter: {"quick_add": "${scanId}"}

💡 Quick-add expires in 5 minutes
🔄 Or scan again to update analysis`;
    
    return {
      content: [{
        type: "text",
        text: fullReport
      }],
      isError: false
    };
  }
  
  // Analyze food based on health conditions
  const healthAnalysis = await enhancedFoodAnalysisService.analyzeForHealth(
    nutritionData, 
    profile.health_conditions
  );
  
  // Format enhanced response that helps Puch AI understand this is for logging
  let response = `🍽️ FOOD DETECTED: ${nutritionData.name}\n\n`;
  
  // Add detected items if from image
  if (type === 'image' && analysisResult.detectedFoods && analysisResult.detectedFoods.length > 0) {
    const actualFoods = analysisResult.detectedFoods
      .filter(food => !['cuisine', 'food', 'ingredient', 'breakfast', 'staple'].some(cat => 
        food.name.toLowerCase().includes(cat)
      ))
      .slice(0, 3);
    
    if (actualFoods.length > 0) {
      response += `📷 What I see in your image:\n`;
      actualFoods.forEach(food => {
        response += `• ${food.name}\n`;
      });
      response += `\n`;
    }
  }
  
  // Nutrition info
  response += `📊 NUTRITION (per ${nutritionData.portion_size || 'serving'}):\n`;
  response += `• Calories: ${nutritionData.calories}\n`;
  response += `• Protein: ${nutritionData.protein}g\n`;
  response += `• Carbs: ${nutritionData.carbs}g\n`;
  response += `• Fat: ${nutritionData.fat}g\n`;
  if (nutritionData.fiber) response += `• Fiber: ${nutritionData.fiber}g\n`;
  if (nutritionData.sugar) response += `• Sugar: ${nutritionData.sugar}g\n`;
  if (nutritionData.sodium) response += `• Sodium: ${nutritionData.sodium}mg\n`;
  
  // Health recommendation
  response += `\n${healthAnalysis.overallRecommendation}\n`;
  
  // Risk alerts
  if (riskAnalysis.hasRisks) {
    response += `\n⚠️ HEALTH ALERTS:\n`;
    riskAnalysis.risks.slice(0, 3).forEach(risk => {
      response += `• ${risk.message}\n`;
    });
  }
  
  // Ingredient report
  response += ingredientReport;
  
  // Pros and cons
  if (healthAnalysis.pros.length > 0) {
    response += `\n✅ PROS:\n`;
    healthAnalysis.pros.forEach(pro => response += `• ${pro}\n`);
  }
  
  if (healthAnalysis.cons.length > 0) {
    response += `\n❌ CONS:\n`;
    healthAnalysis.cons.forEach(con => response += `• ${con}\n`);
  }
  
  // Personalized message
  const personalizedMessage = await personalizationEngine.getPersonalizedFoodResponse(
    profile,
    nutritionData,
    context
  );
  response += `\n\n${personalizedMessage}`;
  
  // If from barcode, add extra details
  if (barcode && analysisResult.productDetails) {
    response += `\n\n📦 PRODUCT DETAILS:\n`;
    if (analysisResult.nutrition.brand) {
      response += `Brand: ${analysisResult.nutrition.brand}\n`;
    }
    if (analysisResult.nutrition.nutriscore) {
      response += `Nutri-Score: ${analysisResult.nutrition.nutriscore.toUpperCase()}\n`;
    }
    if (analysisResult.productDetails.labels) {
      response += `Labels: ${analysisResult.productDetails.labels}\n`;
    }
  }
  
  // Store scan data temporarily for quick-add feature (scanId already generated above)
  await cacheService.set(`scan:${scanId}`, {
    nutritionData,
    analysisResult,
    context,
    phone,
    timestamp: new Date().toISOString()
  }, 300); // 5 minute expiry
  
  // Add quick-add option at the end
  response += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📝 TO LOG THIS FOOD:\n\n`;
  
  if (riskAnalysis.criticalRisks.length > 0) {
    response += `⚠️ CRITICAL HEALTH RISK - We advise against consuming this.\n\n`;
  } else if (riskAnalysis.hasRisks) {
    response += `⚠️ Note: Some health concerns detected (see above)\n\n`;
  }
  
  response += `Is "${nutritionData.name}" correct?\n\n`;
  response += `✅ CONFIRM by saying:\n`;
  response += `• "Yes" or "Correct" - I'll add it to your log\n`;
  response += `• "Yes it's masala dosa" - Confirms the food\n`;
  response += `• "Add this" or "Log this" - Adds to your daily intake\n`;
  response += `\n❌ CHANGE by saying:\n`;
  response += `• "No, it's [actual food]" - I'll scan the correct item\n`;
  response += `• "It's actually [food name]" - Updates to right food\n`;
  
  response += `\n💡 IMPORTANT: When you confirm, I will:\n`;
  response += `• Add ${nutritionData.calories} calories to your daily total\n`;
  response += `• Track all nutrients toward your goals\n`;
  response += `• Update your daily progress\n`;
  
  response += `\n🎯 Quick-add: To log this food later, use add_food with {"quick_add": "${scanId}"}\n`;
  response += `⏱️ Quick-add expires in 5 minutes`;
  
  return response;
}

// New combined function for scan and add
async function handleScanAndAddFood(args, req) {
  const { puch_user_id, bearer_token, type, auto_add = true, food_name } = args;
  
  // Extract image data using the comprehensive Puch AI fix
  let imageResult = extractPuchImageData(args);
  
  console.log('ScanAndAddFood called with:', {
    type,
    imageResult,
    foodName: food_name,
    autoAdd: auto_add
  });
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get user profile
  const profile = await userService.getProfile(phone);
  if (!profile) {
    throw new Error('Welcome! Please set up your profile first.');
  }
  
  let foodToAnalyze;
  let analysisResult;
  
  // Use the new image fetcher service to resolve image data
  const fetchResult = await puchImageFetcher.resolveImage(args, req);
  console.log('Puch image fetch result for scan_and_add:', {
    success: fetchResult.success,
    source: fetchResult.source,
    hasFallback: !!fetchResult.fallback
  });
  
  // If we successfully fetched image data, update our imageResult
  if (fetchResult.success) {
    imageResult = {
      type: 'base64',
      data: fetchResult.data,
      source: `puch_fetcher_${fetchResult.source}`
    };
    console.log('Successfully resolved image data via puchImageFetcher');
    // Analyze the fetched image
    analysisResult = await enhancedFoodAnalysisService.analyzeFood(fetchResult.data, 'image', profile);
  } else if (!fetchResult.success) {
    // Generate user message based on fallback scenario
    const userMessage = puchImageFetcher.generateUserMessage(fetchResult, args);
    
    if (userMessage) {
      // Handle different message types
      if (userMessage.type === 'fallback_with_suggestion' || food_name) {
        // Use the suggestion or food_name for text analysis
        const foodText = userMessage.suggestion || food_name;
        console.log('Using fallback food text:', foodText);
        analysisResult = await enhancedFoodAnalysisService.analyzeFood(foodText, 'text', profile);
      } else {
        // Return the message to user
        const response = sanitizeForPuchAI(userMessage.message);
        return {
          content: [
            {
              type: 'text',
              text: response
            }
          ]
        };
      }
    }
  }
  
  // If we don't have an analysis result yet, analyze based on type
  if (!analysisResult) {
    if (food_name) {
      // If food_name is provided (Puch AI detected it), use that
      console.log('Using provided food_name:', food_name);
      analysisResult = await enhancedFoodAnalysisService.analyzeFood(food_name, 'text', profile);
    } else if (type === 'image' && imageResult.type === 'base64') {
      // Prepare image for analysis
      const imageInput = prepareImageForAnalysis(imageResult);
      if (imageInput) {
        analysisResult = await enhancedFoodAnalysisService.analyzeFood(imageInput, 'image', profile);
      } else {
        throw new Error('No valid image data');
      }
    } else if (type === 'text') {
      const textInput = args.input;
      if (!textInput) {
        throw new Error('Please provide food description');
      }
      analysisResult = await enhancedFoodAnalysisService.analyzeFood(textInput, 'text', profile);
    }
  }
  
  if (!analysisResult.success) {
    throw new Error(`Failed to analyze food: ${analysisResult.error || 'Unknown error'}`);
  }
  
  const nutritionData = analysisResult.nutrition || analysisResult.nutritionData;
  
  // Check if we have nutrition data
  if (!nutritionData) {
    throw new Error('No nutrition data found in analysis result');
  }
  
  // ALWAYS add to daily log if auto_add is true (default)
  if (auto_add) {
    // Add emoji to nutrition data
    nutritionData.emoji = '🍽️';
    
    const result = await foodService.addFood(phone, nutritionData, type);
    
    // Check if we need to use brutal analyzer for harmful ingredients
    if (nutritionData.harmfulIngredients && nutritionData.harmfulIngredients.length > 0) {
      // Use brutal analyzer for harmful foods
      const brutalReport = await brutalAnalyzer.analyzeFoodWithBrutalHonesty({
        name: nutritionData.name,
        harmfulIngredients: nutritionData.harmfulIngredients,
        processingLevel: nutritionData.processingLevel || 'processed'
      }, profile);
      
      // Sanitize for Puch AI
      const sanitizedReport = sanitizeForPuchAI(brutalReport);
      
      // Add logged successfully message
      const loggedMessage = `\n\n✅ LOGGED SUCCESSFULLY!\n📈 Today's Progress:\n• Consumed: ${result.dailyTotals.calories} calories\n• Target: ${profile.calorie_target} calories\n• Remaining: ${Math.max(0, profile.calorie_target - result.dailyTotals.calories)} calories`;
      
      return sanitizedReport + loggedMessage;
    } else {
      // Normal response for clean foods
      let response = formatNutritionResponse(
        nutritionData,
        result.dailyTotals,
        {
          calories: profile.calorie_target,
          protein: profile.protein_target,
          carbs: profile.carb_target,
          fat: profile.fat_target
        }
      );
      
      // Add health analysis if available
      if (analysisResult.healthAnalysis) {
        response += '\n\n' + analysisResult.healthAnalysis;
      }
      
      return response;
    }
  } else {
    // Just return analysis without logging
    // Include ingredient analysis if available
    if (nutritionData.ingredients && !analysisResult.ingredientAnalysis) {
      const ingredientAnalysis = await ingredientAnalyzer.analyzeIngredients(
        nutritionData.ingredients,
        profile
      );
      analysisResult.ingredientAnalysis = ingredientAnalysis;
      
      // Add harmful ingredients to nutrition data
      if (ingredientAnalysis.harmfulIngredients) {
        nutritionData.harmfulIngredients = ingredientAnalysis.harmfulIngredients;
        nutritionData.processingLevel = ingredientAnalysis.processingLevel;
        nutritionData.healthScore = ingredientAnalysis.healthScore;
      }
    }
    return await formatScanOnlyResponse(nutritionData, analysisResult, phone);
  }
}

async function handleAddFood(args, req) {
  const { puch_user_id, bearer_token, type, barcode, confirm_analysis_id, user_corrections, quick_add } = args;
  
  // Extract image data using the comprehensive Puch AI fix
  let imageResult = extractPuchImageData(args);
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first to add food.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get user profile for personalization
  const profile = await userService.getProfile(phone);
  if (!profile) {
    throw new Error('Welcome! I need to know a bit about you first. Please say: "My name is [your name], I\'m [age] years old, [weight] kg, [height] cm tall, [gender], [any health conditions or none]"');
  }
  
  // Use the new image fetcher service for image inputs
  if (type === 'image') {
    const fetchResult = await puchImageFetcher.resolveImage(args, req);
    console.log('Puch image fetch result for add_food:', {
      success: fetchResult.success,
      source: fetchResult.source
    });
    
    if (fetchResult.success) {
      imageResult = {
        type: 'base64',
        data: fetchResult.data,
        source: `puch_fetcher_${fetchResult.source}`
      };
    } else {
      // Generate user message for missing image
      const userMessage = puchImageFetcher.generateUserMessage(fetchResult, args);
      
      if (userMessage) {
        if (userMessage.type === 'fallback_with_suggestion') {
          // Continue with text analysis
          console.log('Using fallback food suggestion:', userMessage.suggestion);
          args.type = 'text';
          args.input = userMessage.suggestion;
        } else {
          // Return the message to user
          const response = sanitizeForPuchAI(userMessage.message);
          return {
            content: [
              {
                type: 'text',
                text: response
              }
            ]
          };
        }
      }
    }
  }
  
  let analysisResult;
  let context = {
    location: args.location || 'unknown',
    socialContext: args.social_context || 'alone',
    mood: args.mood || 'neutral',
    lastMealTime: await foodService.getLastMealTime(phone),
    mealGap: await foodService.getMealGap(phone)
  };
  
  // Handle quick-add from previous scan
  if (quick_add) {
    const scanData = await cacheService.get(`scan:${quick_add}`);
    
    if (!scanData) {
      throw new Error('Quick-add link expired or invalid. Please scan the food again.');
    }
    
    // Verify the scan belongs to this user
    if (scanData.phone !== phone) {
      throw new Error('This quick-add link is not valid for your account.');
    }
    
    // Use the cached scan data
    analysisResult = scanData.analysisResult;
    context = { ...context, ...scanData.context };
    
    // Clear the cache to prevent reuse
    await cacheService.delete(`scan:${quick_add}`);
  }
  
  // Only analyze if not using quick-add
  if (!quick_add) {
    // Handle barcode scanning
    if (barcode) {
      analysisResult = await enhancedFoodAnalysisService.analyzeFood(barcode, 'barcode', profile);
    }
    // Handle user confirmation for multi-item detection
    else if (confirm_analysis_id && user_corrections) {
      analysisResult = await enhancedFoodAnalysisService.processUserConfirmation(
        confirm_analysis_id,
        user_corrections,
        profile
      );
    }
    // Use enhanced analysis service for better detection
    else if (type === 'text') {
      const textInput = args.input;
      if (!textInput || typeof textInput !== 'string') {
        throw new Error('Please tell me what you ate. For example: \"2 chapati with dal\" or \"1 bowl of rice\"');
      }
      if (textInput.length > 500) {
        throw new Error('Please keep your food description brief (under 500 characters)');
      }
      analysisResult = await enhancedFoodAnalysisService.analyzeFood(textInput, 'text', profile);
    } else if (type === 'image') {
      // Prepare image for analysis
      const imageInput = prepareImageForAnalysis(imageResult);
      if (imageInput) {
        analysisResult = await enhancedFoodAnalysisService.analyzeFood(imageInput, 'image', profile);
      } else {
        // Should not reach here as it's handled by generateImageResponse
        throw new Error('No valid image data received');
      }
    } else {
      // Check if user is trying to use quick_add incorrectly
      if (args.input && args.input.startsWith('scan_')) {
        throw new Error('To use quick-add, pass the scan ID in the "quick_add" parameter, not as input. Example: {"quick_add": "' + args.input + '"}');
      }
      throw new Error('Invalid input type. Valid types are: text, image, or barcode. For quick-add, use the "quick_add" parameter with your scan ID.');
    }
  }
  
  // Handle multi-item confirmation flow
  if (analysisResult.needsConfirmation) {
    return analysisResult.confirmationMessage;
  }
  
  if (!analysisResult.success) {
    throw new Error(`Failed to analyze food: ${analysisResult.error}`);
  }
  
  const nutritionData = analysisResult.nutrition || analysisResult.nutritionData;
  
  // Check if we have nutrition data
  if (!nutritionData) {
    throw new Error('No nutrition data found in analysis result');
  }
  
  // HEALTH RISK DETECTION
  const riskAnalysis = await healthRiskDetector.detectRisks(nutritionData, profile, context);
  
  // If critical risks detected, prevent logging
  if (riskAnalysis.criticalRisks.length > 0) {
    const criticalRisk = riskAnalysis.criticalRisks[0];
    console.warn('Critical health risk prevented:', {
      userId: phone,
      food: nutritionData.name,
      risk: criticalRisk
    });
    
    let riskResponse = `${riskAnalysis.recommendation.message}\n\n`;
    riskResponse += `${criticalRisk.message}\n`;
    riskResponse += `Action: ${criticalRisk.action}`;
    
    // Still provide alternatives
    if (nutritionData.ingredients) {
      const alternatives = await ingredientAnalyzer.suggestBetterAlternatives(nutritionData.name);
      if (alternatives.length > 0) {
        riskResponse += `\n\n💚 Try instead:\n`;
        alternatives.slice(0, 3).forEach(alt => {
          riskResponse += `• ${alt.name}: ${alt.whyBetter}\n`;
        });
      }
    }
    
    return riskResponse;
  }
  
  // Check daily limits
  const dailyTotal = await foodService.getDailyCalories(phone);
  if (dailyTotal + nutritionData.calories > 15000) {
    console.warn('Excessive calories detected:', {
      userId: phone,
      attempted: nutritionData.calories,
      dailyTotal
    });
    throw new Error('Daily calorie limit exceeded');
  }
  
  // INGREDIENT ANALYSIS for processed foods
  let ingredientWarning = '';
  if (nutritionData.ingredients) {
    const ingredientAnalysis = await ingredientAnalyzer.analyzeIngredients(
      nutritionData.ingredients,
      profile
    );
    
    if (ingredientAnalysis.harmfulIngredients.length > 0) {
      const shockMessage = ingredientAnalyzer.generateShockMessage(ingredientAnalysis);
      ingredientWarning = `\n\n${shockMessage}\n`;
      
      // Show top harmful ingredients
      ingredientAnalysis.harmfulIngredients.slice(0, 2).forEach(harmful => {
        ingredientWarning += `\n${harmful.whyBad}\n`;
      });
      
      // Add personalized warnings
      if (ingredientAnalysis.personalizedWarnings.length > 0) {
        ingredientWarning += `\n${ingredientAnalysis.personalizedWarnings[0].message}\n`;
        ingredientWarning += `Action: ${ingredientAnalysis.personalizedWarnings[0].action}`;
      }
    }
  }
  
  // Add emoji to nutrition data (only if nutritionData exists)
  if (nutritionData) {
    nutritionData.emoji = '🍽️';
  }
  
  // Add to daily log
  const result = await foodService.addFood(phone, nutritionData, type);
  
  // PERSONALIZED RESPONSE
  const personalizedResponse = await personalizationEngine.getPersonalizedFoodResponse(
    profile,
    nutritionData,
    context
  );
  
  // Format base response
  let response = formatNutritionResponse(
    nutritionData,
    result.dailyTotals,
    {
      calories: profile.calorie_target,
      protein: profile.protein_target,
      carbs: profile.carb_target,
      fat: profile.fat_target
    }
  );
  
  // Add risk warnings if any
  if (riskAnalysis.hasRisks && riskAnalysis.risks.length > 0) {
    response += '\n\n⚠️ HEALTH ALERTS:';
    riskAnalysis.risks.slice(0, 3).forEach(risk => {
      response += `\n• ${risk.message}`;
    });
  }
  
  // Add ingredient warnings
  response += ingredientWarning;
  
  // Add comprehensive analysis section
  response += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `🔍 NUTRITIONAL ANALYSIS:\n\n`;
  
  // Add macronutrient analysis
  const proteinPercent = Math.round((nutritionData.protein * 4 / nutritionData.calories) * 100) || 0;
  const carbPercent = Math.round((nutritionData.carbs * 4 / nutritionData.calories) * 100) || 0;
  const fatPercent = Math.round((nutritionData.fat * 9 / nutritionData.calories) * 100) || 0;
  
  response += `📊 Macro Breakdown:\n`;
  response += `• Protein: ${proteinPercent}% (${nutritionData.protein}g)\n`;
  response += `• Carbs: ${carbPercent}% (${nutritionData.carbs}g)\n`;
  response += `• Fat: ${fatPercent}% (${nutritionData.fat}g)\n`;
  
  // Add meal quality assessment
  response += `\n💪 Meal Quality:\n`;
  if (nutritionData.protein >= 20) {
    response += `• ✅ Good protein content\n`;
  } else {
    response += `• ⚠️ Low protein - consider adding chicken, paneer, or dal\n`;
  }
  
  if (nutritionData.fiber && nutritionData.fiber >= 5) {
    response += `• ✅ Good fiber content\n`;
  } else {
    response += `• ⚠️ Low fiber - add vegetables or whole grains\n`;
  }
  
  // Add personalized insights
  response += `\n${personalizedResponse}`;
  
  // If detected from image, add detection info
  if (type === 'image' && nutritionData.detectedFoods) {
    const detectedNames = nutritionData.detectedFoods.slice(0, 3).map(food => 
      typeof food === 'string' ? food : food.name
    );
    response += `\n\n📷 Detected: ${detectedNames.join(', ')}`;
  }
  
  // If from barcode, add product details
  if (barcode && analysisResult.productDetails) {
    response += `\n\n📊 Product Info:`;
    if (analysisResult.nutrition.brand) {
      response += `\nBrand: ${analysisResult.nutrition.brand}`;
    }
    if (analysisResult.nutrition.nutriscore) {
      response += `\nNutri-Score: ${analysisResult.nutrition.nutriscore.toUpperCase()}`;
    }
  }
  
  // Trigger background analysis if needed
  const behaviorPatterns = await personalizationEngine.analyzeBehaviorPatterns(phone);
  if (behaviorPatterns.triggerTimes.includes(new Date().getHours())) {
    webhookService.sendWebhook(phone, 'trigger_time_eating', {
      food: nutritionData.name,
      pattern: 'high_risk_time'
    });
  }
  
  // Add acknowledgment for quick-add
  if (quick_add) {
    response = `✅ Added from your previous scan\n\n` + response;
  }
  
  // Add clear completion message
  response += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `✅ Food logged and analyzed!\n`;
  response += `📝 No need to analyze again - full analysis included above.\n`;
  response += `💡 Next: Add your next meal or say "show my progress"`;
  
  // Return the response as is - the Puch AI compatibility layer will handle formatting
  return response;
}

async function handleListTodayFoods(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get today's foods
  const progress = await foodService.getDailyProgress(phone);
  
  if (!progress.foods || progress.foods.length === 0) {
    return "📝 No foods logged today yet.\n\n💡 Start tracking by saying 'I ate...' or uploading a food photo!";
  }
  
  let response = `🍽️ TODAY'S FOOD LOG (${progress.date})\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  
  let totalCalories = 0;
  let totalProtein = 0;
  let totalCarbs = 0;
  let totalFat = 0;
  
  progress.foods.forEach((food, idx) => {
    response += `${idx + 1}. ${food.emoji || '🍽️'} ${food.name}\n`;
    response += `   📊 ${food.calories} cal | ${food.protein}g protein | ${food.carbs}g carbs | ${food.fat}g fat\n`;
    if (food.portion_size) {
      response += `   📏 Portion: ${food.portion_size}\n`;
    }
    if (food.timestamp) {
      const time = new Date(food.timestamp).toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      });
      response += `   🕐 Added at: ${time}\n`;
    }
    response += `   🗑️ To remove: /remove_food ${idx + 1}\n\n`;
    
    totalCalories += food.calories || 0;
    totalProtein += food.protein || 0;
    totalCarbs += food.carbs || 0;
    totalFat += food.fat || 0;
  });
  
  response += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📈 DAILY TOTALS:\n`;
  response += `• Calories: ${totalCalories}\n`;
  response += `• Protein: ${totalProtein}g\n`;
  response += `• Carbs: ${totalCarbs}g\n`;
  response += `• Fat: ${totalFat}g\n\n`;
  
  response += `\n📱 Next steps:\n`;
  response += `• Remove an item by saying "delete item 1" or "remove the first food"\n`;
  response += `• Track more meals throughout the day\n`;
  response += `• Check your progress against daily targets\n`;
  response += `• Get personalized weekly health insights\n\n`;
  response += `💡 Need to remove something? Just mention which item number!`;
  
  return response;
}

async function handleRemoveFood(args, req) {
  const { puch_user_id, bearer_token, food_index, food_name } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get current foods
  const progress = await foodService.getDailyProgress(phone);
  
  if (!progress.foods || progress.foods.length === 0) {
    return "No foods logged today to remove.";
  }
  
  let indexToRemove = -1;
  
  // If food_index is provided, use it (1-based from user)
  if (food_index) {
    indexToRemove = parseInt(food_index) - 1;
  } 
  // If food_name is provided, find it
  else if (food_name) {
    indexToRemove = progress.foods.findIndex(f => 
      f.name.toLowerCase().includes(food_name.toLowerCase())
    );
    if (indexToRemove === -1) {
      return `Could not find "${food_name}" in today's log. Use /list_today_foods to see all items.`;
    }
  } else {
    return "Please specify which food to remove. You can say:\n• 'Remove food 1' (using the number from the list)\n• 'Remove paneer tikka' (using the food name)";
  }
  
  // Validate index
  if (indexToRemove < 0 || indexToRemove >= progress.foods.length) {
    return `Invalid food number. You have ${progress.foods.length} items logged today. Use a number between 1 and ${progress.foods.length}.`;
  }
  
  // Get the food to remove
  const foodToRemove = progress.foods[indexToRemove];
  
  // Remove from the array
  progress.foods.splice(indexToRemove, 1);
  
  // Recalculate totals
  const newTotals = {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0
  };
  
  progress.foods.forEach(food => {
    newTotals.calories += food.calories || 0;
    newTotals.protein += food.protein || 0;
    newTotals.carbs += food.carbs || 0;
    newTotals.fat += food.fat || 0;
  });
  
  progress.totals = newTotals;
  
  // Update in database
  const db = getDb();
  const targetDate = getTodayIST();
  const docId = `${phone}_${targetDate}`;
  
  await db.collection('daily_logs').doc(docId).set(progress);
  
  // Get user profile for targets
  const profile = await userService.getProfile(phone);
  
  let response = `🗑️ REMOVED: ${foodToRemove.name}\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `This meal had: ${foodToRemove.calories} cal | ${foodToRemove.protein}g protein\n\n`;
  
  response += `📊 UPDATED DAILY TOTALS:\n`;
  response += `• Consumed: ${newTotals.calories} calories\n`;
  response += `• Target: ${profile.calorie_target} calories\n`;
  response += `• Remaining: ${Math.max(0, profile.calorie_target - newTotals.calories)} calories\n\n`;
  
  if (progress.foods.length === 0) {
    response += `📝 Your food log is now empty for today.`;
  } else {
    response += `📝 You have ${progress.foods.length} item${progress.foods.length > 1 ? 's' : ''} remaining in today's log.`;
  }
  
  response += `\n\n🤖 COMMANDS YOU CAN USE:\n`;
  response += `• add_food - Add more food\n`;
  response += `• scan_food - Scan food with camera\n`;
  response += `• list_today_foods - See what you ate today\n`;
  response += `• get_progress - Check your daily targets`;
  
  return response;
}

async function handleGetProgress(args, req) {
  const { puch_user_id, bearer_token, date } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first to view progress.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Validate date format if provided
  if (date && !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }
  
  // Prevent future date queries
  if (date && new Date(date) > new Date()) {
    throw new Error('Cannot query future dates');
  }
  
  // Get daily progress
  const progress = await foodService.getDailyProgress(phone, date);
  
  // Get user targets
  const profile = await userService.getProfile(phone);
  
  if (!profile) {
    throw new Error('Welcome! I need to know a bit about you first. Please say: "My name is [your name], I\'m [age] years old, [weight] kg, [height] cm tall, [gender], [any health conditions or none]"');
  }
  
  return formatProgressResponse(progress, profile);
}

async function handleGetLeaderboard(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get leaderboard
  const leaderboard = await rewardsService.getWeeklyLeaderboard();
  
  // Get user's weekly progress with daily breakdown
  const userProgress = await rewardsService.calculateWeeklyProgress(phone);
  
  // Format response
  const message = rewardsService.formatLeaderboardMessage(leaderboard, phone);
  
  // Add daily breakdown
  let dailyBreakdown = '\n\n📊 YOUR WEEKLY PROGRESS:\n';
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Use IST for correct day calculation
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayIST = new Date(now.getTime() + istOffset);
  const todayDayOfWeek = todayIST.getDay();
  const adjustedToday = todayDayOfWeek === 0 ? 6 : todayDayOfWeek - 1; // Convert Sunday (0) to 6, shift others
  
  userProgress.dailyScores.forEach((score, index) => {
    const dayName = days[index];
    if (index < adjustedToday) {
      // Past days
      const emoji = score > 0 ? (score >= 80 ? '✅' : score >= 50 ? '🟨' : '🟥') : '❌';
      dailyBreakdown += `${emoji} ${dayName}: ${score}%\n`;
    } else if (index === adjustedToday) {
      // Today
      const emoji = score > 0 ? '🔄' : '⏳';
      dailyBreakdown += `${emoji} ${dayName} (Today): ${score}%\n`;
    } else {
      // Future days
      dailyBreakdown += `⬜ ${dayName}: --\n`;
    }
  });
  
  dailyBreakdown += `\n📈 Weekly Average: ${userProgress.average}%`;
  dailyBreakdown += `\n📅 Days Tracked: ${userProgress.daysTracked}/7`;
  
  return message + dailyBreakdown;
}

async function handleCheckBalance(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get balance
  const balanceData = await rewardsService.getBalance(phone);
  
  let response = `💰 ScanlyfCoin Balance: ${balanceData.balance} coins\n\n`;
  
  if (balanceData.transactions && balanceData.transactions.length > 0) {
    response += `Recent Transactions:\n`;
    balanceData.transactions.slice(-5).forEach(tx => {
      const sign = tx.amount > 0 ? '+' : '';
      response += `• ${sign}${tx.amount} - ${tx.reason}\n`;
    });
  }
  
  return response;
}

async function handleViewRewards(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get user balance
  const balanceData = await rewardsService.getBalance(phone);
  
  // Format rewards catalog
  let message = `🛍️ SCANLYFCOINS REWARDS STORE\n\n💰 Your Balance: ${balanceData.balance} coins\n\n`;
  
  message += `🎬 AVAILABLE REWARD:\n\n`;
  
  rewardsService.REWARDS_CATALOG.forEach((reward, index) => {
    const affordable = balanceData.balance >= reward.cost ? '✅ Available' : `❌ Need ${reward.cost - balanceData.balance} more coins`;
    message += `${reward.name}\n`;
    message += `💎 Cost: ${reward.cost} coins\n`;
    message += `Status: ${affordable}\n\n`;
  });
  
  message += `📈 HOW TO EARN COINS:\n`;
  message += `• Log meals daily: 10 coins\n`;
  message += `• Complete weekly goals: 50 coins\n`;
  message += `• Win leaderboard: 100 coins\n\n`;
  
  if (balanceData.balance >= 500) {
    message += `🎉 You can redeem Netflix Premium now!\n`;
    message += `Contact support to claim your reward.`;
  } else {
    message += `Keep tracking to earn more coins!`;
  }
  
  return message;
}

async function handleGenerateMealPlan(args, req) {
  const { puch_user_id, bearer_token, duration_days = 7, meal_count = 3, include_snacks = true, exclude_ingredients = [] } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Generate meal plan
  const mealPlan = await mealPlanningService.generateMealPlan(phone, {
    duration: duration_days,
    mealCount: meal_count,
    includeSnacks: include_snacks,
    excludeIngredients: exclude_ingredients
  });
  
  // Format response
  let response = `🍱 PERSONALIZED MEAL PLAN\n\n`;
  response += `Duration: ${duration_days} days\n`;
  response += `Meals per day: ${meal_count}${include_snacks ? ' + snacks' : ''}\n\n`;
  
  // Show first 3 days
  mealPlan.days.slice(0, 3).forEach(day => {
    response += `📅 ${day.date}\n`;
    day.meals.forEach(meal => {
      response += `• ${meal.type}: ${meal.name}\n`;
      response += `  ${meal.nutrition.calories} cal | ${meal.nutrition.protein}g protein\n`;
    });
    response += `Daily Total: ${day.totals.calories} calories\n\n`;
  });
  
  if (duration_days > 3) {
    response += `... and ${duration_days - 3} more days in your plan!\n\n`;
  }
  
  response += `💡 All meals are personalized for your health conditions and goals.`;
  
  return response;
}

async function handleGetWeeklyAnalysis(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Run weekly analysis
  const analysis = await weeklyAnalysisCrew.runWeeklyAnalysis(phone);
  
  if (!analysis.success) {
    throw new Error('Failed to generate weekly analysis');
  }
  
  // Format response
  let response = analysis.analysis.executiveSummary;
  
  // Add key findings
  if (analysis.analysis.keyFindings.length > 0) {
    response += `\n\n🔍 KEY FINDINGS:\n`;
    analysis.analysis.keyFindings.slice(0, 5).forEach((finding, i) => {
      response += `${i + 1}. ${finding.message || finding}\n`;
    });
  }
  
  // Add recommendations
  if (analysis.analysis.recommendations.length > 0) {
    response += `\n\n💡 TOP RECOMMENDATIONS:\n`;
    analysis.analysis.recommendations.slice(0, 3).forEach((rec, i) => {
      response += `${i + 1}. ${rec.title || rec}\n`;
      if (rec.description) {
        response += `   ${rec.description}\n`;
      }
    });
  }
  
  // Add urgent actions
  if (analysis.analysis.urgentActions.length > 0) {
    response += `\n\n🚨 URGENT ACTIONS:\n`;
    analysis.analysis.urgentActions.forEach(action => {
      response += `• ${action.action || action}\n`;
    });
  }
  
  response += `\n\n🤖 MORE COMMANDS:\n`;
  response += `• add_food - Log your meals\n`;
  response += `• scan_food - Scan food with camera\n`;
  response += `• get_progress - Check today's intake\n`;
  response += `• generate_meal_plan - Get personalized meal suggestions\n`;
  response += `• export_data - Export your health data\n\n`;
  response += `💡 Type any command to use it!`;
  
  return response;
}

async function handleGetToxinSummary(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get daily summary from toxin tracker
  const summary = await toxinTracker.getDailySummary(phone);
  
  // Format the response using enhanced formatter
  let response = enhancedFormatter.formatDailySummary(summary);
  
  // Add achievements section
  const userStats = await toxinTracker.getUserStats(phone);
  if (userStats.lifetime.achievements && userStats.lifetime.achievements.length > 0) {
    response += '\n\n🏆 YOUR ACHIEVEMENTS:\n';
    response += '━━━━━━━━━━━━━━━━━━━━━━━━\n';
    
    const allAchievements = toxinTracker.achievements;
    userStats.lifetime.achievements.forEach(achievementId => {
      const achievement = Object.values(allAchievements).find(a => a.id === achievementId);
      if (achievement) {
        response += `${achievement.name}\n`;
      }
    });
  }
  
  // Add leaderboard teaser
  response += '\n\n🏅 CLEAN EATING LEADERBOARD:\n';
  response += '━━━━━━━━━━━━━━━━━━━━━━━━\n';
  const leaderboard = await toxinTracker.getCleanStreakLeaderboard(3);
  leaderboard.forEach((entry, index) => {
    response += `${index + 1}. User ***${entry.phone} - ${entry.currentStreak} day streak\n`;
  });
  
  response += '\n💡 Scan more clean foods to climb the leaderboard!';
  
  return response;
}

async function handleExportData(args, req) {
  const { puch_user_id, bearer_token, format, date_range = 'month', include_insights = true } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Export data
  const exportResult = await exportService.exportUserData(phone, {
    format,
    dateRange: date_range,
    includeInsights: include_insights
  });
  
  if (exportResult.format === 'json') {
    return `📊 Data exported successfully!\n\n${JSON.stringify(exportResult.data, null, 2).slice(0, 500)}...\n\n[Full data truncated for display]`;
  } else {
    return `📊 Data exported successfully!\n\nFormat: ${format.toUpperCase()}\nRecords: ${exportResult.recordCount}\nDate Range: ${date_range}\n\nDownload URL: ${exportResult.downloadUrl || 'Available via API'}\n\nThe export includes:\n• Daily nutrition logs\n• Progress tracking\n• Health analysis\n${include_insights ? '• AI-generated insights' : ''}`;
  }
}

async function handleGetPersonalization(args, req) {
  const { puch_user_id, bearer_token } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Get user insights
  const insights = await personalizationEngine.getUserInsights(phone);
  
  // Format response
  let response = `🧠 YOUR PERSONALIZATION PROFILE\n\n`;
  
  // Personality
  response += `🎭 Personality Type: ${insights.personality.personalityType.toUpperCase()}\n`;
  response += `• Motivation Style: ${insights.personality.motivationStyle}\n`;
  response += `• Learning Preference: ${insights.personality.learningPreference}\n`;
  response += `• Communication Tone: ${insights.personality.communicationTone}\n`;
  response += `• Goal Orientation: ${insights.personality.goalOrientation}\n\n`;
  
  // Behavioral patterns
  response += `📊 BEHAVIORAL PATTERNS:\n`;
  if (insights.patterns.triggerTimes.length > 0) {
    response += `• High-risk eating times: ${insights.patterns.triggerTimes.map(h => `${h}:00`).join(', ')}\n`;
  }
  if (insights.patterns.commonFoods) {
    const topFoods = Object.entries(insights.patterns.commonFoods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    response += `• Most frequent foods: ${topFoods.map(([f]) => f).join(', ')}\n`;
  }
  response += `• Adherence rate: ${Math.round(insights.profile.adherenceRate * 100)}%\n\n`;
  
  // Recommendations
  if (insights.recommendations.length > 0) {
    response += `💡 PERSONALIZED RECOMMENDATIONS:\n`;
    insights.recommendations.slice(0, 3).forEach(rec => {
      response += `• ${rec.message}\n`;
    });
  }
  
  // Success factors
  if (insights.successFactors.patterns.length > 0) {
    response += `\n✨ YOUR SUCCESS PATTERNS:\n`;
    insights.successFactors.patterns.forEach(pattern => {
      response += `• ${pattern}\n`;
    });
  }
  
  return response;
}

async function handleAbout(args, req) {
  return `🍎 SCANLYF - AI Nutrition That Exposes Truth

📱 TAGLINE:
AI-powered nutrition tracking that exposes harmful ingredients and helps you eat cleaner.

✨ KEY FEATURES:
• 📸 Scan food via camera or barcode
• 🚨 Harmful ingredient detection with brutal honesty
• 🤖 AI health insights from 5 expert agents
• 📊 Personalized nutrition tracking
• 🎯 Health condition-specific warnings

🏆 LEADERBOARD:
• Weekly clean eating rankings
• Daily consistency tracking
• Progress visualization
• Community competition

💰 REWARDS:
• Earn ScanlyfCoins for daily tracking
• Bonus coins for clean eating streaks
• Redeem for health products & discounts
• Achievement badges & milestones

🔬 WHAT MAKES US DIFFERENT:
• No sugar-coating - brutal truth about ingredients
• Personalized warnings based on YOUR health
• Multi-agent AI analysis (nutritionist, psychologist, coach)
• Real-time toxin exposure tracking

💡 START NOW: Type "setup_profile" to begin!

🌐 WEB: scanlyf.com/start`;
}

async function handleConfigureWebhook(args, req) {
  const { puch_user_id, bearer_token, webhook_url, events, enabled = true } = args;
  
  // Get token from request or args
  const token = getTokenFromRequest(args, req);
  if (!token) {
    throw new Error('Please connect to Scanlyf first.');
  }
  
  // Validate token
  const phone = await getUserIdentifier(args, req);
  
  // Validate webhook URL
  if (!webhook_url.startsWith('https://')) {
    throw new Error('Webhook URL must use HTTPS');
  }
  
  // Configure webhook
  const result = await webhookService.configureWebhook(phone, {
    url: webhook_url,
    events: events,
    enabled: enabled
  });
  
  // Format response
  let response = `🔔 WEBHOOK CONFIGURATION\n\n`;
  response += `Status: ${result.enabled ? '✅ Active' : '❌ Disabled'}\n`;
  response += `URL: ${result.url}\n`;
  response += `Events: ${result.events.join(', ')}\n\n`;
  
  if (result.testResult) {
    response += `Test Result: ${result.testResult.success ? '✅ Success' : '❌ Failed'}\n`;
    if (!result.testResult.success) {
      response += `Error: ${result.testResult.error}\n`;
    }
  }
  
  response += `\nWebhook will receive:\n`;
  response += `• Real-time health risk alerts\n`;
  response += `• Goal achievement notifications\n`;
  response += `• Weekly analysis summaries\n`;
  response += `• Custom meal reminders\n\n`;
  response += `All webhooks are signed with HMAC-SHA256 for security.`;
  
  return response;
}

// Helper functions
function getToolsList() {
  return [
    {
      name: 'validate',
      description: 'Validate bearer token and return phone number',
      inputSchema: {
        type: 'object',
        properties: {
          token: {
            type: 'string',
            description: 'Token for validation'
          }
        },
        required: ['token']
      }
    },
    {
      name: 'hello',
      description: 'Say hello to the user',
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name to greet'
          }
        }
      }
    },
    {
      name: 'commands',
      description: 'List all available Scanlyf commands with descriptions',
      inputSchema: {
        type: 'object',
        properties: {}
      }
    },
    {
      name: 'setup_profile',
      description: 'Set up your health profile by providing information naturally, like: "I\'m Raj, 30 years old, 70 kg, 175 cm tall, male, no health conditions"',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          text: { 
            type: 'string', 
            description: 'Natural language description of yourself, e.g., "I\'m Raj, 30 years old, 70 kg, 175 cm tall, male, diabetic"' 
          },
          name: { type: 'string', description: 'Your name' },
          age: { type: 'number', description: 'Your age in years' },
          height_cm: { type: 'number', description: 'Your height in centimeters' },
          weight_kg: { type: 'number', description: 'Your weight in kilograms' },
          gender: { 
            type: 'string', 
            enum: ['male', 'female'],
            description: 'Your gender (male or female)'
          },
          health_conditions: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Any health conditions like diabetes, hypertension, or say "none"'
          },
          activity_level: {
            type: 'string',
            enum: ['low', 'moderate', 'high'],
            description: 'Your activity level (optional)'
          },
          dietary_restrictions: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Dietary preferences like vegetarian, vegan (optional)'
          },
          health_goals: {
            type: 'array',
            items: {
              type: 'string'
            },
            description: 'Health goals like weight_loss, muscle_gain (optional)'
          }
        },
        required: []
      }
    },
    {
      name: 'scan_food',
      description: 'Analyze food for nutrition info, ingredients, and health warnings without logging',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          input: {
            type: 'string',
            description: 'Base64 image, text description, or leave empty for barcode'
          },
          puch_image_data: {
            type: 'string',
            description: 'Base64 image data from Puch AI'
          },
          type: {
            type: 'string',
            enum: ['image', 'text', 'barcode'],
            description: 'Type of input'
          },
          barcode: {
            type: 'string',
            description: 'Product barcode (8-13 digits) for barcode type'
          },
          food_suggestion: {
            type: 'string',
            description: 'Food name suggested by Puch AI when image cannot be processed'
          },
          location: {
            type: 'string',
            enum: ['home', 'work', 'restaurant', 'travel'],
            description: 'Where you are eating (for context)'
          },
          social_context: {
            type: 'string',
            enum: ['alone', 'family', 'friends', 'business'],
            description: 'Who you are eating with'
          },
          mood: {
            type: 'string',
            enum: ['stressed', 'happy', 'tired', 'energetic', 'anxious', 'neutral'],
            description: 'Current mood (helps detect emotional eating)'
          }
        },
        required: []
      }
    },
    {
      name: 'scan_and_add_food',
      description: 'Scan food and automatically add it to daily intake (combines scan + add)',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          input: {
            type: 'string',
            description: 'Base64 image or text description'
          },
          puch_image_data: {
            type: 'string', 
            description: 'Base64 image data from Puch AI'
          },
          type: {
            type: 'string',
            enum: ['image', 'text'],
            description: 'Type of input'
          },
          food_name: {
            type: 'string',
            description: 'Food name if Puch AI already detected it (e.g., "paneer tikka")'
          },
          auto_add: {
            type: 'boolean',
            description: 'Automatically add to daily log (default: true)'
          }
        },
        required: ['type']
      }
    },
    {
      name: 'add_food',
      description: 'Log food entry to daily intake with health analysis',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          input: {
            type: 'string',
            description: 'Base64 image, text description, or leave empty for barcode/quick_add'
          },
          puch_image_data: {
            type: 'string',
            description: 'Base64 image data from Puch AI'
          },
          type: {
            type: 'string',
            enum: ['image', 'text', 'barcode'],
            description: 'Type of input (not needed for quick_add)'
          },
          barcode: {
            type: 'string',
            description: 'Product barcode (8-13 digits) for barcode type'
          },
          quick_add: {
            type: 'string',
            description: 'Quick-add ID from previous scan_food result'
          },
          confirm_analysis_id: {
            type: 'string',
            description: 'ID from multi-item detection to confirm'
          },
          user_corrections: {
            type: 'string',
            description: 'User corrections for multi-item detection'
          },
          location: {
            type: 'string',
            enum: ['home', 'work', 'restaurant', 'travel'],
            description: 'Where you are eating'
          },
          social_context: {
            type: 'string',
            enum: ['alone', 'family', 'friends', 'business'],
            description: 'Who you are eating with'
          },
          mood: {
            type: 'string',
            enum: ['stressed', 'happy', 'tired', 'energetic', 'anxious', 'neutral'],
            description: 'Current mood'
          }
        },
        required: []
      }
    },
    {
      name: 'list_today_foods', 
      description: 'List all foods eaten today with detailed nutrition info',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'remove_food',
      description: 'Remove a food item from today\'s log',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          food_index: { 
            type: 'number', 
            description: 'Number of the food item to remove (1, 2, 3, etc. from the list)' 
          },
          food_name: { 
            type: 'string', 
            description: 'Name of the food to remove (e.g., "paneer tikka")' 
          }
        },
        required: []
      }
    },
    {
      name: 'get_progress',
      description: 'Get daily nutrition progress',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          date: {
            type: 'string',
            description: 'Date in YYYY-MM-DD format (defaults to today)'
          }
        },
        required: []
      }
    },
    {
      name: 'get_leaderboard',
      description: 'View current week nutrition leaderboard',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'check_balance',
      description: 'Check ScanlyfCoin balance and transaction history',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'view_rewards',
      description: 'View available rewards catalog',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'generate_meal_plan',
      description: 'Generate personalized meal plan based on health profile',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          duration_days: {
            type: 'number',
            enum: [1, 7, 14, 30],
            description: 'Meal plan duration in days'
          },
          meal_count: {
            type: 'number',
            enum: [3, 4, 5],
            description: 'Number of meals per day'
          },
          include_snacks: {
            type: 'boolean',
            description: 'Include healthy snacks in the plan'
          },
          exclude_ingredients: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ingredients to exclude from meal plan'
          }
        },
        required: []
      }
    },
    {
      name: 'get_weekly_analysis',
      description: 'Get AI-powered weekly health analysis from multiple expert agents',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'get_toxin_summary',
      description: 'Get your daily toxin tracking summary and clean eating streak',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'export_data',
      description: 'Export your nutrition data in various formats',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          format: {
            type: 'string',
            enum: ['json', 'csv', 'pdf', 'excel'],
            description: 'Export format'
          },
          date_range: {
            type: 'string',
            enum: ['week', 'month', 'quarter', 'year', 'all'],
            description: 'Date range to export'
          },
          include_insights: {
            type: 'boolean',
            description: 'Include AI-generated insights in export'
          }
        },
        required: ['format']
      }
    },
    {
      name: 'get_personalization',
      description: 'Get your personality profile and customization settings',
      inputSchema: {
        type: 'object',
        properties: {
          bearer_token: { type: 'string', description: 'Bearer token for authentication' }
        },
        required: []
      }
    },
    {
      name: 'configure_webhook',
      description: 'Configure webhook for real-time notifications',
      inputSchema: {
        type: 'object',
        properties: {
          puch_user_id: { type: 'string', description: 'Puch User Unique Identifier' },
          bearer_token: { type: 'string', description: 'Bearer token for authentication' },
          webhook_url: {
            type: 'string',
            description: 'HTTPS URL to receive webhooks'
          },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['goal_achieved', 'health_risk', 'weekly_analysis', 'meal_reminder']
            },
            description: 'Events to subscribe to'
          },
          enabled: {
            type: 'boolean',
            description: 'Enable or disable webhook'
          }
        },
        required: ['webhook_url', 'events']
      }
    },
    {
      name: 'about',
      description: 'Learn about Scanlyf features, rewards, and leaderboard',
      inputSchema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];
}

async function formatScanResponse(nutritionData, healthAnalysis, type, userPhone) {
  // Get user profile for personalized analysis
  let userProfile = {};
  try {
    const profileDoc = await userService.getUserProfile(userPhone);
    if (profileDoc) {
      userProfile = profileDoc;
    }
  } catch (error) {
    console.error('Error fetching user profile:', error);
  }
  
  // Check if we have harmful ingredients to show enhanced format
  if (nutritionData.harmfulIngredients && nutritionData.harmfulIngredients.length > 0) {
    // Track the scan with toxin tracker
    const trackingResult = await toxinTracker.trackScan(userPhone, {
      harmfulIngredients: nutritionData.harmfulIngredients,
      nutritionData: nutritionData
    });
    
    // Add tracking data to user profile for formatter
    userProfile.todayScans = trackingResult.todayScans;
    userProfile.cleanScans = trackingResult.cleanScans;
    userProfile.toxicScans = trackingResult.toxicScans;
    userProfile.cleanStreak = trackingResult.cleanStreak;
    
    // Use BRUTAL ANALYZER for maximum impact
    let enhancedResponse = await brutalAnalyzer.analyzeFoodWithBrutalHonesty({
      name: nutritionData.name,
      harmfulIngredients: nutritionData.harmfulIngredients,
      processingLevel: nutritionData.processingLevel
    }, userProfile);
    
    // Add achievements if any
    if (trackingResult.newAchievements && trackingResult.newAchievements.length > 0) {
      enhancedResponse += '\n\n🏆 ACHIEVEMENTS UNLOCKED!\n';
      enhancedResponse += '━━━━━━━━━━━━━━━━━━━━━━━━\n';
      trackingResult.newAchievements.forEach(achievement => {
        enhancedResponse += `${achievement.name} - ${achievement.description}\n`;
        enhancedResponse += `+${achievement.coins} ScanlyfCoins earned!\n`;
      });
    }
    
    return enhancedResponse;
  }
  
  // For clean foods, track and use clean food response
  const trackingResult = await toxinTracker.trackScan(userPhone, {
    harmfulIngredients: [],
    nutritionData: nutritionData
  });
  
  if (!nutritionData.harmfulIngredients || nutritionData.harmfulIngredients.length === 0) {
    return enhancedFormatter.formatCleanFoodResponse({
      nutritionData: nutritionData
    });
  }
  
  // Fallback to original format if needed
  let response = `🔍 FOOD ANALYSIS: ${nutritionData.name}\n`;
  
  // If detected from image, show what was detected
  if (type === 'image' && nutritionData.detectedFoods) {
    const detectedNames = nutritionData.detectedFoods.slice(0, 3).map(food => 
      typeof food === 'string' ? food : food.name
    );
    response += `📷 Detected: ${detectedNames.join(', ')}\n`;
  }
  
  response += `\n📊 NUTRITION (per ${nutritionData.portion_size || 'serving'}):\n`;
  response += `Calories: ${nutritionData.calories}\n`;
  response += `Protein: ${nutritionData.protein}g | Carbs: ${nutritionData.carbs}g | Fat: ${nutritionData.fat}g\n`;
  
  // Add detailed nutrients if available
  if (nutritionData.fiber !== undefined || nutritionData.sugar !== undefined || nutritionData.sodium !== undefined) {
    response += `Fiber: ${nutritionData.fiber || 0}g | Sugar: ${nutritionData.sugar || 0}g | Sodium: ${nutritionData.sodium || 0}mg\n`;
  }
  
  if (nutritionData.source) {
    response += `📚 Source: ${nutritionData.source}\n`;
  }
  response += '\n';
  
  // Add health warnings with severity
  if (healthAnalysis.warnings.length > 0) {
    response += `⚠️ HEALTH WARNINGS:\n`;
    healthAnalysis.warnings.forEach(warning => {
      const icon = warning.severity === 'high' ? '🚫' : '⚠️';
      response += `${icon} ${warning.message}\n`;
    });
    response += '\n';
  }
  
  // Add pros and cons
  response += `✅ PROS:\n`;
  healthAnalysis.pros.forEach(pro => {
    response += `• ${pro}\n`;
  });
  response += `\n❌ CONS:\n`;
  healthAnalysis.cons.forEach(con => {
    response += `• ${con}\n`;
  });
  
  // Add recommendations if any
  if (healthAnalysis.recommendations && healthAnalysis.recommendations.length > 0) {
    response += `\n💡 SUGGESTIONS:\n`;
    healthAnalysis.recommendations.forEach(rec => {
      response += `• ${rec}\n`;
    });
  }
  
  response += `\n${healthAnalysis.overallRecommendation}`;
  
  return response;
}

async function formatScanOnlyResponse(nutritionData, analysisResult, userPhone) {
  // Get user profile for personalized analysis
  let userProfile = {};
  try {
    const profileDoc = await userService.getUserProfile(userPhone);
    if (profileDoc) {
      userProfile = profileDoc;
    }
  } catch (error) {
    console.error('Error fetching user profile:', error);
  }
  
  // Check if we have harmful ingredients for enhanced formatting
  if (nutritionData.harmfulIngredients && nutritionData.harmfulIngredients.length > 0) {
    // Track the scan
    const trackingResult = await toxinTracker.trackScan(userPhone, {
      harmfulIngredients: nutritionData.harmfulIngredients,
      nutritionData: nutritionData
    });
    
    // Add tracking data to user profile
    userProfile.todayScans = trackingResult.todayScans;
    userProfile.cleanScans = trackingResult.cleanScans;
    userProfile.toxicScans = trackingResult.toxicScans;
    userProfile.cleanStreak = trackingResult.cleanStreak;
    
    // Use BRUTAL ANALYZER for scan-only responses too
    let enhancedResponse = await brutalAnalyzer.analyzeFoodWithBrutalHonesty({
      name: nutritionData.name,
      harmfulIngredients: nutritionData.harmfulIngredients,
      processingLevel: nutritionData.processingLevel || 'processed'
    }, userProfile);
    
    // Add confirmation prompt
    enhancedResponse += `\n\n📝 TO LOG THIS FOOD:\n`;
    enhancedResponse += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    enhancedResponse += `Say "Yes" or type: add_food\n`;
    enhancedResponse += `To correct: add_food [correct name]\n`;
    enhancedResponse += `━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    return enhancedResponse;
  }
  
  // For clean foods, track and use clean format
  const trackingResult = await toxinTracker.trackScan(userPhone, {
    harmfulIngredients: [],
    nutritionData: nutritionData
  });
  
  if (!nutritionData.harmfulIngredients || nutritionData.harmfulIngredients.length === 0) {
    let cleanResponse = enhancedFormatter.formatCleanFoodResponse({
      nutritionData: nutritionData
    });
    
    // Add confirmation prompt
    cleanResponse += `\n\n📝 TO LOG THIS FOOD:\n`;
    cleanResponse += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    cleanResponse += `Say "Yes" or type: add_food\n`;
    cleanResponse += `To correct: add_food [correct name]\n`;
    cleanResponse += `━━━━━━━━━━━━━━━━━━━━━━━━`;
    
    return cleanResponse;
  }
  
  // Fallback to original format
  let response = `🔍 FOOD DETECTED: ${nutritionData.name || 'Food item'}\n\n`;
  response += `📊 Nutrition Facts:\n`;
  response += `• Calories: ${nutritionData.calories}\n`;
  response += `• Protein: ${nutritionData.protein}g\n`;
  response += `• Carbs: ${nutritionData.carbs}g\n`;
  response += `• Fat: ${nutritionData.fat}g\n`;
  
  if (analysisResult.healthAnalysis) {
    response += `\n${analysisResult.healthAnalysis}`;
  }
  
  // Clear confirmation prompt with tool commands
  response += `\n\n📝 TO LOG THIS FOOD:\n\n`;
  response += `Is "${nutritionData.name}" correct?\n\n`;
  response += `✅ IF CORRECT:\n`;
  response += `• Say "Yes" to add it to your log\n`;
  response += `• Or type: add_food\n\n`;
  response += `❌ IF WRONG:\n`;
  response += `• Type: add_food\n`;
  response += `• Then describe the correct food\n`;
  response += `• Example: "add_food" → "2 idli with sambar"\n\n`;
  response += `🔄 Or type: scan_food to try scanning again\n\n`;
  response += `🤖 ALL AVAILABLE COMMANDS:\n`;
  response += `• add_food - Log food (text or corrected name)\n`;
  response += `• scan_food - Scan with camera\n`;
  response += `• list_today_foods - See today's log\n`;
  response += `• remove_food - Delete logged items\n`;
  response += `• get_progress - Check daily targets\n`;
  response += `• get_weekly_analysis - AI insights\n\n`;
  response += `💡 Just type the command name!`;
  
  return response;
}

function formatProgressResponse(progress, profile) {
  const targets = {
    calories: profile.calorie_target,
    protein: profile.protein_target,
    carbs: profile.carb_target,
    fat: profile.fat_target
  };
  
  const remaining = {
    calories: Math.max(0, targets.calories - progress.totals.calories),
    protein: Math.max(0, targets.protein - progress.totals.protein),
    carbs: Math.max(0, targets.carbs - progress.totals.carbs),
    fat: Math.max(0, targets.fat - progress.totals.fat)
  };
  
  const percentageConsumed = targets.calories > 0 ? 
    Math.round((progress.totals.calories / targets.calories) * 100) : 0;
  
  let response = `📊 DAILY PROGRESS (${progress.date})\n\n`;
  response += `🎯 TARGETS vs 🍽️ CONSUMED:\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `Calories:\n`;
  response += `  • Target: ${targets.calories} cal\n`;
  response += `  • Consumed: ${progress.totals.calories} cal (${percentageConsumed}%)\n`;
  response += `  • Remaining: ${remaining.calories} cal\n\n`;
  
  response += `Protein: ${progress.totals.protein}g consumed / ${targets.protein}g target\n`;
  response += `Carbs: ${progress.totals.carbs}g consumed / ${targets.carbs}g target\n`;
  response += `Fat: ${progress.totals.fat}g consumed / ${targets.fat}g target\n\n`;
  
  if (progress.foods.length > 0) {
    response += `🍽️ TODAY'S MEALS (${progress.foods.length} items):\n`;
    progress.foods.forEach((food, idx) => {
      response += `${idx + 1}. ${food.name} (${food.calories} cal)\n`;
    });
  } else {
    response += `📝 No foods logged today yet.\n`;
    response += `💡 Start tracking by saying "I ate..." or uploading a food photo!\n`;
  }
  
  response += `\n✨ What would you like to do next?\n`;
  response += `• Track another meal\n`;
  response += `• View today's detailed food diary\n`;
  response += `• Get your weekly health insights\n`;
  response += `• Export your nutrition data\n\n`;
  response += `💪 Keep going! You're doing great!`;
  
  return response;
}

// ======================================
// ERROR HANDLING
// ======================================

// ======================================
// ERROR HANDLING
// ======================================

// Error handling middleware
app.use(errorHandler);

// Puch AI error handler (should be last)
app.use(puchAIErrorHandler);

// ======================================
// SERVER STARTUP
// ======================================

// Disable Redis - using in-memory storage only
console.log('⚠️ Redis disabled - using in-memory fallback');
console.log('   Advanced rate limiting, anomaly detection, and audit logs will use in-memory storage');

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Scanlyf MCP Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔒 Security features enabled:`);
  console.log(`   ✅ JWT Authentication`);
  console.log(`   ✅ Rate Limiting (API-specific)`);
  console.log(`   ✅ Input Validation`);
  console.log(`   ✅ Security Headers`);
  console.log(`   ✅ CORS Restrictions`);
});

module.exports = app;