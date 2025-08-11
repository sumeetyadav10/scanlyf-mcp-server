const OpenAI = require('openai');

class HealthAnalysisService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  async generatePersonalizedReport(userProfile, foodItems, nutritionData) {
    try {
      // Prepare comprehensive prompt with user context
      const prompt = this.buildAnalysisPrompt(userProfile, foodItems, nutritionData);
      
      const response = await this.openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: `You are a expert nutritionist and health advisor. Create a personalized nutrition analysis that includes:
1. Overall meal assessment
2. Pros (benefits) of the meal
3. Cons (concerns) based on user's health conditions
4. Specific warnings for health conditions
5. Personalized recommendations
6. Detailed nutrient breakdown (not just calories)
7. Encouraging message tailored to user's goals

Be supportive but honest about health concerns. Use emojis sparingly for key points.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.7
      });

      const analysis = response.choices[0].message.content;
      return this.formatHealthReport(analysis, userProfile, nutritionData);
      
    } catch (error) {
      console.error('Health analysis error:', error);
      // Fallback to basic analysis
      return this.generateBasicHealthReport(userProfile, foodItems, nutritionData);
    }
  }

  buildAnalysisPrompt(userProfile, foodItems, nutritionData) {
    return `
User Profile:
- Name: ${userProfile.name}
- Age: ${userProfile.age}, ${userProfile.gender}
- BMI: ${this.calculateBMI(userProfile.height_cm, userProfile.weight_kg)}
- Health Conditions: ${userProfile.health_conditions.join(', ') || 'None'}
- Daily Targets: ${userProfile.calorie_target} cal, ${userProfile.protein_target}g protein

Meal Consumed:
${foodItems.map(item => `- ${item.name} (${item.portion || '1 serving'})`).join('\n')}

Nutrition Totals:
- Calories: ${nutritionData.calories}
- Protein: ${nutritionData.protein}g
- Carbs: ${nutritionData.carbs}g
- Fat: ${nutritionData.fat}g
- Fiber: ${nutritionData.fiber}g
- Sugar: ${nutritionData.sugar}g
- Sodium: ${nutritionData.sodium}mg

Please provide a comprehensive health analysis.`;
  }

  formatHealthReport(aiAnalysis, userProfile, nutritionData) {
    const report = {
      greeting: this.getPersonalizedGreeting(userProfile),
      aiAnalysis: aiAnalysis,
      quickStats: {
        caloriePercentage: Math.round((nutritionData.calories / userProfile.calorie_target) * 100),
        proteinPercentage: Math.round((nutritionData.protein / userProfile.protein_target) * 100),
        carbPercentage: Math.round((nutritionData.carbs / userProfile.carb_target) * 100),
        fatPercentage: Math.round((nutritionData.fat / userProfile.fat_target) * 100)
      },
      healthAlerts: this.generateHealthAlerts(userProfile, nutritionData),
      encouragement: this.getEncouragement(userProfile, nutritionData)
    };
    
    return report;
  }

  generateHealthAlerts(userProfile, nutritionData) {
    const alerts = [];
    
    // Diabetes alerts
    if (userProfile.health_conditions.includes('diabetes')) {
      if (nutritionData.sugar > 25) {
        alerts.push({
          type: 'warning',
          condition: 'diabetes',
          message: '⚠️ High sugar content detected. Consider smaller portions or sugar-free alternatives.'
        });
      }
      if (nutritionData.carbs > 60) {
        alerts.push({
          type: 'caution',
          condition: 'diabetes',
          message: '📊 High carb meal. Monitor blood sugar levels after eating.'
        });
      }
    }
    
    // Hypertension alerts
    if (userProfile.health_conditions.includes('hypertension')) {
      if (nutritionData.sodium > 600) {
        alerts.push({
          type: 'warning',
          condition: 'hypertension',
          message: '🧂 High sodium content! This may affect your blood pressure.'
        });
      }
    }
    
    // Pregnancy alerts
    if (userProfile.health_conditions.includes('pregnancy')) {
      if (nutritionData.protein < 20) {
        alerts.push({
          type: 'info',
          condition: 'pregnancy',
          message: '🤰 Consider adding more protein for baby\'s development.'
        });
      }
    }
    
    return alerts;
  }

  getPersonalizedGreeting(userProfile) {
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    
    const progressGreeting = userProfile.streak_days > 0 
      ? `You're on a ${userProfile.streak_days}-day streak! 🔥`
      : 'Welcome back! Let\'s build healthy habits together.';
    
    return `${timeGreeting}, ${userProfile.name}! ${progressGreeting}`;
  }

