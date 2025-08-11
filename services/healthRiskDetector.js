const ingredientAnalyzer = require('./ingredientAnalyzer');
const personalizationEngine = require('./personalizationEngine');
const webhookService = require('./webhookService');
const { getDb, collections } = require('../lib/firebase');

class HealthRiskDetector {
  constructor() {
    // Risk thresholds
    this.riskThresholds = {
      sodium: {
        daily: 2300, // mg
        meal: 800,   // mg
        critical: 1500 // mg per meal
      },
      sugar: {
        daily: 50,    // g
        meal: 15,     // g
        critical: 25  // g per meal
      },
      saturatedFat: {
        daily: 20,    // g
        meal: 7,      // g
        critical: 12  // g per meal
      },
      calories: {
        binge: 1000,  // calories in single meal
        dayExcess: 500 // calories over target
      }
    };

    // Health condition specific risks
    this.conditionRisks = {
      diabetes: {
        triggers: ['sugar', 'carbs', 'glycemic_index'],
        thresholds: {
          sugar: { meal: 10, critical: 15 },
          carbs: { meal: 30, critical: 45 }
        }
      },
      hypertension: {
        triggers: ['sodium', 'caffeine', 'alcohol'],
        thresholds: {
          sodium: { meal: 500, critical: 800 }
        }
      },
      heart_disease: {
        triggers: ['saturated_fat', 'trans_fat', 'cholesterol'],
        thresholds: {
          saturatedFat: { meal: 5, critical: 8 },
          cholesterol: { meal: 100, critical: 200 }
        }
      },
      pregnancy: {
        triggers: ['mercury', 'raw_foods', 'unpasteurized', 'caffeine'],
        bannedFoods: ['sushi', 'raw fish', 'soft cheese', 'raw eggs']
      },
      kidney_disease: {
        triggers: ['protein', 'phosphorus', 'potassium'],
        thresholds: {
          protein: { meal: 20, critical: 30 }
        }
      }
    };

    // Real-time alert types
    this.alertTypes = {
      IMMEDIATE_DANGER: 'immediate_danger',
      HIGH_RISK: 'high_risk',
      CAUTION: 'caution',
      PATTERN_ALERT: 'pattern_alert',
      ALLERGY_ALERT: 'allergy_alert'
    };
  }

  // Main risk detection for food
  async detectRisks(foodData, userProfile, context = {}) {
    const risks = [];
    
    // Check immediate health risks
    const immediateRisks = await this.checkImmediateRisks(foodData, userProfile);
    risks.push(...immediateRisks);
    
    // Check ingredient risks
    if (foodData.ingredients) {
      const ingredientRisks = await this.checkIngredientRisks(foodData.ingredients, userProfile);
      risks.push(...ingredientRisks);
    }
    
    // Check nutritional risks
    const nutritionalRisks = this.checkNutritionalRisks(foodData, userProfile);
    risks.push(...nutritionalRisks);
    
    // Check pattern-based risks
    const patternRisks = await this.checkPatternRisks(userProfile.phone, foodData, context);
    risks.push(...patternRisks);
    
    // Check interaction risks
    const interactionRisks = await this.checkFoodDrugInteractions(foodData, userProfile);
    risks.push(...interactionRisks);
    
    // Sort by severity
    risks.sort((a, b) => this.getSeverityScore(b.type) - this.getSeverityScore(a.type));
    
    // Send critical alerts
    if (risks.some(r => r.type === this.alertTypes.IMMEDIATE_DANGER)) {
      await this.sendCriticalAlert(userProfile.phone, risks);
    }
    
    return {
      hasRisks: risks.length > 0,
      riskCount: risks.length,
      criticalRisks: risks.filter(r => r.type === this.alertTypes.IMMEDIATE_DANGER),
      risks: risks,
      safetyScore: this.calculateSafetyScore(risks),
      recommendation: this.generateSafetyRecommendation(risks, foodData)
    };
  }

