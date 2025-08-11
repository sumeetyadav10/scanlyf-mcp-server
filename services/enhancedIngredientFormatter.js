class EnhancedIngredientFormatter {
  constructor() {
    // Safe alternatives database
    this.safeAlternatives = {
      chips: {
        toxic: ['Lays', 'Doritos', 'Cheetos', 'Pringles'],
        safe: ['Baked Lays', 'Terra Chips', 'Rhythm Superfoods', 'Simply 7', 'Bare Chips'],
        reason: 'No MSG, TBHQ, or artificial colors'
      },
      sodas: {
        toxic: ['Coke', 'Pepsi', 'Mountain Dew', 'Sprite'],
        safe: ['Zevia', 'Spindrift', 'LaCroix', 'Bubly', 'Kombucha'],
        reason: 'No HFCS, artificial sweeteners, or phosphoric acid'
      },
      snackBars: {
        toxic: ['Snickers', 'Twix', 'Granola bars with HFCS'],
        safe: ['RX Bars', 'Larabars', 'Kind Bars', 'Epic Bars', 'Hu Kitchen'],
        reason: 'Whole food ingredients, no preservatives'
      },
      bread: {
        toxic: ['Wonder Bread', 'Most commercial white bread'],
        safe: ['Ezekiel', 'Dave\'s Killer Bread', 'Whole grain sourdough'],
        reason: 'No HFCS, azodicarbonamide, or dough conditioners'
      },
      yogurt: {
        toxic: ['Yoplait', 'Dannon with artificial sweeteners'],
        safe: ['Siggi\'s', 'Fage', 'Chobani Whole Milk', 'Kite Hill'],
        reason: 'No artificial sweeteners or modified corn starch'
      }
    };

    // Severity emojis and headers
    this.severityConfig = {
      critical: {
        emoji: '🛑',
        header: 'DANGER: CANCER-LINKED INGREDIENTS',
        color: 'red',
        action: 'DO NOT CONSUME'
      },
      high: {
        emoji: '⚠️',
        header: 'WARNING: HARMFUL ADDITIVES DETECTED',
        color: 'orange',
        action: 'LIMIT CONSUMPTION'
      },
      medium: {
        emoji: '⚡',
        header: 'CAUTION: PROCESSED FOOD ALERT',
        color: 'yellow',
        action: 'OCCASIONAL USE ONLY'
      },
      low: {
        emoji: '💡',
        header: 'FYI: Some preservatives found',
        color: 'blue',
        action: 'GENERALLY SAFE'
      }
    };

    // Educational snippets
    this.educationalFacts = {
      'aspartame': '🧠 Aspartame breaks down into methanol (wood alcohol) in your body!',
      'msg': '🤯 MSG is hidden in 40+ other names like "yeast extract" and "natural flavoring"',
      'hfcs': '🍔 HFCS blocks leptin (the "I\'m full" hormone) - that\'s why you can\'t stop eating!',
      'tbhq': '⛽ TBHQ is a petroleum derivative also used in varnishes and paints',
      'sodium nitrite': '🥓 Sodium nitrite + high heat = nitrosamines (same stuff in cigarette smoke)',
      'red 40': '🎨 Red 40 is made from petroleum and banned in many European countries',
      'bha': '🧪 BHA is "reasonably anticipated to be a human carcinogen" by US gov',
      'trans fat': '❤️ Trans fat stays in your body for 51 days (natural fat: 18 days)'
    };
  }

  // Format the main scan response with enhanced ingredient warnings
  formatScanResponse(analysisResult, userProfile = {}) {
    const { harmfulIngredients, nutritionData, processingLevel } = analysisResult;
    
    if (!harmfulIngredients || harmfulIngredients.length === 0) {
      return this.formatCleanFoodResponse(analysisResult);
    }

    // Determine overall severity
    const overallSeverity = this.calculateOverallSeverity(harmfulIngredients);
    const personalizedRisk = this.calculatePersonalizedRisk(harmfulIngredients, userProfile);
    
    // Build response with visual hierarchy
    let response = this.buildHeader(overallSeverity, harmfulIngredients.length);
    response += this.buildIngredientWarnings(harmfulIngredients, userProfile);
    response += this.buildAlternativesSection(nutritionData.name);
    response += this.buildNutritionSection(nutritionData);
    response += this.buildEducationalSnippet(harmfulIngredients);
    response += this.buildProgressTracker(userProfile);

    return response;
  }

  // Build the header based on severity
  buildHeader(severity, count) {
    const config = this.severityConfig[severity];
    return `${config.emoji} ${config.header}
━━━━━━━━━━━━━━━━━━━━━━━━
Found ${count} harmful ingredient${count > 1 ? 's' : ''} - ${config.action}
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Build ingredient warnings with progressive disclosure
  buildIngredientWarnings(ingredients, userProfile) {
    let warnings = '';
    
    // Sort by severity and personalized risk
    const sortedIngredients = this.sortIngredientsBySeverity(ingredients, userProfile);
    
    // Show top 3 most dangerous
    const topIngredients = sortedIngredients.slice(0, 3);
    const remaining = sortedIngredients.length - 3;
    
    topIngredients.forEach((ing, index) => {
      warnings += this.formatIngredientWarning(ing, userProfile, index === 0);
    });
    
    if (remaining > 0) {
      warnings += `\n📋 +${remaining} more concerning ingredients\n`;
      warnings += `💬 Reply "more" to see all ingredients\n`;
    }
    
    return warnings;
  }

  // Format individual ingredient warning
  formatIngredientWarning(ingredient, userProfile, isFirst = false) {
    const emoji = this.getIngredientEmoji(ingredient.severity);
    const personalNote = this.getPersonalizedWarning(ingredient, userProfile);
    
    let warning = `${emoji} ${ingredient.name.toUpperCase()}`;
    
    if (isFirst) {
      // Detailed explanation for the worst ingredient
      warning += ` - ${ingredient.risks[0]}\n`;
      warning += `   📍 Why it's bad: ${this.getSimpleExplanation(ingredient)}\n`;
      if (personalNote) {
        warning += `   👤 For YOU: ${personalNote}\n`;
      }
    } else {
      // Shorter format for others
      warning += ` - ${ingredient.risks[0]}\n`;
    }
    
    return warning;
  }

  // Build alternatives section
  buildAlternativesSection(foodName) {
    const category = this.identifyFoodCategory(foodName);
    if (!category || !this.safeAlternatives[category]) {
      return '';
    }
    
    const alternatives = this.safeAlternatives[category];
    return `\n✅ SAFE ALTERNATIVES
━━━━━━━━━━━━━━━━━━━━━━━━
${alternatives.safe.slice(0, 3).join(' • ')}
${alternatives.reason}
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Build nutrition section (compact)
  buildNutritionSection(nutritionData) {
    return `📊 NUTRITION FACTS
━━━━━━━━━━━━━━━━━━━━━━━━
Calories: ${nutritionData.calories}
Protein: ${nutritionData.protein}g
Carbs: ${nutritionData.carbs}g
Fat: ${nutritionData.fat}g
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Build educational snippet
  buildEducationalSnippet(ingredients) {
    const worstIngredient = ingredients[0];
    const fact = this.educationalFacts[worstIngredient.name.toLowerCase()];
    
    if (!fact) return '';
    
    return `💡 DID YOU KNOW?
${fact}
━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  // Build progress tracker
  buildProgressTracker(userProfile) {
    const todayScans = userProfile.todayScans || 0;
    const cleanScans = userProfile.cleanScans || 0;
    const toxicScans = userProfile.toxicScans || 0;
    const streak = userProfile.cleanStreak || 0;
    
    return `📈 YOUR TOXIN TRACKER
━━━━━━━━━━━━━━━━━━━━━━━━
Today's scans: ${todayScans}
✅ Clean foods: ${cleanScans}
❌ Toxic foods: ${toxicScans}
🔥 Clean streak: ${streak} scans

🎯 Goal: 5 clean scans in a row!
━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  // Format response for clean foods
  formatCleanFoodResponse(analysisResult) {
    const { nutritionData } = analysisResult;
    
    return `✅ CLEAN FOOD - NO HARMFUL INGREDIENTS!
━━━━━━━━━━━━━━━━━━━━━━━━
Great choice! This food is free from:
• No artificial colors or flavors
• No harmful preservatives
• No trans fats or HFCS
━━━━━━━━━━━━━━━━━━━━━━━━

${this.buildNutritionSection(nutritionData)}

🏆 Keep up the great work!
Your clean streak continues! 🔥`;
  }

  // Helper methods
  calculateOverallSeverity(ingredients) {
    if (ingredients.some(i => i.severity === 'critical')) return 'critical';
    if (ingredients.some(i => i.severity === 'high')) return 'high';
    if (ingredients.some(i => i.severity === 'medium')) return 'medium';
    return 'low';
  }

  calculatePersonalizedRisk(ingredients, userProfile) {
    const conditions = userProfile.health_conditions || [];
    let riskScore = 0;
    
    ingredients.forEach(ing => {
      conditions.forEach(condition => {
        if (ing.personalizedRisk && ing.personalizedRisk[condition]) {
          const riskLevel = ing.personalizedRisk[condition];
          riskScore += riskLevel === 'very_high' ? 3 : riskLevel === 'high' ? 2 : 1;
        }
      });
    });
    
    return riskScore;
  }

  sortIngredientsBySeverity(ingredients, userProfile) {
    return ingredients.sort((a, b) => {
      // First by severity
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      
      // Then by personalized risk
      const aRisk = this.getPersonalizedRiskScore(a, userProfile);
      const bRisk = this.getPersonalizedRiskScore(b, userProfile);
      return bRisk - aRisk;
    });
  }

  getPersonalizedRiskScore(ingredient, userProfile) {
    const conditions = userProfile.health_conditions || [];
    let score = 0;
    
    conditions.forEach(condition => {
      if (ingredient.personalizedRisk && ingredient.personalizedRisk[condition]) {
        const risk = ingredient.personalizedRisk[condition];
        score += risk === 'very_high' ? 3 : risk === 'high' ? 2 : 1;
      }
    });
    
    return score;
  }

  getIngredientEmoji(severity) {
    const emojis = {
      critical: '🛑',
      high: '🚨',
      medium: '⚠️',
      low: '💡'
    };
    return emojis[severity] || '•';
  }

  getPersonalizedWarning(ingredient, userProfile) {
    const conditions = userProfile.health_conditions || [];
    const goals = userProfile.health_goals || [];
    
    // Check health conditions
    for (const condition of conditions) {
      if (ingredient.personalizedRisk && ingredient.personalizedRisk[condition]) {
        const risk = ingredient.personalizedRisk[condition];
        if (risk === 'very_high') {
          return `Extremely dangerous for ${condition.replace('_', ' ')}`;
        } else if (risk === 'high') {
          return `High risk for ${condition.replace('_', ' ')}`;
        }
      }
    }
    
    // Check health goals
    if (goals.includes('weight_loss') && ingredient.category === 'sweetener') {
      return 'Sabotages weight loss goals';
    }
    
    return null;
  }

  getSimpleExplanation(ingredient) {
    const explanations = {
      'aspartame': 'Artificial sweetener that converts to formaldehyde',
      'msg': 'Excitotoxin that overstimulates nerve cells',
      'hfcs': 'Super-concentrated sugar that bypasses satiety signals',
      'tbhq': 'Petroleum-based preservative linked to vision problems',
      'sodium nitrite': 'Forms cancer-causing compounds when heated',
      'trans fat': 'Artificial fat that clogs arteries',
      'bha': 'Synthetic antioxidant classified as possible carcinogen',
      'red 40': 'Petroleum-derived dye linked to hyperactivity'
    };
    
    return explanations[ingredient.name.toLowerCase()] || ingredient.risks[0];
  }

  identifyFoodCategory(foodName) {
    const name = foodName.toLowerCase();
    
    if (name.includes('chip') || name.includes('dorito') || name.includes('cheeto')) return 'chips';
    if (name.includes('soda') || name.includes('cola') || name.includes('sprite')) return 'sodas';
    if (name.includes('bar') || name.includes('snickers') || name.includes('granola')) return 'snackBars';
    if (name.includes('bread') || name.includes('toast')) return 'bread';
    if (name.includes('yogurt') || name.includes('yoghurt')) return 'yogurt';
    
    return null;
  }

  // Format daily summary
  formatDailySummary(userStats) {
    const { totalScans, cleanScans, toxicScans, worstIngredients } = userStats;
    const cleanPercentage = totalScans > 0 ? Math.round((cleanScans / totalScans) * 100) : 0;
    
    return `📊 TODAY'S TOXIN REPORT
━━━━━━━━━━━━━━━━━━━━━━━━
Total scans: ${totalScans}
✅ Clean choices: ${cleanScans} (${cleanPercentage}%)
❌ Toxic foods: ${toxicScans}

🚨 Worst ingredients today:
${worstIngredients.slice(0, 3).map(i => `• ${i.name} (${i.count}x)`).join('\n')}

${this.getDailySummaryMessage(cleanPercentage)}
━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  getDailySummaryMessage(cleanPercentage) {
    if (cleanPercentage >= 80) {
      return '🏆 Excellent! You\'re a Clean Eating Champion!';
    } else if (cleanPercentage >= 60) {
      return '👍 Good job! Room for improvement tomorrow.';
    } else if (cleanPercentage >= 40) {
      return '⚡ Be careful! Too many processed foods today.';
    } else {
      return '🚨 Alert: Your diet needs immediate attention!';
    }
  }
}

module.exports = new EnhancedIngredientFormatter();