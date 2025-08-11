const visionService = require('./visionService');
const foodService = require('./foodService');
const openai = require('openai');

class EnhancedVisionService {
  constructor() {
    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  async analyzeImageWithAI(imageBase64) {
    try {
      // First try Google Vision API
      const visionResult = await visionService.detectFoodFromBase64(imageBase64);
      
      if (!visionResult.success || !visionResult.detectedFoods || visionResult.detectedFoods.length === 0) {
        console.log('Google Vision found no food items, attempting OpenAI fallback...');
        // Fallback to OpenAI if available
        if (this.openaiClient) {
          try {
            const openAiResult = await this.analyzeWithOpenAI(imageBase64);
            console.log('OpenAI analysis result:', openAiResult);
            return openAiResult;
          } catch (openAiError) {
            console.error('OpenAI fallback failed:', openAiError.message);
            // Return a generic result to allow manual input
            return {
              success: false,
              error: 'Could not detect food from image. Please describe what you ate.',
              detailedAnalysis: [],
              needsConfirmation: true
            };
          }
        }
        console.log('OpenAI not configured, returning generic error');
        return {
          success: false,
          error: 'Could not detect food from image. Please describe what you ate.',
          detailedAnalysis: [],
          needsConfirmation: true
        };
      }

      // Enhance detection with portion estimation
      const detailedAnalysis = await this.enhanceDetectionResults(visionResult.detectedFoods);
      
      return {
        success: true,
        detailedAnalysis,
        needsConfirmation: detailedAnalysis.length > 1 || detailedAnalysis.some(item => item.confidence < 0.8),
        primaryFood: detailedAnalysis[0]?.name || visionResult.primaryFood
      };
    } catch (error) {
      console.error('Enhanced vision analysis error:', error);
      return {
        success: false,
        error: error.message,
        detailedAnalysis: [],
        needsConfirmation: true
      };
    }
  }

  async analyzeWithOpenAI(imageBase64) {
    try {
      if (!this.openaiClient) {
        throw new Error('OpenAI client not configured');
      }

      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          {
            role: "system",
            content: "You are a nutrition expert. Analyze the food in the image and provide detailed information about each food item, including estimated portions."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Identify all food items in this image with their approximate portions. Format your response as a JSON array with objects containing: name, quantity, unit, confidence (0-1)"
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`
                }
              }
            ]
          }
        ],
        max_tokens: 500
      });

      const content = response.choices[0].message.content;
      
      // Parse AI response
      let detectedItems = [];
      try {
        // Extract JSON from response
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          detectedItems = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error('Failed to parse OpenAI response:', parseError);
        // Fallback parsing
        detectedItems = this.parseTextResponse(content);
      }

      return {
        success: true,
        detailedAnalysis: detectedItems,
        needsConfirmation: true,
        primaryFood: detectedItems[0]?.name || 'Unknown food'
      };
    } catch (error) {
      console.error('OpenAI analysis error:', error);
      throw error;
    }
  }

  async enhanceDetectionResults(detectedFoods) {
    const enhanced = [];
    
    for (const food of detectedFoods) {
      const foodName = typeof food === 'string' ? food : food.name;
      
      // Estimate portion size based on common patterns
      const portionInfo = this.estimatePortion(foodName);
      
      enhanced.push({
        name: foodName,
        quantity: portionInfo.quantity,
        unit: portionInfo.unit,
        confidence: food.confidence || 0.7,
        category: this.categorizeFood(foodName)
      });
    }
    
    return enhanced;
  }

  estimatePortion(foodName) {
    // Common portion patterns
    const portionPatterns = {
      'bread': { quantity: 2, unit: 'slices' },
      'rice': { quantity: 1, unit: 'cup' },
      'pasta': { quantity: 1, unit: 'cup' },
      'chicken': { quantity: 4, unit: 'oz' },
      'fish': { quantity: 4, unit: 'oz' },
      'salad': { quantity: 2, unit: 'cups' },
      'pizza': { quantity: 2, unit: 'slices' },
      'sandwich': { quantity: 1, unit: 'sandwich' },
      'apple': { quantity: 1, unit: 'medium' },
      'banana': { quantity: 1, unit: 'medium' },
      'egg': { quantity: 2, unit: 'eggs' },
      'milk': { quantity: 1, unit: 'cup' },
      'coffee': { quantity: 1, unit: 'cup' },
      'juice': { quantity: 8, unit: 'oz' }
    };

    const lowerFood = foodName.toLowerCase();
    
    // Check for exact matches
    for (const [pattern, portion] of Object.entries(portionPatterns)) {
      if (lowerFood.includes(pattern)) {
        return portion;
      }
    }
    
    // Default portion
    return { quantity: 1, unit: 'serving' };
  }

  categorizeFood(foodName) {
    const categories = {
      protein: ['chicken', 'fish', 'meat', 'egg', 'tofu', 'beans', 'lentils'],
      carbs: ['bread', 'rice', 'pasta', 'potato', 'cereal', 'oats'],
      vegetables: ['salad', 'broccoli', 'carrot', 'spinach', 'tomato', 'cucumber'],
      fruits: ['apple', 'banana', 'orange', 'berries', 'mango', 'grapes'],
      dairy: ['milk', 'cheese', 'yogurt', 'butter'],
      beverages: ['water', 'juice', 'coffee', 'tea', 'soda']
    };

    const lowerFood = foodName.toLowerCase();
    
    for (const [category, foods] of Object.entries(categories)) {
      if (foods.some(food => lowerFood.includes(food))) {
        return category;
      }
    }
    
    return 'other';
  }

  formatConfirmationMessage(analysisResult) {
    if (!analysisResult.success || !analysisResult.detailedAnalysis) {
      return 'Could not analyze the image. Please try again or describe the food manually.';
    }

    let message = '🔍 I detected the following items in your image:\n\n';
    
    analysisResult.detailedAnalysis.forEach((item, index) => {
      message += `${index + 1}. ${item.name} - ${item.quantity} ${item.unit}\n`;
    });
    
    message += '\n✅ Is this correct? You can:\n';
    message += '• Say "yes" to confirm all items\n';
    message += '• Update specific items (e.g., "change 1 to grilled chicken breast")\n';
    message += '• Add missing items (e.g., "add 1 cup of brown rice")\n';
    message += '• Remove items (e.g., "remove item 2")\n';
    
    return message;
  }

  parseUserCorrections(userInput, detectedItems) {
    const input = userInput.toLowerCase();
    const corrections = {
      confirmed: false,
      updates: [],
      additions: [],
      removals: []
    };

    // Check for confirmation
    if (input.includes('yes') || input.includes('correct') || input.includes('confirm')) {
      corrections.confirmed = true;
      return corrections;
    }

    // Parse updates
    const updatePattern = /(?:change|update)\s+(?:item\s+)?(\d+)\s+to\s+(.+?)(?:\.|,|$)/gi;
    let match;
    while ((match = updatePattern.exec(input)) !== null) {
      corrections.updates.push({
        index: parseInt(match[1]) - 1,
        value: match[2].trim()
      });
    }

    // Parse additions
    const addPattern = /add\s+(.+?)(?:\.|,|$)/gi;
    while ((match = addPattern.exec(input)) !== null) {
      corrections.additions.push(match[1].trim());
    }

    // Parse removals
    const removePattern = /remove\s+(?:item\s+)?(\d+)/gi;
    while ((match = removePattern.exec(input)) !== null) {
      corrections.removals.push(parseInt(match[1]) - 1);
    }

    return corrections;
  }

  parseTextResponse(text) {
    // Fallback parser for non-JSON responses
    const items = [];
    const lines = text.split('\n');
    
    for (const line of lines) {
      // Look for patterns like "1. Apple - 1 medium"
      const match = line.match(/\d+\.\s*(.+?)\s*-\s*(\d+)\s*(.+)/);
      if (match) {
        items.push({
          name: match[1].trim(),
          quantity: parseFloat(match[2]),
          unit: match[3].trim(),
          confidence: 0.6
        });
      }
    }
    
    return items.length > 0 ? items : [{
      name: 'Unknown food',
      quantity: 1,
      unit: 'serving',
      confidence: 0.3
    }];
  }

  // Get personalized food recommendations based on user profile
  async getPersonalizedRecommendations(userProfile, foodItems, nutritionData) {
    if (!this.openaiClient) {
      return this.getBasicRecommendations(userProfile, nutritionData);
    }

    try {
      const prompt = this.buildPersonalizedPrompt(userProfile, foodItems, nutritionData);
      
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are a personal nutritionist providing friendly, encouraging advice. Keep responses concise and actionable."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 300,
        temperature: 0.7
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Failed to get personalized recommendations:', error);
      return this.getBasicRecommendations(userProfile, nutritionData);
    }
  }

  buildPersonalizedPrompt(userProfile, foodItems, nutritionData) {
    let prompt = `User Profile:
- Name: ${userProfile.name}
- Age: ${userProfile.age}
- Gender: ${userProfile.gender}
- Health conditions: ${userProfile.health_conditions.join(', ')}
- Daily targets: ${userProfile.calorie_target} cal, ${userProfile.protein_target}g protein

Current meal: ${foodItems.map(f => f.name).join(', ')}
Nutrition: ${nutritionData.calories} cal, ${nutritionData.protein}g protein, ${nutritionData.carbs}g carbs, ${nutritionData.fat}g fat

Provide a brief, personalized response (2-3 sentences) that:
1. Acknowledges their meal choice
2. Gives specific advice based on their health conditions
3. Suggests one improvement for next time
Use their name and be encouraging!`;

    return prompt;
  }

  getBasicRecommendations(userProfile, nutritionData) {
    let message = `Great job tracking your meal, ${userProfile.name}! `;
    
    // Basic personalized advice
    if (userProfile.health_conditions.includes('diabetes') && nutritionData.sugar > 15) {
      message += 'This meal is quite high in sugar. Consider pairing it with protein or fiber to slow absorption. ';
    } else if (userProfile.health_conditions.includes('hypertension') && nutritionData.sodium > 600) {
      message += 'Watch the sodium content in this meal. Try seasoning with herbs and spices instead of salt next time. ';
    } else {
      message += 'This meal provides good energy. ';
    }
    
    // Progress encouragement
    const calorieProgress = (nutritionData.calories / userProfile.calorie_target) * 100;
    if (calorieProgress < 30) {
      message += `You're at ${Math.round(calorieProgress)}% of your daily calories - plenty of room for nutritious choices today!`;
    } else if (calorieProgress < 70) {
      message += `You're making good progress toward your daily goals. Keep balancing your meals!`;
    } else {
      message += `You're close to your daily targets. Consider lighter options for your remaining meals.`;
    }
    
    return message;
  }
}

module.exports = new EnhancedVisionService();