  // Check immediate health risks
  async checkImmediateRisks(foodData, userProfile) {
    const risks = [];
    
    // Allergy check
    if (userProfile.health_conditions) {
      for (const condition of userProfile.health_conditions) {
        if (condition.includes('allergy')) {
          const allergen = condition.replace('_allergy', '').replace('_', ' ');
          const foodName = foodData.name.toLowerCase();
          const ingredients = (foodData.ingredients || '').toLowerCase();
          
          if (foodName.includes(allergen) || ingredients.includes(allergen)) {
            risks.push({
              type: this.alertTypes.ALLERGY_ALERT,
              severity: 'critical',
              condition: condition,
              message: `🚨 ALLERGY ALERT: This contains ${allergen}! DO NOT CONSUME!`,
              action: 'Find an alternative immediately',
              allergen: allergen
            });
          }
        }
      }
    }
    
    // Pregnancy-specific risks
    if (userProfile.health_conditions?.includes('pregnancy')) {
      const pregnancyRisks = this.conditionRisks.pregnancy;
      const foodNameLower = foodData.name.toLowerCase();
      
      for (const bannedFood of pregnancyRisks.bannedFoods) {
        if (foodNameLower.includes(bannedFood)) {
          risks.push({
            type: this.alertTypes.IMMEDIATE_DANGER,
            severity: 'critical',
            condition: 'pregnancy',
            message: `⚠️ PREGNANCY WARNING: ${foodData.name} is not safe during pregnancy!`,
            action: 'Choose a pregnancy-safe alternative',
            reason: 'May cause foodborne illness or developmental issues'
          });
        }
      }
    }
    
    // Medication interactions
    if (userProfile.medications) {
      const interactions = await this.checkMedicationInteractions(
        foodData,
        userProfile.medications
      );
      risks.push(...interactions);
    }
    
    return risks;
  }

  // Check ingredient-based risks
  async checkIngredientRisks(ingredients, userProfile) {
    const risks = [];
    
    // Analyze with ingredient analyzer
    const analysis = await ingredientAnalyzer.analyzeIngredients(
      ingredients,
      userProfile
    );
    
    // Convert harmful ingredients to risks
    analysis.harmfulIngredients.forEach(harmful => {
      let riskType = this.alertTypes.CAUTION;
      
      if (harmful.personalSeverity === 'very_high') {
        riskType = this.alertTypes.HIGH_RISK;
      } else if (harmful.severity === 'very_high') {
        riskType = this.alertTypes.HIGH_RISK;
      }
      
      risks.push({
        type: riskType,
        severity: harmful.personalSeverity || harmful.severity,
        ingredient: harmful.name,
        message: `Contains ${harmful.name}: ${harmful.risks.join(', ')}`,
        action: harmful.alternativeProducts?.[0] || 'Choose a cleaner alternative',
        category: harmful.category,
        whyBad: harmful.whyBad
      });
    });
    
    // Ultra-processed food warning
    if (analysis.processingLevel === 'ultra_processed') {
      risks.push({
        type: this.alertTypes.HIGH_RISK,
        severity: 'high',
        message: '🏭 ULTRA-PROCESSED: This product is heavily processed with multiple additives',
        action: 'Choose whole foods or minimally processed alternatives',
        healthImpact: 'Linked to obesity, diabetes, and heart disease'
      });
    }
    
    // Hidden sugar warning
    if (analysis.hiddenSugars.length > 3) {
      risks.push({
        type: this.alertTypes.CAUTION,
        severity: 'medium',
        message: `🍭 Hidden sugars detected: ${analysis.hiddenSugars.length} different types`,
        action: 'Check total sugar content and consider alternatives',
        sugars: analysis.hiddenSugars
      });
    }
    
    return risks;
  }

