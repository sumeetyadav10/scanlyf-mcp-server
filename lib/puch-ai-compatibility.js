/**
 * Puch AI MCP Compatibility Layer
 * Based on analysis of https://github.com/TurboML-Inc/mcp-starter
 * 
 * Key insights:
 * 1. Puch AI sends 'default', 'YOUR_BEARER_TOKEN', or server ID as bearer_token in args
 * 2. The REAL JWT token is ALWAYS in the Authorization header
 * 3. Puch AI expects standard MCP JSON-RPC responses
 * 4. Image data comes as 'puch_image_data' parameter
 */

// List of ALL known Puch AI token placeholders
const PUCH_AI_PLACEHOLDERS = [
  'default',
  'YOUR_BEARER_TOKEN',
  'kjFfXhp23J', // Server ID from your config
  // Add any other server IDs here
];

/**
 * Extract real JWT token from request
 * Compatible with Puch AI's implementation
 */
function extractPuchAIToken(args, req) {
  // Puch AI ALWAYS sends the real token in Authorization header
  // The bearer_token in args is just a placeholder
  
  const authHeader = req?.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }
  
  // Fallback: check if args.bearer_token is a real JWT (unlikely with Puch AI)
  const argToken = args?.bearer_token || args?.token;
  if (argToken && argToken.includes('.') && argToken.length > 100) {
    return argToken;
  }
  
  return null;
}

/**
 * Format response for Puch AI with enhanced AI response handling
 * Ensures compatibility with their expected format and better user experience
 */
function formatPuchAIResponse(content, isError = false, responseType = 'general') {
  // Handle string responses (most common)
  if (typeof content === 'string') {
    // Clean up common ChatGPT/AI artifacts
    let cleanedContent = cleanAIResponse(content);
    
    // For non-error messages, check if we should use CrewAI enhancement
    if (!isError && responseType === 'scan_food') {
      const CrewAIFormatter = require('./crew-ai-formatter');
      
      // Only use CrewAI for scan_food responses with harmful ingredients
      if (cleanedContent.includes('HARMFUL') || 
          cleanedContent.includes('Health Analysis for') ||
          cleanedContent.includes('concerning ingredients')) {
        
        // Check if we have ingredient data in the content
        const hasIngredients = cleanedContent.includes('🧪 INGREDIENTS') || 
                              cleanedContent.includes('E-') ||
                              cleanedContent.includes('concerning ingredients');
        
        if (hasIngredients) {
          // Use the ingredient analysis task for better display
          const enhancedTask = CrewAIFormatter.createIngredientAnalysisTask(cleanedContent, {});
          return {
            content: [{
              type: 'text',
              text: enhancedTask
            }],
            isError: false
          };
        }
      }
    }
    
    return {
      content: [{ type: 'text', text: cleanedContent }],
      isError: isError
    };
  }
  
  // Handle object responses
  if (content && typeof content === 'object') {
    // Handle error objects
    if (content.success === false) {
      const errorMsg = content.error || content.message || 'Operation failed';
      return {
        content: [{ type: 'text', text: makeUserFriendlyError(errorMsg) }],
        isError: true
      };
    }
    
    // Handle objects with message property
    if (content.message) {
      const cleanedMessage = cleanAIResponse(content.message);
      return {
        content: [{ type: 'text', text: cleanedMessage }],
        isError: false
      };
    }
    
    // Handle structured data (nutrition info, etc.)
    if (content.nutrition || content.calories || content.protein) {
      const formattedData = formatNutritionForUser(content);
      return {
        content: [{ type: 'text', text: formattedData }],
        isError: false
      };
    }
    
    // Handle arrays (like food lists)
    if (Array.isArray(content)) {
      const formattedList = formatArrayForUser(content);
      return {
        content: [{ type: 'text', text: formattedList }],
        isError: false
      };
    }
    
    // Default: stringify but make it user-friendly
    try {
      const jsonStr = JSON.stringify(content, null, 2);
      return {
        content: [{ type: 'text', text: `📊 Data:\n\`\`\`\n${jsonStr}\n\`\`\`` }],
        isError: false
      };
    } catch (e) {
      return {
        content: [{ type: 'text', text: 'Data received successfully ✅' }],
        isError: false
      };
    }
  }
  
  // Handle null/undefined
  if (content == null) {
    return {
      content: [{ type: 'text', text: isError ? 'An error occurred' : 'Operation completed successfully ✅' }],
      isError: isError
    };
  }
  
  // Fallback
  return {
    content: [{ type: 'text', text: String(content) || 'Operation completed' }],
    isError: false
  };
}

/**
 * Clean AI response artifacts for better user experience
 */
