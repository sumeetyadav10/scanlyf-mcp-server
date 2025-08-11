const visionService = require('./visionService');
const enhancedVisionService = require('./enhancedVisionService');
const foodService = require('./foodService');
const healthAnalysisService = require('./healthAnalysisService');
const { parseFoodDescription } = require('../lib/nutrition');
const axios = require('axios');
const cacheService = require('../lib/cacheService');
const errorHandler = require('../lib/errorHandler');
const barcodeService = require('./barcodeServiceSharp');
const enhancedFormatter = require('./enhancedIngredientFormatter');
const toxinTracker = require('./toxinTracker');
const ingredientAnalyzer = require('./ingredientAnalyzer');
const gptFoodAnalyzer = require('./gptFoodAnalyzer');

class EnhancedFoodAnalysisService {
  constructor() {
    this.inputTypes = {
      TEXT: 'text',
      IMAGE: 'image',
      BARCODE: 'barcode',
      VOICE: 'voice'
    };
  }

  // Main analysis endpoint that routes to appropriate handler
  async analyzeFood(input, type, userProfile) {
    try {
      let result;
      
      switch (type) {
        case this.inputTypes.TEXT:
          result = await this.analyzeFromText(input, userProfile);
          break;
        
        case this.inputTypes.IMAGE:
          result = await this.analyzeFromImageEnhanced(input, userProfile);
          break;
        
        case this.inputTypes.BARCODE:
          result = await this.analyzeFromBarcode(input);
          break;
        
        default:
          throw new Error(`Unsupported input type: ${type}`);
      }

      // Add personalized recommendations if successful
      if (result.success && userProfile && result.nutrition) {
        result.personalizedMessage = await this.getPersonalizedResponse(
          userProfile,
          result.nutrition,
          type
        );
      }

      return result;
    } catch (error) {
      console.error('Food analysis error:', error);
      return {
        success: false,
        error: error.message,
        fallback: true,
        nutrition: await foodService.getMockNutritionData('Unknown food', 1)
      };
    }
  }

  // Barcode scanning using OpenFoodFacts
  async analyzeFromBarcode(barcode) {
    // Validate barcode format
    if (!barcode || !barcode.match(/^\d{8,13}$/)) {
      throw new Error('Invalid barcode format. Please provide 8-13 digit barcode.');
    }

    // Check cache first
    const cacheKey = `barcode:${barcode}`;
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      console.log(`Cache hit for barcode: ${barcode}`);
      return cached;
    }