  // Check nutritional risks
  checkNutritionalRisks(foodData, userProfile) {
    const risks = [];
    
    // Check against general thresholds
    if (foodData.sodium > this.riskThresholds.sodium.critical) {
      risks.push({
        type: this.alertTypes.HIGH_RISK,
        severity: 'high',
        nutrient: 'sodium',
        message: `⚠️ EXTREME SODIUM: ${foodData.sodium}mg (${Math.round(foodData.sodium / this.riskThresholds.sodium.daily * 100)}% of daily limit!)`,
        action: 'This will spike your blood pressure - find a low-sodium option',
        value: foodData.sodium,
        threshold: this.riskThresholds.sodium.critical
      });
    } else if (foodData.sodium > this.riskThresholds.sodium.meal) {
      risks.push({
        type: this.alertTypes.CAUTION,
        severity: 'medium',
        nutrient: 'sodium',
        message: `High sodium: ${foodData.sodium}mg in one meal`,
        action: 'Balance with low-sodium foods today'
      });
    }
    
    // Sugar risks
    if (foodData.sugar > this.riskThresholds.sugar.critical) {
      risks.push({
        type: this.alertTypes.HIGH_RISK,
        severity: 'high',
        nutrient: 'sugar',
        message: `🍬 SUGAR BOMB: ${foodData.sugar}g of sugar (${Math.round(foodData.sugar / this.riskThresholds.sugar.daily * 100)}% of daily limit!)`,
        action: 'This will cause a major blood sugar spike',
        value: foodData.sugar,
        threshold: this.riskThresholds.sugar.critical
      });
    }
    
    // Condition-specific nutritional risks
    if (userProfile.health_conditions) {
      for (const condition of userProfile.health_conditions) {
        const conditionRisk = this.conditionRisks[condition];
        if (conditionRisk?.thresholds) {
          for (const [nutrient, limits] of Object.entries(conditionRisk.thresholds)) {
            const value = foodData[nutrient];
            if (value && value > limits.critical) {
              risks.push({
                type: this.alertTypes.IMMEDIATE_DANGER,
                severity: 'critical',
                condition: condition,
                nutrient: nutrient,
                message: `🚨 ${condition.toUpperCase()} DANGER: ${value}${this.getUnit(nutrient)} of ${nutrient}!`,
                action: `With ${condition}, you must avoid high-${nutrient} foods`,
                value: value,
                limit: limits.critical
              });
            } else if (value && value > limits.meal) {
              risks.push({
                type: this.alertTypes.HIGH_RISK,
                severity: 'high',
                condition: condition,
                nutrient: nutrient,
                message: `⚠️ Too high for ${condition}: ${value}${this.getUnit(nutrient)} of ${nutrient}`,
                action: 'Choose a lower option or reduce portion'
              });
            }
          }
        }
      }
    }
    
    // Calorie bomb detection
    if (foodData.calories > this.riskThresholds.calories.binge) {
      risks.push({
        type: this.alertTypes.HIGH_RISK,
        severity: 'high',
        message: `🔥 CALORIE OVERLOAD: ${foodData.calories} calories in one meal!`,
        action: 'This is 50% of daily needs - consider splitting or choosing lighter',
        impactTime: 'Would take 2+ hours of exercise to burn off'
      });
    }
    
    return risks;
  }

