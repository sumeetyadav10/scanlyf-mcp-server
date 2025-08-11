const openai = require('openai');
const { getDb, collections } = require('../lib/firebase');
const cacheService = require('../lib/cacheService');

class PersonalizationEngine {
  constructor() {
    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }

    // User personality types
    this.personalityTypes = {
      WARRIOR: 'warrior',
      SCHOLAR: 'scholar',
      NURTURER: 'nurturer',
      PRAGMATIST: 'pragmatist'
    };

    // Behavioral metrics to track
    this.behavioralMetrics = {
      mealTiming: {},
      foodPreferences: {},
      compliancePatterns: {},
      triggerFoods: {},
      successPatterns: {}
    };

    // Contextual factors
    this.contextualFactors = {
      location: ['home', 'work', 'restaurant', 'travel'],
      socialContext: ['alone', 'family', 'friends', 'business'],
      moodIndicators: ['stressed', 'happy', 'tired', 'energetic', 'anxious'],
      dayPatterns: {},
      weatherCorrelation: {}
    };
  }

  // Get or create user personality profile
  async getUserPersonality(phone) {
    const db = getDb();
    const doc = await db.collection('user_personalities').doc(phone).get();
    
    if (doc.exists) {
      return doc.data();
    }

    // Create new personality profile
    const newProfile = await this.assessPersonality(phone);
    await db.collection('user_personalities').doc(phone).set(newProfile);
    return newProfile;
  }

  // Assess user personality based on behavior
  async assessPersonality(phone) {
    const recentLogs = await this.getRecentActivity(phone, 30);
    const profile = await this.getUserProfile(phone);
    
    let personalityType = this.personalityTypes.PRAGMATIST;
    let motivationStyle = 'balanced'; // carrot, stick, or balanced
    let learningPreference = 'moderate'; // simple, moderate, detailed
    let communicationTone = 'friendly'; // formal, friendly, casual, motivational
    let goalOrientation = 'health'; // health, appearance, performance, longevity

    // Analyze patterns
    if (recentLogs.length > 10) {
      // Check consistency
      const consistency = this.calculateConsistency(recentLogs);
      
      // Check detail level in food descriptions
      const detailLevel = this.analyzeDetailLevel(recentLogs);
      
      // Check goal achievement
      const goalSuccess = this.analyzeGoalSuccess(recentLogs, profile);

      // Determine personality
      if (consistency > 0.8 && goalSuccess > 0.7) {
        personalityType = this.personalityTypes.WARRIOR;
        motivationStyle = 'carrot';
        communicationTone = 'motivational';
      } else if (detailLevel > 0.7) {
        personalityType = this.personalityTypes.SCHOLAR;
        learningPreference = 'detailed';
        communicationTone = 'formal';
      } else if (profile.goal === 'general_health') {
        personalityType = this.personalityTypes.NURTURER;
        motivationStyle = 'carrot';
        communicationTone = 'friendly';
      }
    }

    // Determine goal orientation from profile
    if (profile.goal === 'weight_loss' || profile.goal === 'muscle_gain') {
      goalOrientation = 'appearance';
    } else if (profile.goal === 'athletic_performance') {
      goalOrientation = 'performance';
    } else if (profile.health_conditions?.length > 0) {
      goalOrientation = 'health';
    }

    return {
      phone,
      personalityType,
      motivationStyle,
      learningPreference,
      communicationTone,
      goalOrientation,
      assessedAt: new Date().toISOString(),
      confidenceScore: recentLogs.length > 20 ? 0.8 : 0.5
    };
  }

  // Get personalized response for food analysis
  async getPersonalizedFoodResponse(userProfile, foodData, context = {}) {
    const personality = await this.getUserPersonality(userProfile.phone);
    const behaviorPatterns = await this.analyzeBehaviorPatterns(userProfile.phone);
    
    // Base analysis
    let response = await this.generateBaseAnalysis(foodData, userProfile, personality);
    
    // Add contextual enhancements
    response = await this.addContextualInsights(response, context, behaviorPatterns);
    
    // Apply personality-based tone
    response = this.applyPersonalityTone(response, personality);
    
    // Add predictive nudges if applicable
    const nudges = await this.generatePredictiveNudges(userProfile.phone, foodData, context);
    if (nudges.length > 0) {
      response += '\n\n' + nudges.join('\n');
    }

    return response;
  }

  // Generate base nutritional analysis
  async generateBaseAnalysis(foodData, userProfile, personality) {
    if (!this.openaiClient) {
      return this.generateTemplateResponse(foodData, userProfile, personality);
    }

    const prompt = `Analyze this food for a user with the following profile:
- Health conditions: ${userProfile.health_conditions?.join(', ') || 'none'}
- Goal: ${userProfile.goal}
- Personality type: ${personality.personalityType}
- Learning preference: ${personality.learningPreference}

Food data: ${JSON.stringify(foodData)}

Provide personalized nutritional analysis focusing on why this food is good/bad for them specifically.
${personality.learningPreference === 'detailed' ? 'Include scientific explanations.' : 'Keep it simple and actionable.'}`;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are a personalized nutrition coach who adapts communication style to user personality."
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
      console.error('OpenAI error:', error);
      return this.generateTemplateResponse(foodData, userProfile, personality);
    }
  }

  // Apply personality-based tone
  applyPersonalityTone(message, personality) {
    const toneMap = {
      [this.personalityTypes.WARRIOR]: {
        prefix: "💪 ",
        replacements: {
          "good choice": "powerful fuel",
          "not recommended": "defeats your goals",
          "try to": "conquer this by",
          "calories": "energy units"
        }
      },
      [this.personalityTypes.SCHOLAR]: {
        prefix: "📊 ",
        replacements: {
          "good for": "optimizes",
          "bad for": "negatively impacts",
          "helps": "facilitates",
          "avoid": "evidence suggests avoiding"
        }
      },
      [this.personalityTypes.NURTURER]: {
        prefix: "🌟 ",
        replacements: {
          "should": "might want to",
          "must": "it would be great to",
          "bad": "not the kindest choice for your body",
          "avoid": "your body would prefer if you choose something else"
        }
      },
      [this.personalityTypes.PRAGMATIST]: {
        prefix: "✅ ",
        replacements: {
          "recommended": "practical choice",
          "not recommended": "not optimal",
          "good": "effective",
          "bad": "inefficient"
        }
      }
    };

    const tone = toneMap[personality.personalityType] || toneMap[this.personalityTypes.PRAGMATIST];
    let tonedMessage = tone.prefix + message;

    // Apply replacements
    Object.entries(tone.replacements).forEach(([original, replacement]) => {
      tonedMessage = tonedMessage.replace(new RegExp(original, 'gi'), replacement);
    });

    return tonedMessage;
  }

  // Analyze behavior patterns
  async analyzeBehaviorPatterns(phone) {
    const logs = await this.getRecentActivity(phone, 30);
    const patterns = {
      mealTimes: {},
      commonFoods: {},
      triggerTimes: [],
      successDays: [],
      struggleDays: []
    };

    logs.forEach(log => {
      const date = new Date(log.date);
      const dayOfWeek = date.getDay();
      const hour = new Date(log.timestamp).getHours();

      // Track meal times
      if (!patterns.mealTimes[hour]) {
        patterns.mealTimes[hour] = 0;
      }
      patterns.mealTimes[hour]++;

      // Track common foods
      log.foods.forEach(food => {
        const foodName = food.name.toLowerCase();
        patterns.commonFoods[foodName] = (patterns.commonFoods[foodName] || 0) + 1;
      });

      // Identify success/struggle patterns
      const totalCalories = log.foods.reduce((sum, f) => sum + f.calories, 0);
      if (Math.abs(totalCalories - log.calorie_target) < 200) {
        patterns.successDays.push(dayOfWeek);
      } else if (totalCalories > log.calorie_target * 1.2) {
        patterns.struggleDays.push(dayOfWeek);
      }
    });

    // Identify trigger times (when overeating happens)
    const avgMealTime = Object.entries(patterns.mealTimes)
      .reduce((sum, [_, count]) => sum + count, 0) / Object.keys(patterns.mealTimes).length;
    
    patterns.triggerTimes = Object.entries(patterns.mealTimes)
      .filter(([_, count]) => count > avgMealTime * 1.5)
      .map(([hour]) => parseInt(hour));

    return patterns;
  }

  // Generate predictive nudges
  async generatePredictiveNudges(phone, currentFood, context) {
    const patterns = await this.analyzeBehaviorPatterns(phone);
    const currentHour = new Date().getHours();
    const nudges = [];

    // Check if this is a trigger time
    if (patterns.triggerTimes.includes(currentHour)) {
      nudges.push(`💡 I notice you often eat more at this time. Consider having a glass of water first to check if you're truly hungry.`);
    }

    // Check if this is a common "problem" food
    const foodName = currentFood.name.toLowerCase();
    if (patterns.commonFoods[foodName] > 5 && currentFood.calories > 300) {
      nudges.push(`📊 You've had ${foodName} ${patterns.commonFoods[foodName]} times this month. Maybe try alternating with a lighter option?`);
    }

    // Time-based suggestions
    if (currentHour >= 20 && currentFood.calories > 200) {
      nudges.push(`🌙 Late night snacking detected. Your metabolism slows down at night - consider saving this for tomorrow's breakfast.`);
    }

    // Pattern-based predictions
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getDay();
    
    if (patterns.struggleDays.includes(tomorrowDay)) {
      nudges.push(`📅 Heads up: ${this.getDayName(tomorrowDay)}s tend to be challenging for your goals. Plan your meals tonight!`);
    }

    return nudges;
  }

  // Add contextual insights
  async addContextualInsights(response, context, patterns) {
    const insights = [];

    // Location-based insights
    if (context.location === 'restaurant') {
      insights.push("🍽️ Restaurant portions are often 2-3x normal size. Consider taking half home.");
    } else if (context.location === 'work') {
      insights.push("💼 Work snacking tip: Keep healthy alternatives in your desk drawer.");
    }

    // Social context
    if (context.socialContext === 'friends') {
      insights.push("👥 Social eating often leads to 30% more consumption. Focus on the conversation, not the food!");
    }

    // Mood-based
    if (context.mood === 'stressed') {
      insights.push("😰 Stress eating alert: This choice might be emotion-driven. Try 5 deep breaths first.");
    } else if (context.mood === 'tired') {
      insights.push("😴 Fatigue makes us crave sugar. A 10-minute walk might energize you better than food.");
    }

    // Weather correlation (if available)
    if (context.weather === 'cold' && response.includes('calories')) {
      insights.push("❄️ Cold weather naturally increases calorie needs by 5-10%. Listen to your body.");
    }

    return insights.length > 0 ? response + '\n\n' + insights.join('\n') : response;
  }

  // Generate template response (fallback)
  generateTemplateResponse(foodData, userProfile, personality) {
    let response = ``;
    
    // Basic nutritional assessment
    if (foodData.calories > 500) {
      response += `This is a high-calorie option (${foodData.calories} cal). `;
    } else if (foodData.calories < 200) {
      response += `Light choice at ${foodData.calories} calories. `;
    } else {
      response += `Moderate calories (${foodData.calories}). `;
    }

    // Health condition specific
    if (userProfile.health_conditions?.includes('diabetes') && foodData.sugar > 10) {
      response += `⚠️ High sugar content (${foodData.sugar}g) - monitor blood glucose carefully. `;
    }

    if (userProfile.health_conditions?.includes('hypertension') && foodData.sodium > 500) {
      response += `⚠️ High sodium (${foodData.sodium}mg) - not ideal for blood pressure. `;
    }

    // Goal specific
    if (userProfile.goal === 'weight_loss' && foodData.calories > 400) {
      response += `This uses ${Math.round(foodData.calories / userProfile.calorie_target * 100)}% of your daily calorie budget. `;
    } else if (userProfile.goal === 'muscle_gain' && foodData.protein < 10) {
      response += `Low protein (${foodData.protein}g) - consider adding a protein source. `;
    }

    return response;
  }

  // Helper methods
  async getRecentActivity(phone, days) {
    const db = getDb();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const snapshot = await db.collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '>=', startDate.toISOString().split('T')[0])
      .orderBy('date', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  async getUserProfile(phone) {
    const db = getDb();
    const doc = await db.collection(collections.users).doc(phone).get();
    return doc.exists ? doc.data() : null;
  }

  calculateConsistency(logs) {
    if (logs.length < 7) return 0;
    
    const dailyLogs = logs.filter(log => log.foods?.length > 0);
    return dailyLogs.length / logs.length;
  }

  analyzeDetailLevel(logs) {
    let detailedEntries = 0;
    let totalEntries = 0;

    logs.forEach(log => {
      log.foods?.forEach(food => {
        totalEntries++;
        if (food.name.split(' ').length > 3 || food.portion_size) {
          detailedEntries++;
        }
      });
    });

    return totalEntries > 0 ? detailedEntries / totalEntries : 0;
  }

  analyzeGoalSuccess(logs, profile) {
    if (!profile?.calorie_target || logs.length === 0) return 0;

    let successDays = 0;
    logs.forEach(log => {
      const totalCalories = log.foods?.reduce((sum, f) => sum + (f.calories || 0), 0) || 0;
      if (Math.abs(totalCalories - profile.calorie_target) <= profile.calorie_target * 0.1) {
        successDays++;
      }
    });

    return successDays / logs.length;
  }

  getDayName(dayIndex) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
  }

  // Life event adaptation
  async adaptToLifeEvent(phone, eventType, eventData = {}) {
    const adaptations = {
      pregnancy: {
        trimester1: {
          calorieAdjustment: 0,
          avoidFoods: ['raw fish', 'unpasteurized cheese', 'high mercury fish'],
          supplements: ['folic acid', 'prenatal vitamins'],
          tips: ['Small, frequent meals help with nausea', 'Stay hydrated']
        },
        trimester2: {
          calorieAdjustment: 340,
          focusNutrients: ['calcium', 'iron', 'protein'],
          tips: ['Baby is growing fast - fuel up wisely!']
        },
        trimester3: {
          calorieAdjustment: 450,
          tips: ['Smaller meals may be more comfortable', 'Prepare freezer meals for postpartum']
        }
      },
      newJob: {
        stressManagement: ['Meal prep on weekends', 'Keep healthy snacks at desk'],
        routineBuilding: ['Set lunch reminders', 'Find healthy options near office']
      },
      training: {
        preWorkout: ['Carbs 1-2 hours before', 'Hydration is key'],
        postWorkout: ['Protein within 30 minutes', 'Replenish glycogen'],
        competition: ['Carb loading protocol', 'Familiar foods only']
      }
    };

    const db = getDb();
    await db.collection('user_life_events').doc(phone).set({
      eventType,
      eventData,
      adaptations: adaptations[eventType] || {},
      startDate: new Date().toISOString()
    }, { merge: true });

    return adaptations[eventType] || {};
  }

  // Get comprehensive user insights
  async getUserInsights(phone) {
    const [personality, patterns, profile, recentLogs] = await Promise.all([
      this.getUserPersonality(phone),
      this.analyzeBehaviorPatterns(phone),
      this.getUserProfile(phone),
      this.getRecentActivity(phone, 30)
    ]);

    const insights = {
      personality,
      patterns,
      profile: {
        ...profile,
        adherenceRate: this.analyzeGoalSuccess(recentLogs, profile),
        activeDays: recentLogs.length
      },
      recommendations: await this.generatePersonalizedRecommendations(phone, personality, patterns, profile),
      predictedChallenges: this.predictUpcomingChallenges(patterns),
      successFactors: this.identifySuccessFactors(recentLogs, profile)
    };

    return insights;
  }

  // Generate personalized recommendations
  async generatePersonalizedRecommendations(phone, personality, patterns, profile) {
    const recommendations = [];

    // Time-based recommendations
    if (patterns.triggerTimes.length > 0) {
      recommendations.push({
        type: 'timing',
        priority: 'high',
        message: `Set reminders for healthy snacks at ${patterns.triggerTimes.map(h => `${h}:00`).join(', ')}`
      });
    }

    // Personality-based recommendations
    if (personality.personalityType === this.personalityTypes.SCHOLAR) {
      recommendations.push({
        type: 'education',
        priority: 'medium',
        message: 'You love details! Check out our new nutrient timing guide for optimal results.'
      });
    } else if (personality.personalityType === this.personalityTypes.WARRIOR) {
      recommendations.push({
        type: 'challenge',
        priority: 'high',
        message: 'Ready for a challenge? Try our 7-day sugar detox warrior protocol!'
      });
    }

    // Goal-based recommendations
    if (profile.goal === 'weight_loss' && patterns.commonFoods) {
      const highCalFoods = Object.entries(patterns.commonFoods)
        .filter(([food, count]) => count > 5)
        .slice(0, 3);
      
      if (highCalFoods.length > 0) {
        recommendations.push({
          type: 'substitution',
          priority: 'high',
          message: `Try healthier swaps for your frequent foods: ${highCalFoods.map(([f]) => f).join(', ')}`
        });
      }
    }

    return recommendations;
  }

  // Predict upcoming challenges
  predictUpcomingChallenges(patterns) {
    const challenges = [];
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayOfWeek = tomorrow.getDay();

    // Weekend challenges
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      challenges.push({
        type: 'weekend',
        message: 'Weekends can be tricky. Plan your meals to avoid impulsive choices.'
      });
    }

    // Time-based challenges
    const currentHour = new Date().getHours();
    if (patterns.triggerTimes.includes(currentHour + 3)) {
      challenges.push({
        type: 'trigger_time',
        message: `Your usual snack time is coming up in 3 hours. Prepare a healthy option now!`
      });
    }

    return challenges;
  }

  // Identify success factors
  identifySuccessFactors(logs, profile) {
    const successFactors = {
      optimalMealTiming: [],
      successfulFoods: [],
      bestDays: [],
      patterns: []
    };

    logs.forEach(log => {
      const totalCalories = log.foods?.reduce((sum, f) => sum + (f.calories || 0), 0) || 0;
      const isSuccess = Math.abs(totalCalories - profile.calorie_target) <= profile.calorie_target * 0.1;

      if (isSuccess) {
        const date = new Date(log.date);
        successFactors.bestDays.push(date.getDay());
        
        log.foods?.forEach(food => {
          successFactors.successfulFoods.push(food.name);
        });
      }
    });

    // Analyze patterns
    const dayFrequency = {};
    successFactors.bestDays.forEach(day => {
      dayFrequency[day] = (dayFrequency[day] || 0) + 1;
    });

    const bestDay = Object.entries(dayFrequency)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (bestDay) {
      successFactors.patterns.push(`You're most successful on ${this.getDayName(parseInt(bestDay[0]))}s`);
    }

    return successFactors;
  }
}

module.exports = new PersonalizationEngine();