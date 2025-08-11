const openai = require('openai');

class GPTFoodAnalyzer {
  constructor() {
    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  async analyzeTextWithGPT(foodDescription, userProfile = {}) {
    if (!this.openaiClient) {
      console.error('OpenAI client not initialized - API key missing');
      return this.getFallbackAnalysis(foodDescription);
    }

    try {
      console.log(`GPT-4 analyzing: "${foodDescription}"`);
      
      const systemPrompt = `You are a nutrition and food safety expert. Analyze the food described and return detailed nutrition information and ingredient analysis.

For the food described, you must:
1. Identify exactly what food it is (be specific about brand if mentioned)
2. Provide accurate nutrition data per serving
3. List ingredients that may have health impacts
4. Provide balanced health assessment based on the user's conditions
5. Suggest healthier alternatives

IMPORTANT: Use moderate, factual language. Avoid extreme terms like 'toxic', 'poison', 'cancer', 'death', etc. Focus on educational information about health impacts

User Health Profile:
- Health Conditions: ${JSON.stringify(userProfile.health_conditions || ['none'])}
- Dietary Restrictions: ${JSON.stringify(userProfile.dietary_restrictions || ['none'])}
- Health Goals: ${JSON.stringify(userProfile.health_goals || ['general health'])}

Return ONLY valid JSON in this exact format:
{
  "name": "exact food name with brand",
  "brand": "brand name or null",
  "portion_size": "1 serving (amount)",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "fiber": number,
  "sugar": number,
  "sodium": number,
  "ingredients": "full ingredient list as string",
  "harmfulIngredients": [
    {
      "name": "ingredient name",
      "severity": "critical|high|medium|low",
      "risks": ["risk1", "risk2"],
      "whyBad": "simple explanation"
    }
  ],
  "processingLevel": "ultra_processed|processed|minimally_processed|unprocessed",
  "healthScore": number (0-100),
  "allergens": ["allergen1", "allergen2"],
  "betterAlternatives": [
    {
      "name": "alternative food",
      "whyBetter": "reason"
    }
  ],
  "personalizedWarning": "specific warning for this user's conditions",
  "overallAssessment": "brief assessment"
}`;

      const userPrompt = `Analyze this food: "${foodDescription}"`;

      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 1500
      });

      const response = completion.choices[0].message.content;
      
      // Parse JSON response
      let analysis;
      try {
        // Clean up response if needed (sometimes GPT adds markdown)
        let cleanResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        // Fix common GPT formatting issues
        // Replace "10g" with 10 in numeric fields
        cleanResponse = cleanResponse.replace(/"(calories|protein|carbs|fat|fiber|sugar|sodium)":\s*(\d+)g/g, '"$1": $2');
        cleanResponse = cleanResponse.replace(/"(calories|protein|carbs|fat|fiber|sugar|sodium)":\s*(\d+)mg/g, '"$1": $2');
        
        analysis = JSON.parse(cleanResponse);
      } catch (parseError) {
        console.error('Failed to parse GPT response:', response);
        throw new Error('Invalid response format from AI');
      }

      // Ensure all required fields and proper data types
      return {
        success: true,
        nutrition: {
          name: analysis.name || 'Unknown food',
          brand: analysis.brand || null,
          portion_size: analysis.portion_size || '1 serving',
          calories: parseInt(analysis.calories) || 0,
          protein: parseFloat(analysis.protein) || 0,
          carbs: parseFloat(analysis.carbs) || 0,
          fat: parseFloat(analysis.fat) || 0,
          fiber: parseFloat(analysis.fiber) || 0,
          sugar: parseFloat(analysis.sugar) || 0,
          sodium: parseFloat(analysis.sodium) || 0,
          ingredients: analysis.ingredients || '',
          allergens: Array.isArray(analysis.allergens) ? analysis.allergens : [],
          source: 'GPT-4 Analysis'
        },
        harmfulIngredients: Array.isArray(analysis.harmfulIngredients) ? analysis.harmfulIngredients : [],
        processingLevel: analysis.processingLevel || 'processed',
        healthScore: parseInt(analysis.healthScore) || 50,
        betterAlternatives: Array.isArray(analysis.betterAlternatives) ? analysis.betterAlternatives : [],
        personalizedWarning: analysis.personalizedWarning || '',
        overallAssessment: analysis.overallAssessment || ''
      };

    } catch (error) {
      console.error('GPT food analysis error:', error);
      
      // Fallback to basic analysis for common foods
      return this.getFallbackAnalysis(foodDescription);
    }
  }

  getFallbackAnalysis(foodDescription) {
    const food = foodDescription.toLowerCase();
    
    // Common processed foods database
    const processedFoods = {
      'bhujia': {
        name: 'Bikano Bhujia',
        brand: 'Bikano',
        calories: 188,
        protein: 6,
        carbs: 12,
        fat: 13,
        sodium: 628,
        harmfulIngredients: [
          {
            name: 'Palm Oil',
            severity: 'medium',
            risks: ['cardiovascular concerns', 'cholesterol impact'],
            whyBad: 'Contains saturated fats'
          },
          {
            name: 'High Sodium Content',
            severity: 'medium',
            risks: ['blood pressure concerns', 'water retention'],
            whyBad: 'May affect cardiovascular health'
          },
          {
            name: 'Food Additives',
            severity: 'low',
            risks: ['digestive sensitivity', 'individual reactions'],
            whyBad: 'Some people may be sensitive to additives'
          }
        ],
        processingLevel: 'processed',
        healthScore: 35
      },
      'lays chips': {
        name: 'Lay\'s Classic Potato Chips',
        brand: 'Lay\'s',
        calories: 160,
        protein: 2,
        carbs: 15,
        fat: 10,
        sodium: 170,
        harmfulIngredients: [
          {
            name: 'Monosodium Glutamate (MSG)',
            severity: 'medium',
            risks: ['headaches', 'sensitivity reactions'],
            whyBad: 'May cause reactions in sensitive individuals'
          },
          {
            name: 'Artificial Colors (Yellow 6)',
            severity: 'medium',
            risks: ['hyperactivity', 'allergic reactions'],
            whyBad: 'Petroleum-based dye linked to behavioral issues'
          },
          {
            name: 'Trans Fats',
            severity: 'high',
            risks: ['cardiovascular concerns', 'metabolic issues'],
            whyBad: 'Unhealthy fats that affect heart health'
          }
        ],
        processingLevel: 'ultra_processed',
        healthScore: 15
      },
      'coca cola': {
        name: 'Coca-Cola Classic',
        brand: 'Coca-Cola',
        calories: 140,
        protein: 0,
        carbs: 39,
        fat: 0,
        sugar: 39,
        sodium: 45,
        harmfulIngredients: [
          {
            name: 'High Fructose Corn Syrup',
            severity: 'medium',
            risks: ['weight gain', 'metabolic concerns'],
            whyBad: 'May affect metabolism and satiety'
          },
          {
            name: 'Phosphoric Acid',
            severity: 'medium',
            risks: ['dental health', 'mineral absorption'],
            whyBad: 'May affect calcium absorption'
          },
          {
            name: 'Caramel Color IV',
            severity: 'medium',
            risks: ['health concerns', 'regulatory scrutiny'],
            whyBad: 'Contains compounds under study'
          }
        ],
        processingLevel: 'ultra_processed',
        healthScore: 5
      },
      'maggi': {
        name: 'Maggi 2-Minute Noodles',
        brand: 'Nestle',
        calories: 315,
        protein: 7,
        carbs: 46,
        fat: 11,
        sodium: 860,
        harmfulIngredients: [
          {
            name: 'MSG',
            severity: 'medium',
            risks: ['headaches', 'sensitivity reactions'],
            whyBad: 'May trigger reactions in some people'
          },
          {
            name: 'Trans Fats',
            severity: 'high',
            risks: ['cardiovascular concerns'],
            whyBad: 'Affects cholesterol levels'
          },
          {
            name: 'TBHQ',
            severity: 'medium',
            risks: ['potential health effects'],
            whyBad: 'Synthetic preservative'
          },
          {
            name: 'Quality Control Issues',
            severity: 'medium',
            risks: ['quality concerns'],
            whyBad: 'Past quality control issues'
          }
        ],
        processingLevel: 'ultra_processed',
        healthScore: 10
      }
    };

    // Check if we have data for this food
    for (const [key, data] of Object.entries(processedFoods)) {
      if (food.includes(key)) {
        return {
          success: true,
          nutrition: {
            ...data,
            portion_size: '1 serving',
            fiber: data.fiber || 1,
            sugar: data.sugar || 5,
            ingredients: 'Various processed ingredients',
            allergens: [],
            source: 'Fallback Database'
          },
          harmfulIngredients: data.harmfulIngredients,
          processingLevel: data.processingLevel,
          healthScore: data.healthScore,
          betterAlternatives: [
            { name: 'Baked chips', whyBetter: 'No trans fats or MSG' },
            { name: 'Air-popped popcorn', whyBetter: 'Whole grain, minimal processing' }
          ]
        };
      }
    }

    // Generic processed food response
    return {
      success: false,
      error: 'Could not analyze this food'
    };
  }
}

module.exports = new GPTFoodAnalyzer();