  // Check pattern-based risks
  async checkPatternRisks(phone, foodData, context) {
    const risks = [];
    
    // Get today's consumption
    const todayStats = await this.getTodayStats(phone);
    
    // Check if this meal would exceed daily limits
    const projectedTotals = {
      calories: todayStats.calories + foodData.calories,
      sodium: todayStats.sodium + foodData.sodium,
      sugar: todayStats.sugar + foodData.sugar,
      saturatedFat: todayStats.saturatedFat + (foodData.saturated_fat || 0)
    };
    
    // Daily limit warnings
    if (projectedTotals.calories > todayStats.calorieTarget + this.riskThresholds.calories.dayExcess) {
      risks.push({
        type: this.alertTypes.PATTERN_ALERT,
        severity: 'medium',
        pattern: 'daily_excess',
        message: `📊 This would put you ${projectedTotals.calories - todayStats.calorieTarget} calories over target`,
        action: 'Consider a lighter option or save for tomorrow',
        todayTotal: todayStats.calories,
        projected: projectedTotals.calories,
        target: todayStats.calorieTarget
      });
    }
    
    // Repetitive unhealthy eating
    const recentFoods = await this.getRecentFoods(phone, 7);
    const similarUnhealthyCount = recentFoods.filter(f => 
      f.name.toLowerCase().includes(foodData.name.toLowerCase()) &&
      f.healthScore < 50
    ).length;
    
    if (similarUnhealthyCount > 3) {
      risks.push({
        type: this.alertTypes.PATTERN_ALERT,
        severity: 'high',
        pattern: 'repetitive_unhealthy',
        message: `🔄 You've had ${foodData.name} ${similarUnhealthyCount} times this week`,
        action: 'Break the pattern - your body needs variety and nutrients',
        frequency: similarUnhealthyCount
      });
    }
    
    // Time-based patterns
    const currentHour = new Date().getHours();
    if (currentHour >= 21 && foodData.calories > 300) {
      risks.push({
        type: this.alertTypes.PATTERN_ALERT,
        severity: 'medium',
        pattern: 'late_night_eating',
        message: '🌙 Late night + high calories = weight gain recipe',
        action: 'Your metabolism is slowest now - save this for breakfast',
        science: 'Circadian rhythm affects how we process food'
      });
    }
    
    // Binge eating pattern detection
    if (context.mealGap && context.mealGap < 60 && foodData.calories > 400) {
      risks.push({
        type: this.alertTypes.PATTERN_ALERT,
        severity: 'high',
        pattern: 'potential_binge',
        message: '⏰ Eating again so soon? This might be emotional eating',
        action: 'Take 5 minutes to check in with yourself first',
        lastMealTime: context.lastMealTime
      });
    }
    
    return risks;
  }

  // Check food-drug interactions
  async checkFoodDrugInteractions(foodData, userProfile) {
    const risks = [];
    
    if (!userProfile.medications || userProfile.medications.length === 0) {
      return risks;
    }
    
    // Common food-drug interactions
    const interactions = {
      'warfarin': {
        foods: ['leafy greens', 'broccoli', 'brussels sprouts'],
        nutrient: 'vitamin K',
        risk: 'Can reduce medication effectiveness'
      },
      'statins': {
        foods: ['grapefruit', 'pomegranate'],
        risk: 'Can increase medication side effects'
      },
      'maoi': {
        foods: ['aged cheese', 'cured meats', 'fermented foods'],
        risk: 'Can cause dangerous blood pressure spike'
      },
      'thyroid': {
        foods: ['soy', 'coffee', 'high-fiber foods'],
        timing: 'within 4 hours',
        risk: 'Can reduce medication absorption'
      }
    };
    
    for (const medication of userProfile.medications) {
      const medLower = medication.toLowerCase();
      const interaction = interactions[medLower];
      
      if (interaction) {
        const foodNameLower = foodData.name.toLowerCase();
        const hasInteraction = interaction.foods.some(food => 
          foodNameLower.includes(food)
        );
        
        if (hasInteraction) {
          risks.push({
            type: this.alertTypes.HIGH_RISK,
            severity: 'high',
            interaction: 'food_drug',
            medication: medication,
            message: `💊 MEDICATION INTERACTION: ${foodData.name} can interfere with ${medication}`,
            action: interaction.timing ? 
              `Wait ${interaction.timing} after taking medication` : 
              'Consult your doctor about this combination',
            risk: interaction.risk
          });
        }
      }
    }
    
    return risks;
  }

  // Check medication interactions
  async checkMedicationInteractions(foodData, medications) {
    // This would integrate with a drug interaction API
    // For now, return empty array
    return [];
  }