  getEncouragement(userProfile, nutritionData) {
    const messages = [];
    
    // Protein goal achievement
    if (nutritionData.protein >= userProfile.protein_target * 0.9) {
      messages.push('💪 Excellent protein intake! Your muscles will thank you.');
    }
    
    // Fiber intake
    if (nutritionData.fiber >= 8) {
      messages.push('🌾 Great fiber content! Good for digestion.');
    }
    
    // Balanced meal
    const macroBalance = this.checkMacroBalance(nutritionData);
    if (macroBalance) {
      messages.push('⚖️ Well-balanced meal! You\'re making smart choices.');
    }
    
    // Weekly progress
    if (userProfile.weekly_score > 80) {
      messages.push('🌟 You\'re crushing your nutrition goals this week!');
    }
    
    return messages.length > 0 ? messages : ['Keep going! Every healthy choice counts. 💚'];
  }

  checkMacroBalance(nutritionData) {
    const totalCalories = nutritionData.calories;
    const proteinCal = nutritionData.protein * 4;
    const carbCal = nutritionData.carbs * 4;
    const fatCal = nutritionData.fat * 9;
    
    const proteinPercent = (proteinCal / totalCalories) * 100;
    const carbPercent = (carbCal / totalCalories) * 100;
    const fatPercent = (fatCal / totalCalories) * 100;
    
    // Check if macros are within healthy ranges
    return (
      proteinPercent >= 15 && proteinPercent <= 35 &&
      carbPercent >= 40 && carbPercent <= 65 &&
      fatPercent >= 20 && fatPercent <= 35
    );
  }

  calculateBMI(heightCm, weightKg) {
    const heightM = heightCm / 100;
    const bmi = weightKg / (heightM * heightM);
    return bmi.toFixed(1);
  }

  async generateNutrientReport(foodItems, nutritionData) {
    // Comprehensive nutrient analysis beyond basic macros
    const report = {
      macronutrients: {
        calories: nutritionData.calories,
        protein: nutritionData.protein,
        carbs: nutritionData.carbs,
        fat: nutritionData.fat
      },
      micronutrients: {
        fiber: nutritionData.fiber || 0,
        sugar: nutritionData.sugar || 0,
        sodium: nutritionData.sodium || 0,
        calcium: nutritionData.calcium || 'N/A',
        iron: nutritionData.iron || 'N/A',
        vitaminA: nutritionData.vitaminA || 'N/A',
        vitaminC: nutritionData.vitaminC || 'N/A'
      },
      quality: {
        glycemicIndex: this.estimateGlycemicIndex(foodItems),
        nutrientDensity: this.calculateNutrientDensity(nutritionData),
        processedScore: this.assessProcessingLevel(foodItems)
      }
    };
    
    return report;
  }

  estimateGlycemicIndex(foodItems) {
    // Simplified GI estimation
    const highGI = ['white rice', 'white bread', 'potato', 'sugar'];
    const lowGI = ['brown rice', 'whole wheat', 'oats', 'lentils'];
    
    let score = 'Medium';
    foodItems.forEach(item => {
      const name = item.name.toLowerCase();
      if (highGI.some(gi => name.includes(gi))) score = 'High';
      if (lowGI.some(gi => name.includes(gi))) score = 'Low';
    });
    
    return score;
  }

  calculateNutrientDensity(nutritionData) {
    // Nutrients per calorie ratio
    const nutrients = (nutritionData.protein + nutritionData.fiber + 
                      (nutritionData.vitamins || 0) + (nutritionData.minerals || 0));
    const density = nutrients / (nutritionData.calories / 100);
    
    if (density > 5) return 'High';
    if (density > 2) return 'Medium';
    return 'Low';
  }

  assessProcessingLevel(foodItems) {
    const processed = ['packaged', 'instant', 'frozen', 'canned'];
    const fresh = ['fresh', 'homemade', 'raw', 'grilled', 'steamed'];
    
    let score = 0;
    foodItems.forEach(item => {
      const name = item.name.toLowerCase();
      if (processed.some(p => name.includes(p))) score--;
      if (fresh.some(f => name.includes(f))) score++;
    });
    
    if (score > 0) return 'Mostly Fresh';
    if (score < 0) return 'Highly Processed';
    return 'Mixed';
  }

  generateBasicHealthReport(userProfile, foodItems, nutritionData) {
    // Fallback when AI is unavailable
    return {
      greeting: this.getPersonalizedGreeting(userProfile),
      summary: `You consumed ${nutritionData.calories} calories with ${nutritionData.protein}g protein.`,
      alerts: this.generateHealthAlerts(userProfile, nutritionData),
      encouragement: this.getEncouragement(userProfile, nutritionData)
    };
  }
}

module.exports = new HealthAnalysisService();