function cleanAIResponse(text) {
  if (!text || typeof text !== 'string') return text;
  
  let cleaned = text;
  
  // Remove common AI prefixes/suffixes
  const aiPrefixes = [
    'As an AI assistant, ',
    'I apologize, but ',
    'I understand you want to ',
    'Based on the information provided, ',
    'Here is what I found: ',
    'Let me help you with that. '
  ];
  
  const aiSuffixes = [
    ' Let me know if you need anything else!',
    ' Is there anything else I can help you with?',
    ' Please let me know if you have any questions.',
    ' I hope this helps!'
  ];
  
  // Remove prefixes
  for (const prefix of aiPrefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.substring(prefix.length);
      break;
    }
  }
  
  // Remove suffixes
  for (const suffix of aiSuffixes) {
    if (cleaned.toLowerCase().endsWith(suffix.toLowerCase())) {
      cleaned = cleaned.substring(0, cleaned.length - suffix.length);
      break;
    }
  }
  
  // Trim and ensure proper sentence structure
  cleaned = cleaned.trim();
  if (cleaned && !cleaned.endsWith('.') && !cleaned.endsWith('!') && !cleaned.endsWith('?') && !cleaned.includes('\n')) {
    cleaned += '.';
  }
  
  return cleaned;
}

/**
 * Make error messages more user-friendly
 */
function makeUserFriendlyError(error) {
  if (!error) return 'Something went wrong.';
  
  const errorStr = String(error).toLowerCase();
  
  // Common technical errors to user-friendly messages
  if (errorStr.includes('bearer token') || errorStr.includes('authentication')) {
    return '🔐 Please connect to Scanlyf first to use this feature.';
  }
  
  if (errorStr.includes('profile') || errorStr.includes('setup')) {
    return '👤 Please set up your profile first by telling me about yourself (age, weight, height, etc.)';
  }
  
  if (errorStr.includes('image') || errorStr.includes('base64')) {
    return '📸 There was an issue processing your image. Please try uploading it again or describe what you ate.';
  }
  
  if (errorStr.includes('network') || errorStr.includes('timeout') || errorStr.includes('connection')) {
    return '🌐 Connection issue. Please try again in a moment.';
  }
  
  // Return cleaned version of original error
  return '⚠️ ' + String(error);
}

/**
 * Format nutrition data for users
 */
function formatNutritionForUser(data) {
  if (!data) return 'No nutrition data available.';
  
  let result = '';
  
  if (data.name) {
    result += `🍽️ ${data.name}\n`;
  }
  
  if (data.calories !== undefined) {
    result += `📊 ${data.calories} calories`;
    
    if (data.protein !== undefined) result += ` | ${data.protein}g protein`;
    if (data.carbs !== undefined) result += ` | ${data.carbs}g carbs`;
    if (data.fat !== undefined) result += ` | ${data.fat}g fat`;
    
    result += '\n';
  }
  
  return result || JSON.stringify(data, null, 2);
}

/**
 * Format arrays for user display
 */
function formatArrayForUser(arr) {
  if (!Array.isArray(arr) || arr.length === 0) {
    return 'No items found.';
  }
  
  // If it's a list of foods/items
  if (arr[0] && typeof arr[0] === 'object' && arr[0].name) {
    return arr.map((item, index) => 
      `${index + 1}. ${item.name}${item.calories ? ` (${item.calories} cal)` : ''}`
    ).join('\n');
  }
  
  // If it's a simple string array
  if (arr[0] && typeof arr[0] === 'string') {
    return arr.map((item, index) => `${index + 1}. ${item}`).join('\n');
  }
  
  // Fallback to JSON
  return JSON.stringify(arr, null, 2);
}

/**
 * Handle Puch AI image data with comprehensive validation
 * They can send base64 in multiple parameters and formats
 */
function extractPuchAIImageData(args) {
  // Priority order for image data - check all possible parameters
  const possibleImageSources = [
    args.puch_image_data,
    args.image_data, 
    args.image,
    args.imageData,
    args.image_base64,
    args.base64_image,
    (args.input && args.type === 'image' ? args.input : null)
  ];
  
  let imageData = null;
  
  // Find the first non-empty image source
  for (const source of possibleImageSources) {
    if (source && 
        source !== null && 
        source !== 'null' &&
        source !== '' && 
        source !== 'Base64 Image' && 
        source !== 'Base64 encoded image data' &&
        source !== 'None' &&
        typeof source === 'string' &&
        source.length > 10) {
      imageData = source;
      break;
    }
  }
  
  if (!imageData) {
    console.log('No valid image data found in Puch AI request:', {
      args: Object.keys(args),
      hasInput: !!args.input,
      inputType: typeof args.input,
      inputValue: args.input === null ? 'null' : (args.input ? args.input.substring(0, 50) + '...' : 'none')
    });
    return null;
  }
  
  // Clean base64 data URI prefix if present
  if (imageData.includes('data:image')) {
    const parts = imageData.split(',');
    if (parts.length > 1) {
      imageData = parts[1];
    }
  }
  
  // Validate base64 format
  if (!isValidBase64(imageData)) {
    console.log('Invalid base64 image data from Puch AI:', imageData.substring(0, 100));
    return null;
  }
  
  console.log('Successfully extracted image data from Puch AI:', {
    length: imageData.length,
    preview: imageData.substring(0, 50) + '...'
  });
  
  return imageData;
}