  // Calculate safety score
  calculateSafetyScore(risks) {
    if (risks.length === 0) return 100;
    
    let score = 100;
    
    risks.forEach(risk => {
      const penalty = this.getSeverityScore(risk.type) * 10;
      score -= penalty;
    });
    
    return Math.max(0, score);
  }

  // Generate safety recommendation
  generateSafetyRecommendation(risks, foodData) {
    if (risks.length === 0) {
      return {
        verdict: 'SAFE',
        message: '✅ This food is safe for you to consume',
        color: 'green'
      };
    }
    
    const criticalRisks = risks.filter(r => 
      r.type === this.alertTypes.IMMEDIATE_DANGER || 
      r.type === this.alertTypes.ALLERGY_ALERT
    );
    
    if (criticalRisks.length > 0) {
      return {
        verdict: 'AVOID',
        message: '🚫 DO NOT CONSUME - Serious health risk detected',
        color: 'red',
        alternative: 'Find a safe alternative immediately'
      };
    }
    
    const highRisks = risks.filter(r => r.type === this.alertTypes.HIGH_RISK);
    
    if (highRisks.length > 0) {
      return {
        verdict: 'NOT RECOMMENDED',
        message: '⚠️ High health risks - strongly advise against',
        color: 'orange',
        alternative: 'Consider healthier options'
      };
    }
    
    return {
      verdict: 'CAUTION',
      message: '⚡ Consume with caution - some concerns detected',
      color: 'yellow',
      tips: risks.map(r => r.action).filter(Boolean).slice(0, 2)
    };
  }

  // Send critical alert
  async sendCriticalAlert(phone, risks) {
    const criticalRisk = risks.find(r => r.type === this.alertTypes.IMMEDIATE_DANGER);
    
    if (criticalRisk) {
      await webhookService.sendWebhook(phone, 'critical_health_risk', {
        risk: criticalRisk,
        timestamp: new Date().toISOString(),
        urgency: 'immediate'
      });
    }
  }

  // Helper methods
  getSeverityScore(alertType) {
    const scores = {
      [this.alertTypes.IMMEDIATE_DANGER]: 5,
      [this.alertTypes.ALLERGY_ALERT]: 5,
      [this.alertTypes.HIGH_RISK]: 3,
      [this.alertTypes.PATTERN_ALERT]: 2,
      [this.alertTypes.CAUTION]: 1
    };
    
    return scores[alertType] || 1;
  }

  getUnit(nutrient) {
    const units = {
      sodium: 'mg',
      sugar: 'g',
      saturatedFat: 'g',
      saturated_fat: 'g',
      carbs: 'g',
      protein: 'g',
      cholesterol: 'mg',
      caffeine: 'mg'
    };
    
    return units[nutrient] || '';
  }

  async getTodayStats(phone) {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    
    const doc = await db.collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '==', today)
      .limit(1)
      .get();
    
    if (doc.empty) {
      const userDoc = await db.collection(collections.users).doc(phone).get();
      const userData = userDoc.data();
      
      return {
        calories: 0,
        sodium: 0,
        sugar: 0,
        saturatedFat: 0,
        calorieTarget: userData?.calorie_target || 2000
      };
    }
    
    const data = doc.docs[0].data();
    const totals = data.foods?.reduce((acc, food) => ({
      calories: acc.calories + (food.calories || 0),
      sodium: acc.sodium + (food.sodium || 0),
      sugar: acc.sugar + (food.sugar || 0),
      saturatedFat: acc.saturatedFat + (food.saturated_fat || 0)
    }), { calories: 0, sodium: 0, sugar: 0, saturatedFat: 0 });
    
    return {
      ...totals,
      calorieTarget: data.calorie_target || 2000
    };
  }

  async getRecentFoods(phone, days) {
    const db = getDb();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const snapshot = await db.collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '>=', startDate.toISOString().split('T')[0])
      .get();
    
    const foods = [];
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.foods) {
        foods.push(...data.foods);
      }
    });
    
    return foods;
  }
}

module.exports = new HealthRiskDetector();