    try {
      // Try OpenFoodFacts barcode API
      const url = `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`;
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Scanlyf/1.0 (Nutrition Tracking App)'
        },
        timeout: 5000
      });

      if (response.data.status === 1 && response.data.product) {
        const product = response.data.product;
        const nutrients = product.nutriments || {};
        
        const nutritionData = {
          name: product.product_name || 'Unknown product',
          barcode: barcode,
          brand: product.brands || '',
          calories: Math.round(nutrients['energy-kcal_100g'] || 0),
          protein: Math.round(nutrients.proteins_100g || 0),
          carbs: Math.round(nutrients.carbohydrates_100g || 0),
          fat: Math.round(nutrients.fat_100g || 0),
          fiber: Math.round(nutrients.fiber_100g || 0),
          sugar: Math.round(nutrients.sugars_100g || 0),
          sodium: Math.round((nutrients.sodium_100g || 0) * 1000), // Convert g to mg
          portion_size: product.serving_size || '100g',
          source: 'OpenFoodFacts Barcode',
          ingredients: product.ingredients_text || '',
          allergens: product.allergens || '',
          nutriscore: product.nutriscore_grade || null,
          nova_group: product.nova_group || null,
          image_url: product.image_url || null
        };

        // Analyze ingredients for harmful substances
        let harmfulIngredients = [];
        let processingLevel = 'unprocessed';
        
        if (nutritionData.ingredients) {
          const ingredientAnalysis = await ingredientAnalyzer.analyzeIngredients(
            nutritionData.ingredients,
            userProfile || {}
          );
          harmfulIngredients = ingredientAnalysis.harmfulIngredients;
          processingLevel = ingredientAnalysis.processingLevel;
          
          // Add harmful ingredients to nutrition data
          nutritionData.harmfulIngredients = harmfulIngredients;
          nutritionData.processingLevel = processingLevel;
          nutritionData.healthScore = ingredientAnalysis.healthScore;
        } else {
          // Fallback analysis for processed foods when ingredients aren't available
          const foodName = nutritionData.name.toLowerCase();
          const processedFoodPatterns = {
            'chips': ['chips', 'doritos', 'lays', 'pringles', 'cheetos'],
            'soda': ['cola', 'pepsi', 'coke', 'sprite', 'fanta', 'soda'],
            'fast_food': ['mcdonald', 'burger king', 'kfc', 'pizza hut', 'domino', 'french fries', 'fries'],
            'candy': ['candy', 'chocolate bar', 'snickers', 'kit kat', 'twix'],
            'processed_snacks': ['crackers', 'cookies', 'biscuits', 'wafers']
          };

          let matchedCategory = null;
          for (const [category, patterns] of Object.entries(processedFoodPatterns)) {
            if (patterns.some(pattern => foodName.includes(pattern))) {
              matchedCategory = category;
              break;
            }
          }

          if (matchedCategory) {
            // Assign common harmful ingredients for processed foods
            const commonHarmfulIngredients = {
              'chips': [
                { name: 'MSG (Monosodium Glutamate)', risk: 'high', reason: 'Can cause headaches and nausea' },
                { name: 'Trans Fats', risk: 'high', reason: 'Increases heart disease risk' },
                { name: 'Sodium Benzoate', risk: 'medium', reason: 'Potential carcinogen when combined with vitamin C' },
                { name: 'Artificial Colors', risk: 'medium', reason: 'May cause hyperactivity in children' }
              ],
              'soda': [
                { name: 'Phosphoric Acid', risk: 'high', reason: 'Weakens bones and teeth' },
                { name: 'Aspartame', risk: 'high', reason: 'Artificial sweetener linked to headaches' },
                { name: 'Sodium Benzoate', risk: 'medium', reason: 'Preservative that may form benzene' },
                { name: 'Caramel Color IV', risk: 'medium', reason: 'Contains 4-methylimidazole, a potential carcinogen' }
              ],
              'fast_food': [
                { name: 'Trans Fats', risk: 'high', reason: 'Clogs arteries and raises bad cholesterol' },
                { name: 'Sodium Nitrite', risk: 'high', reason: 'Forms nitrosamines, potential carcinogens' },
                { name: 'High Fructose Corn Syrup', risk: 'medium', reason: 'Linked to obesity and diabetes' }
              ]
            };

            harmfulIngredients = commonHarmfulIngredients[matchedCategory] || [];
            processingLevel = 'ultra_processed';
            
            // Add to nutrition data
            nutritionData.harmfulIngredients = harmfulIngredients;
            nutritionData.processingLevel = processingLevel;
            nutritionData.healthScore = 3; // Low health score for processed foods
          }
        }
        
        const result = {
          success: true,
          nutrition: nutritionData,
          productDetails: {
            categories: product.categories || '',
            labels: product.labels || '',
            countries: product.countries || '',
            stores: product.stores || ''
          }
        };

        // Cache the result
        await cacheService.set(cacheKey, result, 86400); // 24 hours
        
        return result;
      } else {
        throw new Error('Product not found in database');
      }
    } catch (error) {
      console.error('Barcode lookup error:', error.message);
      
      // Try alternative barcode databases
      const alternatives = await this.tryAlternativeBarcodeDatabases(barcode);
      if (alternatives) {
        await cacheService.set(cacheKey, alternatives, 86400);
        return alternatives;
      }

      return {
        success: false,
        error: 'Product not found. Try taking a photo or entering the name manually.',
        barcode: barcode
      };
    }
  }

  // Try alternative barcode databases
  async tryAlternativeBarcodeDatabases(barcode) {
    // Could integrate with:
    // - USDA FoodData Central
    // - Nutritionix barcode API
    // - FatSecret API
    // For now, return null as placeholder
    return null;
  }

  // Enhanced image analysis with multi-item detection
  async analyzeFromImageEnhanced(imageInput, userProfile) {
    try {
      console.log('analyzeFromImageEnhanced called with input length:', imageInput?.length);
      console.log('Input type:', typeof imageInput);
      console.log('Input preview:', imageInput?.substring(0, 100));
      
      // Check if this is a URL
      if (imageInput && (imageInput.startsWith('http://') || imageInput.startsWith('https://'))) {
        console.log('Image is a URL, using URL-based detection:', imageInput);
        return await this.analyzeFromImageURL(imageInput, userProfile);
      }
      
      // Note: Image ID detection is now handled in the server layer by puch-ai-image-fix.js
      // This function should only receive valid base64 data or URLs
      
      // Strip data URI prefix if present
      let cleanBase64 = imageInput;
      if (imageInput.includes('data:image')) {
        cleanBase64 = imageInput.split(',')[1];
      }
      
      // First, try to scan for barcode
      console.log('Checking if image contains a barcode...');
      const barcodeNumber = await barcodeService.scanFromBase64(cleanBase64);
      
      if (barcodeNumber) {
        console.log(`Barcode detected: ${barcodeNumber}`);
        // This is a barcode image, process it as barcode
        return await this.analyzeFromBarcode(barcodeNumber);
      }
      
      // Not a barcode, proceed with food image analysis
      console.log('No barcode found, using enhanced vision analysis...');
      const visionAnalysis = await enhancedVisionService.analyzeImageWithAI(cleanBase64);
      
      if (!visionAnalysis.success) {
        console.log('Vision analysis failed:', visionAnalysis.error);
        // Return user-friendly error instead of throwing
        return {
          success: false,
          error: visionAnalysis.error || 'Could not detect food from image',
          message: 'Could not identify the food in your image. Please describe what you ate (e.g., "2 chapati with dal and rice")',
          needsTextInput: true
        };
      }

      // If single item with high confidence, process immediately
      if (visionAnalysis.detailedAnalysis.length === 1 && 
          visionAnalysis.detailedAnalysis[0].confidence > 0.9) {
        
        const item = visionAnalysis.detailedAnalysis[0];
        const nutritionData = await foodService.searchNutritionix(
          item.name, 
          item.quantity, 
          item.unit
        );

        return {
          success: true,
          nutrition: nutritionData,
          visionResult: visionAnalysis,
          autoConfirmed: true
        };
      }

      // Multiple items or low confidence - need confirmation
      return {
        success: true,
        needsConfirmation: true,
        confirmationMessage: enhancedVisionService.formatConfirmationMessage(visionAnalysis),
        detectedItems: visionAnalysis.detailedAnalysis,
        analysisId: `analysis_${Date.now()}`,
        visionResult: visionAnalysis
      };
    } catch (error) {
      console.error('Enhanced image analysis error:', error);
      // Fallback to basic analysis
      return this.analyzeFromImage(imageBase64);
    }
  }

  // Process user confirmation for multi-item detection
  async processUserConfirmation(analysisId, userInput, userProfile) {
    // This would be stored in a temporary cache in production
    const mockAnalysis = {
      detailedAnalysis: [
        { name: 'grilled chicken', quantity: 4, unit: 'oz' },
        { name: 'brown rice', quantity: 1, unit: 'cup' },
        { name: 'broccoli', quantity: 1, unit: 'cup' }
      ]
    };

    const corrections = enhancedVisionService.parseUserCorrections(
      userInput, 
      mockAnalysis.detailedAnalysis
    );
    
    let finalFoodItems = [...mockAnalysis.detailedAnalysis];
    
    if (!corrections.confirmed) {
      // Apply user corrections
      corrections.updates.forEach(update => {
        if (finalFoodItems[update.index]) {
          finalFoodItems[update.index].name = update.value;
        }
      });
      
      corrections.additions.forEach(item => {
        finalFoodItems.push({ name: item, quantity: 1, unit: 'serving' });
      });
      
      corrections.removals.sort((a, b) => b - a).forEach(index => {
        finalFoodItems.splice(index, 1);
      });
    }

    // Get nutrition for all items
    const nutritionPromises = finalFoodItems.map(item => 
      foodService.searchNutritionix(item.name, item.quantity, item.unit)
    );
    const nutritionResults = await Promise.all(nutritionPromises);
    
    // Calculate totals
    const totalNutrition = this.calculateTotalNutrition(nutritionResults);
    
    // Get personalized message
    const personalizedMessage = await this.getPersonalizedResponse(
      userProfile,
      totalNutrition,
      'multi-item'
    );

    return {
      success: true,
      finalItems: finalFoodItems,
      nutritionData: totalNutrition,
      individualNutrition: nutritionResults,
      personalizedMessage
    };
  }

  // Basic image analysis (fallback)
  async analyzeFromImage(imageInput) {
    try {
      let visionResult;
      
      if (imageInput.startsWith('data:') || imageInput.match(/^[A-Za-z0-9+/=]+$/)) {
        // Base64 image
        console.log('Processing base64 image...');
        visionResult = await visionService.detectFoodFromBase64(imageInput);
      } else {
        // URL
        console.log('Processing image URL...');
        visionResult = await visionService.detectFoodFromImage(imageInput);
      }
      
      if (!visionResult.success || !visionResult.detectedFoods || visionResult.detectedFoods.length === 0) {
        throw new Error('Could not detect food from image');
      }

      const primaryFood = visionResult.primaryFood;
      console.log(`Fetching nutrition for: ${primaryFood}`);
      
      const nutritionData = await foodService.searchNutritionix(primaryFood, 1, 'serving');
      
      nutritionData.detectedFoods = visionResult.detectedFoods;
      nutritionData.imageInput = imageInput.substring(0, 50) + '...';
      nutritionData.detectionMethod = visionResult.mock ? 'mock' : 'vision_api';

      return {
        success: true,
        nutrition: nutritionData,
        visionResult: visionResult
      };
    } catch (error) {
      console.error('Food analysis error:', error);
      return {
        success: false,
        error: error.message,
        nutrition: await foodService.getMockNutritionData('Unknown food', 1)
      };
    }
  }

  // Text analysis with enhanced parsing
  async analyzeFromText(textDescription, userProfile = {}) {
    try {
      console.log(`Analyzing text: "${textDescription}" with GPT-4...`);
      
      // First try GPT-4 for accurate analysis
      const gptResult = await gptFoodAnalyzer.analyzeTextWithGPT(textDescription, userProfile);
      
      if (gptResult.success) {
        console.log('GPT-4 analysis successful:', gptResult.nutrition.name);
        
        // Add harmful ingredients to nutrition data
        if (gptResult.harmfulIngredients && gptResult.harmfulIngredients.length > 0) {
          gptResult.nutrition.harmfulIngredients = gptResult.harmfulIngredients;
          gptResult.nutrition.processingLevel = gptResult.processingLevel;
          gptResult.nutrition.healthScore = gptResult.healthScore;
        }
        
        return {
          success: true,
          nutrition: gptResult.nutrition,
          nutritionData: gptResult.nutrition,
          harmfulIngredients: gptResult.harmfulIngredients,
          betterAlternatives: gptResult.betterAlternatives,
          personalizedWarning: gptResult.personalizedWarning,
          overallAssessment: gptResult.overallAssessment
        };
      }
      
      console.log('GPT-4 failed, falling back to Nutritionix...');
      
      // Fallback to original Nutritionix method
      const parsed = parseFoodDescription(textDescription);
      
      // Check if it might be a recipe
      if (textDescription.split(',').length > 3 || textDescription.includes(' with ')) {
        return await this.analyzeRecipe(textDescription);
      }
      
      // Get nutrition data
      const nutritionData = await foodService.searchNutritionix(
        parsed.foodName,
        parsed.quantity,
        parsed.unit
      );

      // Analyze ingredients for harmful substances
      let harmfulIngredients = [];
      let processingLevel = 'unprocessed';
      
      if (nutritionData.ingredients) {
        const ingredientAnalysis = await ingredientAnalyzer.analyzeIngredients(
          nutritionData.ingredients,
          {} // No user profile available in this context
        );
        harmfulIngredients = ingredientAnalysis.harmfulIngredients;
        processingLevel = ingredientAnalysis.processingLevel;
        
        // Add harmful ingredients to nutrition data
        nutritionData.harmfulIngredients = harmfulIngredients;
        nutritionData.processingLevel = processingLevel;
        nutritionData.healthScore = ingredientAnalysis.healthScore;
      } else {
        // Fallback analysis for processed foods when ingredients aren't available
        const foodName = nutritionData.name.toLowerCase();
        const processedFoodPatterns = {
          'chips': ['chips', 'doritos', 'lays', 'pringles', 'cheetos'],
          'soda': ['cola', 'pepsi', 'coke', 'sprite', 'fanta', 'soda'],
          'fast_food': ['mcdonald', 'burger king', 'kfc', 'pizza hut', 'domino', 'french fries', 'fries'],
          'candy': ['candy', 'chocolate bar', 'snickers', 'kit kat', 'twix'],
          'processed_snacks': ['crackers', 'cookies', 'biscuits', 'wafers']
        };

        let matchedCategory = null;
        for (const [category, patterns] of Object.entries(processedFoodPatterns)) {
          if (patterns.some(pattern => foodName.includes(pattern))) {
            matchedCategory = category;
            break;
          }
        }

        if (matchedCategory) {
          // Assign common harmful ingredients for processed foods
          const commonHarmfulIngredients = {
            'chips': [
              { name: 'MSG (Monosodium Glutamate)', risk: 'high', reason: 'Can cause headaches and nausea' },
              { name: 'Trans Fats', risk: 'high', reason: 'Increases heart disease risk' },
              { name: 'Sodium Benzoate', risk: 'medium', reason: 'Potential carcinogen when combined with vitamin C' },
              { name: 'Artificial Colors', risk: 'medium', reason: 'May cause hyperactivity in children' }
            ],
            'soda': [
              { name: 'Phosphoric Acid', risk: 'high', reason: 'Weakens bones and teeth' },
              { name: 'Aspartame', risk: 'high', reason: 'Artificial sweetener linked to headaches' },
              { name: 'Sodium Benzoate', risk: 'medium', reason: 'Preservative that may form benzene' },
              { name: 'Caramel Color IV', risk: 'medium', reason: 'Contains 4-methylimidazole, a potential carcinogen' }
            ],
            'fast_food': [
              { name: 'Trans Fats', risk: 'high', reason: 'Clogs arteries and raises bad cholesterol' },
              { name: 'Sodium Nitrite', risk: 'high', reason: 'Forms nitrosamines, potential carcinogens' },
              { name: 'High Fructose Corn Syrup', risk: 'medium', reason: 'Linked to obesity and diabetes' }
            ]
          };

          harmfulIngredients = commonHarmfulIngredients[matchedCategory] || [];
          processingLevel = 'ultra_processed';
          
          // Add to nutrition data
          nutritionData.harmfulIngredients = harmfulIngredients;
          nutritionData.processingLevel = processingLevel;
          nutritionData.healthScore = 3; // Low health score for processed foods
        }
      }

      return {
        success: true,
        nutrition: nutritionData,
        parsed: parsed
      };
    } catch (error) {
      console.error('Text analysis error:', error);
      return {
        success: false,
        error: error.message,
        nutrition: await foodService.getMockNutritionData(textDescription, 1)
      };
    }
  }

  // Analyze complex recipes or multi-ingredient foods
  async analyzeRecipe(recipeText) {
    const ingredients = recipeText.split(/,|with|and/).map(s => s.trim());
    const nutritionPromises = ingredients.map(ing => {
      const parsed = parseFoodDescription(ing);
      return foodService.searchNutritionix(parsed.foodName, parsed.quantity, parsed.unit);
    });
    
    const nutritionResults = await Promise.all(nutritionPromises);
    const totalNutrition = this.calculateTotalNutrition(nutritionResults);
    
    totalNutrition.name = 'Custom recipe';
    totalNutrition.ingredients = ingredients;
    
    return {
      success: true,
      nutrition: totalNutrition,
      isRecipe: true,
      ingredientDetails: nutritionResults
    };
  }

  // Calculate total nutrition from multiple items
  calculateTotalNutrition(nutritionArray) {
    const totals = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      sugar: 0,
      sodium: 0
    };
    
    nutritionArray.forEach(item => {
      totals.calories += item.calories || 0;
      totals.protein += item.protein || 0;
      totals.carbs += item.carbs || 0;
      totals.fat += item.fat || 0;
      totals.fiber += item.fiber || 0;
      totals.sugar += item.sugar || 0;
      totals.sodium += item.sodium || 0;
    });
    
    return totals;
  }

  // Get personalized response based on user profile
  async getPersonalizedResponse(userProfile, nutritionData, inputType) {
    // Check if nutritionData exists
    if (!nutritionData) {
      return 'Unable to analyze nutrition data';
    }
    
    // Use enhanced vision service for AI-powered responses
    const foodItems = nutritionData.ingredients 
      ? (Array.isArray(nutritionData.ingredients) 
          ? nutritionData.ingredients.map(i => ({ name: i }))
          : [{ name: nutritionData.name || 'Unknown food' }])
      : [{ name: nutritionData.name || 'Unknown food' }];
    
    const personalizedMessage = await enhancedVisionService.getPersonalizedRecommendations(
      userProfile,
      foodItems,
      nutritionData
    );
    
    // Add input-type specific messages
    let additionalMessage = '';
    
    if (inputType === 'barcode') {
      additionalMessage = '\n\n💡 Tip: Check the ingredients list for hidden sugars and additives!';
    } else if (inputType === 'multi-item') {
      additionalMessage = '\n\n🍽️ Great job logging a complete meal! This helps track nutrition more accurately.';
    }
    
    return personalizedMessage + additionalMessage;
  }

  // Analyze food for specific health conditions
  async analyzeForHealth(nutritionData, healthConditions = []) {
    const warnings = [];
    const recommendations = [];
    const pros = [];
    const cons = [];
    let riskLevel = 'low';

    // Enhanced health analysis
    if (healthConditions.includes('diabetes')) {
      if (nutritionData.sugar && nutritionData.sugar > 10) {
        warnings.push({
          condition: 'diabetes',
          severity: 'high',
          message: `High sugar content (${nutritionData.sugar}g) - May cause blood sugar spike`
        });
        riskLevel = 'high';
      }
      
      if (nutritionData.carbs > 30 && (!nutritionData.fiber || nutritionData.fiber < 3)) {
        warnings.push({
          condition: 'diabetes',
          severity: 'medium',
          message: 'High carbs with low fiber - Consider smaller portion'
        });
        if (riskLevel === 'low') riskLevel = 'medium';
      }

      if (nutritionData.fiber && nutritionData.fiber > 5) {
        pros.push('High fiber helps regulate blood sugar');
      }
    }

    // Hypertension analysis
    if (healthConditions.includes('hypertension')) {
      if (nutritionData.sodium && nutritionData.sodium > 600) {
        warnings.push({
          condition: 'hypertension',
          severity: 'high',
          message: `Very high sodium (${nutritionData.sodium}mg) - Avoid or limit portion`
        });
        riskLevel = 'high';
      } else if (nutritionData.sodium && nutritionData.sodium > 400) {
        warnings.push({
          condition: 'hypertension',
          severity: 'medium',
          message: `High sodium (${nutritionData.sodium}mg) - Consume in moderation`
        });
        if (riskLevel === 'low') riskLevel = 'medium';
      }
    }

    // Pregnancy analysis
    if (healthConditions.includes('pregnancy')) {
      const foodName = nutritionData.name.toLowerCase();
      
      const avoidFoods = ['sushi', 'raw fish', 'unpasteurized', 'soft cheese', 'alcohol', 'raw meat'];
      if (avoidFoods.some(food => foodName.includes(food))) {
        warnings.push({
          condition: 'pregnancy',
          severity: 'high',
          message: 'Not recommended during pregnancy - may pose health risks'
        });
        riskLevel = 'high';
      }

      if (foodName.includes('coffee') || foodName.includes('tea') || foodName.includes('cola')) {
        warnings.push({
          condition: 'pregnancy',
          severity: 'medium',
          message: 'Contains caffeine - limit to 200mg per day during pregnancy'
        });
      }

      if (nutritionData.protein > 20) {
        pros.push('High protein - important for fetal development');
      }
    }

    // Allergy checks
    const allergyMap = {
      'nut_allergy': ['nut', 'almond', 'cashew', 'peanut', 'walnut', 'pecan', 'hazelnut', 'pistachio'],
      'lactose_intolerant': ['milk', 'cheese', 'yogurt', 'cream', 'butter', 'dairy', 'whey', 'casein'],
      'gluten_intolerant': ['wheat', 'bread', 'pasta', 'flour', 'barley', 'rye', 'malt', 'beer'],
      'seafood_allergy': ['fish', 'shrimp', 'crab', 'lobster', 'shellfish', 'seafood', 'oyster', 'clam']
    };

    for (const [condition, triggers] of Object.entries(allergyMap)) {
      if (healthConditions.includes(condition)) {
        const foodName = nutritionData.name.toLowerCase();
        const ingredients = nutritionData.ingredients ? nutritionData.ingredients.toLowerCase() : '';
        
        if (triggers.some(trigger => foodName.includes(trigger) || ingredients.includes(trigger))) {
          warnings.push({
            condition: condition,
            severity: 'high',
            message: `🚨 ALLERGY ALERT: Contains ${condition.replace('_', ' ').replace('allergy', 'allergen')}`
          });
          riskLevel = 'high';
        }
      }
    }

    // General nutritional analysis
    if (nutritionData.calories > 500) {
      cons.push(`Very high calorie (${nutritionData.calories}cal) - 25% of daily intake`);
    }
    
    if (nutritionData.fat > 20) {
      cons.push(`High fat (${nutritionData.fat}g)`);
    }
    
    if (nutritionData.sugar && nutritionData.sugar > 20) {
      cons.push(`High sugar (${nutritionData.sugar}g) - limit intake`);
    }

    // Positive nutritional aspects
    if (nutritionData.protein > 15) {
      pros.push(`Excellent protein source (${nutritionData.protein}g)`);
    }
    
    if (nutritionData.fiber && nutritionData.fiber > 5) {
      pros.push(`High fiber (${nutritionData.fiber}g) - aids digestion`);
    }

    // Nutriscore integration if available
    if (nutritionData.nutriscore) {
      const nutriscoreMessages = {
        'a': '🟢 Excellent nutritional quality (Nutri-Score A)',
        'b': '🟢 Good nutritional quality (Nutri-Score B)',
        'c': '🟡 Average nutritional quality (Nutri-Score C)',
        'd': '🟠 Poor nutritional quality (Nutri-Score D)',
        'e': '🔴 Very poor nutritional quality (Nutri-Score E)'
      };
      
      const nutriMessage = nutriscoreMessages[nutritionData.nutriscore.toLowerCase()];
      if (nutriMessage) {
        if (nutritionData.nutriscore.toLowerCase() <= 'b') {
          pros.push(nutriMessage);
        } else {
          cons.push(nutriMessage);
        }
      }
    }

    // Default pros/cons if none identified
    if (pros.length === 0) {
      if (nutritionData.calories < 200) pros.push('Low calorie option');
      else pros.push('Provides energy');
    }
    
    if (cons.length === 0 && warnings.length === 0) {
      cons.push('No significant concerns for your health profile');
    }

    // Generate personalized recommendation
    let recommendation;
    if (riskLevel === 'high') {
      recommendation = '❌ NOT RECOMMENDED based on your health conditions';
    } else if (riskLevel === 'medium') {
      recommendation = '⚠️ CONSUME WITH CAUTION - Check portion size';
    } else {
      recommendation = '✅ SAFE TO CONSUME - Fits your health profile';
    }

    // Add portion suggestions
    if (riskLevel !== 'low' && nutritionData.portion_size) {
      recommendations.push(`Consider having half portion (${nutritionData.portion_size.split(' ')[0]/2} ${nutritionData.portion_size.split(' ')[1]})`);
    }

    // Add alternatives for high-risk foods
    if (riskLevel === 'high') {
      recommendations.push(this.suggestHealthierAlternatives(nutritionData.name, healthConditions));
    }

    return {
      warnings,
      pros,
      cons,
      recommendations,
      riskLevel,
      overallRecommendation: recommendation
    };
  }

  // Suggest healthier alternatives
  suggestHealthierAlternatives(foodName, healthConditions) {
    const alternatives = {
      'white bread': 'Try whole grain or ezekiel bread',
      'white rice': 'Try brown rice or quinoa',
      'soda': 'Try sparkling water with lemon',
      'candy': 'Try fresh fruit or dark chocolate (70%+ cacao)',
      'chips': 'Try air-popped popcorn or vegetable chips',
      'ice cream': 'Try frozen yogurt or banana nice cream',
      'pizza': 'Try cauliflower crust pizza',
      'pasta': 'Try zucchini noodles or whole wheat pasta',
      'french fries': 'Try baked sweet potato fries',
      'burger': 'Try turkey burger or veggie burger'
    };

    const lowerFood = foodName.toLowerCase();
    for (const [food, alternative] of Object.entries(alternatives)) {
      if (lowerFood.includes(food)) {
        return alternative;
      }
    }

    return 'Consider a lower calorie, nutrient-dense alternative';
  }

  // Analyze image from URL
  async analyzeFromImageURL(imageUrl, userProfile) {
    try {
      console.log('Analyzing image from URL:', imageUrl);
      
      // Use vision service to detect food from URL
      const visionResult = await visionService.detectFoodFromImage(imageUrl);
      
      if (!visionResult.success || !visionResult.detectedFoods || visionResult.detectedFoods.length === 0) {
        // Try with enhanced vision service
        if (enhancedVisionService.openaiClient) {
          // Download image and convert to base64 for OpenAI
          const axios = require('axios');
          const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
          const base64 = Buffer.from(response.data, 'binary').toString('base64');
          return await enhancedVisionService.analyzeWithOpenAI(base64);
        }
        
        return {
          success: false,
          error: 'Could not detect food from image URL',
          message: this.getImageFallbackMessage(),
          needsTextInput: true
        };
      }
      
      // Process detected foods
      const detailedAnalysis = await enhancedVisionService.enhanceDetectionResults(visionResult.detectedFoods);
      
      return {
        success: true,
        detailedAnalysis,
        needsConfirmation: detailedAnalysis.length > 1,
        primaryFood: detailedAnalysis[0]?.name || visionResult.primaryFood
      };
    } catch (error) {
      console.error('URL image analysis error:', error);
      return {
        success: false,
        error: error.message,
        message: this.getImageFallbackMessage(),
        needsTextInput: true
      };
    }
  }

  // Get fallback message for image ID inputs
  getImageFallbackMessage() {
    const commonMeals = [
      "rice and dal",
      "chapati with sabzi", 
      "idli sambar",
      "dosa",
      "biryani",
      "paneer curry",
      "chicken curry",
      "salad",
      "sandwich",
      "pasta",
      "paneer tikka",
      "butter chicken"
    ];
    
    const randomMeals = commonMeals.sort(() => 0.5 - Math.random()).slice(0, 3);
    
    return `🔍 IMAGE ANALYSIS PENDING

I received an image reference but not the actual image data. To analyze your food properly, I need you to either:

1. 📝 Tell me what you ate (e.g., "${randomMeals[0]}")
2. 📸 Try uploading the image again

Once you tell me what it is, I'll provide:
• Complete nutritional breakdown
• Health analysis based on your profile
• Ingredient warnings (if applicable)
• Personalized recommendations

What food would you like me to analyze?`;
  }
}

module.exports = new EnhancedFoodAnalysisService();