/**
 * Validate base64 string
 */
function isValidBase64(str) {
  if (!str || typeof str !== 'string') return false;
  
  // Remove whitespace
  const cleaned = str.replace(/\s/g, '');
  
  // Check if it looks like base64
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  if (!base64Regex.test(cleaned)) return false;
  
  // Check minimum length (should be reasonable for an image)
  if (cleaned.length < 50) return false;
  
  return true;
}

/**
 * Enhanced middleware to handle Puch AI requests
 */
function puchAICompatibilityMiddleware(req, res, next) {
  // Add Puch AI detection with multiple indicators
  req.isPuchAI = false;
  
  // Detect Puch AI by multiple indicators
  const isPuchAIRequest = detectPuchAIRequest(req);
  
  if (isPuchAIRequest && req.body?.method === 'tools/call' && req.body?.params?.arguments) {
    req.isPuchAI = true;
    const args = req.body.params.arguments;
    
    console.log('Puch AI request detected:', {
      method: req.body.params.name,
      hasToken: !!args.bearer_token,
      tokenValue: args.bearer_token,
      type: args.type,
      hasInput: !!args.input,
      inputType: typeof args.input,
      userAgent: req.headers['user-agent']
    });
    
    // Extract and replace real token from header
    const realToken = extractPuchAIToken(args, req);
    if (realToken) {
      console.log('Replacing Puch AI placeholder token with real JWT');
      args.bearer_token = realToken;
    }
    
    // Handle image data with comprehensive extraction
    if (args.type === 'image') {
      const imageData = extractPuchAIImageData(args);
      if (imageData) {
        console.log('Extracted image data from Puch AI, setting as input');
        args.input = imageData;
        // Also keep original puch_image_data for debugging
        if (!args.puch_image_data) {
          args.puch_image_data = imageData;
        }
      } else {
        console.log('No valid image data found in Puch AI request');
        // Mark the request so handlers can provide better error messages
        args._puchAI_missing_image = true;
      }
    }
    
    // Handle text input cleaning
    if (args.type === 'text' && args.input) {
      args.input = cleanTextInput(args.input);
    }
  }
  
  next();
}

/**
 * Detect if request is from Puch AI using multiple indicators
 */
function detectPuchAIRequest(req) {
  if (!req.body?.params?.arguments) return false;
  
  const args = req.body.params.arguments;
  const headers = req.headers;
  
  // Check token placeholders
  if (args.bearer_token && PUCH_AI_PLACEHOLDERS.includes(args.bearer_token)) {
    return true;
  }
  
  // Check user agent
  if (headers['user-agent']?.includes('python-httpx')) {
    return true;
  }
  
  // Check for MCP protocol version header
  if (headers['mcp-protocol-version']) {
    return true;
  }
  
  // Check for Sentry headers (Puch AI uses Sentry)
  if (headers['sentry-trace'] || headers['baggage']) {
    return true;
  }
  
  // Check for specific parameter patterns
  if (args.auto_add !== undefined || args.puch_image_data !== undefined) {
    return true;
  }
  
  return false;
}

/**
 * Clean text input from Puch AI
 */
function cleanTextInput(input) {
  if (!input || typeof input !== 'string') return input;
  
  // Remove common artifacts
  let cleaned = input.trim();
  
  // Remove null/None strings
  if (cleaned === 'null' || cleaned === 'None' || cleaned === 'undefined') {
    return null;
  }
  
  return cleaned;
}

/**
 * Error handler for Puch AI
 */
function puchAIErrorHandler(error, req, res, next) {
  if (req.isPuchAI) {
    const errorResponse = {
      jsonrpc: '2.0',
      id: req.body?.id || null,
      error: {
        code: -32603,
        message: error.message || 'Internal error',
        data: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };
    
    return res.status(200).json(errorResponse); // MCP uses 200 even for errors
  }
  
  next(error);
}

module.exports = {
  extractPuchAIToken,
  formatPuchAIResponse,
  extractPuchAIImageData,
  puchAICompatibilityMiddleware,
  puchAIErrorHandler,
  PUCH_AI_PLACEHOLDERS,
  cleanAIResponse,
  makeUserFriendlyError,
  formatNutritionForUser,
  isValidBase64
};