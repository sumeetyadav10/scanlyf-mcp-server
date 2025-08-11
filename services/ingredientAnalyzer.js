const openai = require('openai');

class IngredientAnalyzer {
  constructor() {
    // Comprehensive database of harmful ingredients
    this.harmfulIngredients = {
      // Artificial Sweeteners
      'aspartame': {
        severity: 'high',
        category: 'artificial_sweetener',
        risks: ['headaches', 'mood disorders', 'potential carcinogen'],
        commonIn: ['diet sodas', 'sugar-free products'],
        alternativeName: ['E951', 'Equal', 'NutraSweet'],
        personalizedRisk: {
          pregnancy: 'very_high',
          diabetes: 'medium',
          children: 'high'
        }
      },
      'high fructose corn syrup': {
        severity: 'high',
        category: 'sweetener',
        risks: ['obesity', 'diabetes', 'liver damage', 'metabolic syndrome'],
        commonIn: ['sodas', 'processed foods', 'candy'],
        alternativeName: ['HFCS', 'corn syrup', 'glucose-fructose syrup'],
        personalizedRisk: {
          diabetes: 'very_high',
          obesity: 'very_high',
          children: 'high'
        }
      },
      'monosodium glutamate': {
        severity: 'medium',
        category: 'flavor_enhancer',
        risks: ['headaches', 'nausea', 'chest pain', 'MSG symptom complex'],
        commonIn: ['chips', 'instant noodles', 'chinese food'],
        alternativeName: ['MSG', 'E621', 'glutamic acid', 'yeast extract'],
        personalizedRisk: {
          hypertension: 'high',
          migraine_sufferers: 'very_high'
        }
      },
      
      // Trans Fats
      'partially hydrogenated oil': {
        severity: 'very_high',
        category: 'trans_fat',
        risks: ['heart disease', 'stroke', 'diabetes', 'inflammation'],
        commonIn: ['baked goods', 'margarine', 'fried foods'],
        alternativeName: ['trans fat', 'hydrogenated oil', 'shortening'],
        personalizedRisk: {
          heart_disease: 'very_high',
          hypertension: 'very_high',
          diabetes: 'high'
        }
      },
      
      // Preservatives
      'sodium nitrite': {
        severity: 'high',
        category: 'preservative',
        risks: ['cancer', 'methemoglobinemia', 'heart disease'],
        commonIn: ['processed meats', 'bacon', 'hot dogs'],
        alternativeName: ['E250', 'sodium nitrate', 'E251'],
        personalizedRisk: {
          pregnancy: 'very_high',
          cancer_risk: 'very_high',
          children: 'high'
        }
      },
      'bha': {
        severity: 'high',
        category: 'preservative',
        risks: ['potential carcinogen', 'hormone disruption', 'liver damage'],
        commonIn: ['cereals', 'chips', 'butter'],
        alternativeName: ['butylated hydroxyanisole', 'E320'],
        personalizedRisk: {
          hormone_sensitive: 'very_high',
          liver_disease: 'high'
        }
      },
      'bht': {
        severity: 'high',
        category: 'preservative',
        risks: ['potential carcinogen', 'kidney damage', 'liver damage'],
        commonIn: ['cereals', 'chewing gum', 'potato chips'],
        alternativeName: ['butylated hydroxytoluene', 'E321'],
        personalizedRisk: {
          kidney_disease: 'very_high',
          liver_disease: 'high'
        }
      },
      
      // Food Dyes
      'red 40': {
        severity: 'medium',
        category: 'artificial_color',
        risks: ['hyperactivity', 'allergies', 'potential carcinogen'],
        commonIn: ['candy', 'sodas', 'cereals'],
        alternativeName: ['allura red', 'E129', 'red dye #40'],
        personalizedRisk: {
          adhd: 'very_high',
          children: 'high',
          allergies: 'high'
        }
      },
      'yellow 5': {
        severity: 'medium',
        category: 'artificial_color',
        risks: ['hyperactivity', 'allergies', 'asthma'],
        commonIn: ['candy', 'chips', 'sodas'],
        alternativeName: ['tartrazine', 'E102', 'yellow dye #5'],
        personalizedRisk: {
          adhd: 'very_high',
          asthma: 'high',
          allergies: 'high'
        }
      },
      'yellow 6': {
        severity: 'medium',
        category: 'artificial_color',
        risks: ['hyperactivity', 'allergies', 'adrenal tumors'],
        commonIn: ['cheese products', 'candy', 'baked goods'],
        alternativeName: ['sunset yellow', 'E110', 'yellow dye #6'],
        personalizedRisk: {
          adhd: 'very_high',
          children: 'high'
        }
      },
      
      // Emulsifiers & Thickeners
      'carrageenan': {
        severity: 'medium',
        category: 'thickener',
        risks: ['inflammation', 'digestive issues', 'potential carcinogen'],
        commonIn: ['dairy alternatives', 'deli meats', 'infant formula'],
        alternativeName: ['E407', 'irish moss'],
        personalizedRisk: {
          ibs: 'very_high',
          digestive_issues: 'high',
          inflammation: 'high'
        }
      },
      'polysorbate 80': {
        severity: 'medium',
        category: 'emulsifier',
        risks: ['gut inflammation', 'metabolic syndrome', 'cancer risk'],
        commonIn: ['ice cream', 'salad dressings', 'cosmetics'],
        alternativeName: ['E433', 'tween 80'],
        personalizedRisk: {
          ibs: 'high',
          crohns: 'very_high',
          metabolic_syndrome: 'high'
        }
      },
      
      // Hidden Sugars
      'maltodextrin': {
        severity: 'medium',
        category: 'hidden_sugar',
        risks: ['blood sugar spikes', 'gut bacteria disruption', 'weight gain'],
        commonIn: ['sports drinks', 'snacks', 'artificial sweeteners'],
        alternativeName: ['corn syrup solids', 'modified corn starch'],
        personalizedRisk: {
          diabetes: 'very_high',
          obesity: 'high',
          gut_issues: 'medium'
        }
      },
      'dextrose': {
        severity: 'medium',
        category: 'hidden_sugar',
        risks: ['blood sugar spikes', 'tooth decay', 'obesity'],
        commonIn: ['processed foods', 'baked goods', 'lunch meats'],
        alternativeName: ['corn sugar', 'glucose', 'd-glucose'],
        personalizedRisk: {
          diabetes: 'very_high',
          obesity: 'high'
        }
      },
      
      // Flavor Enhancers
      'natural flavors': {
        severity: 'low',
        category: 'ambiguous',
        risks: ['hidden allergens', 'unknown chemicals', 'msg derivatives'],
        commonIn: ['almost all processed foods'],
        alternativeName: ['natural flavoring', 'flavor'],
        personalizedRisk: {
          allergies: 'medium',
          chemical_sensitive: 'high'
        }
      },
      'yeast extract': {
        severity: 'low',
        category: 'hidden_msg',
        risks: ['hidden MSG', 'headaches', 'digestive issues'],
        commonIn: ['chips', 'crackers', 'soups'],
        alternativeName: ['autolyzed yeast', 'yeast nutrient'],
        personalizedRisk: {
          msg_sensitive: 'very_high',
          migraine_sufferers: 'high'
        }
      }
    };

    // Ultra-processed food indicators
    this.ultraProcessedIndicators = [
      'modified', 'enriched', 'fortified', 'concentrate', 'isolate',
      'hydrolyzed', 'hydrogenated', 'interesterified', 'extract'
    ];

    // Marketing tricks to expose
    this.marketingTricks = {
      'no sugar added': 'May still contain natural sugars or artificial sweeteners',
      'all natural': 'Meaningless term - arsenic is natural too!',
      'made with real fruit': 'Often just a tiny amount of fruit concentrate',
      'multi-grain': 'Not the same as whole grain - often refined grains',
      'lightly sweetened': 'Still contains significant sugar',
      'fat free': 'Often loaded with sugar to compensate for taste',
      'organic': 'Can still be highly processed and unhealthy',
      'gluten free': 'Often replaced with unhealthy alternatives',
      'fortified': 'Synthetic vitamins added to poor quality food',
      'no artificial flavors': 'Natural flavors can be just as processed'
    };
  }

  // Analyze ingredients and return detailed warnings
  async analyzeIngredients(ingredientsList, userProfile) {
    const analysis = {
      harmfulIngredients: [],
      hiddenSugars: [],
      marketingTricks: [],
      additiveCount: 0,
      processingLevel: 'minimally_processed',
      healthScore: 100,
      personalizedWarnings: [],
      betterAlternatives: []
    };

    // Handle different input types
    if (!ingredientsList) {
      return analysis; // Return empty analysis if no ingredients
    }

    let ingredients = '';
    if (Array.isArray(ingredientsList)) {
      ingredients = ingredientsList.join(', ').toLowerCase();
    } else if (typeof ingredientsList === 'string') {
      ingredients = ingredientsList.toLowerCase();
    } else {
      console.warn('Invalid ingredients type:', typeof ingredientsList);
      return analysis; // Return empty analysis for invalid types
    }

    const ingredientArray = ingredients.split(/,|\(|\)|;/).map(i => i.trim());
    
    // Check each harmful ingredient
    for (const [ingredient, data] of Object.entries(this.harmfulIngredients)) {
      // Check main name and alternatives
      const names = [ingredient, ...data.alternativeName];
      const found = names.some(name => 
        ingredients.includes(name.toLowerCase()) ||
        ingredientArray.some(ing => ing.includes(name.toLowerCase()))
      );
      
      if (found) {
        // Calculate personalized risk
        let personalRisk = data.severity;
        if (userProfile.health_conditions) {
          for (const condition of userProfile.health_conditions) {
            if (data.personalizedRisk[condition]) {
              personalRisk = data.personalizedRisk[condition];
              break;
            }
          }
        }
        
        analysis.harmfulIngredients.push({
          name: ingredient,
          severity: data.severity,
          personalSeverity: personalRisk,
          category: data.category,
          risks: data.risks,
          whyBad: this.getDetailedExplanation(ingredient, data, userProfile),
          alternativeProducts: this.suggestAlternatives(data.commonIn[0])
        });
        
        // Deduct health score
        const deduction = personalRisk === 'very_high' ? 20 : 
                         personalRisk === 'high' ? 15 : 
                         personalRisk === 'medium' ? 10 : 5;
        analysis.healthScore -= deduction;
      }
    }
    
    // Count additives (E-numbers, long chemical names)
    analysis.additiveCount = ingredientArray.filter(ing => 
      ing.match(/^e\d{3}/) || ing.split(' ').some(word => word.length > 15)
    ).length;
    
    // Determine processing level
    const ultraProcessedCount = this.ultraProcessedIndicators.filter(indicator =>
      ingredients.includes(indicator)
    ).length;
    
    if (ultraProcessedCount > 3 || analysis.additiveCount > 10) {
      analysis.processingLevel = 'ultra_processed';
      analysis.healthScore -= 20;
    } else if (ultraProcessedCount > 1 || analysis.additiveCount > 5) {
      analysis.processingLevel = 'highly_processed';
      analysis.healthScore -= 10;
    } else if (analysis.additiveCount > 2) {
      analysis.processingLevel = 'processed';
      analysis.healthScore -= 5;
    }
    
    // Check for hidden sugars
    const sugarKeywords = ['syrup', 'ose', 'sugar', 'sweetener', 'nectar', 'honey', 'agave'];
    analysis.hiddenSugars = ingredientArray.filter(ing =>
      sugarKeywords.some(keyword => ing.includes(keyword))
    );
    
    // Generate personalized warnings
    analysis.personalizedWarnings = this.generatePersonalizedWarnings(
      analysis,
      userProfile
    );
    
    // Suggest better alternatives
    analysis.betterAlternatives = await this.suggestBetterAlternatives(
      ingredientsList,
      analysis.processingLevel
    );
    
    // Ensure health score doesn't go below 0
    analysis.healthScore = Math.max(0, analysis.healthScore);
    
    return analysis;
  }

  // Get detailed explanation of why ingredient is bad
  getDetailedExplanation(ingredient, data, userProfile) {
    let explanation = `⚠️ ${ingredient.toUpperCase()} DETECTED!\n\n`;
    
    explanation += `🔬 What is it?\n`;
    explanation += `A ${data.category.replace('_', ' ')} commonly found in ${data.commonIn.join(', ')}.\n\n`;
    
    explanation += `☠️ Why it's harmful:\n`;
    data.risks.forEach((risk, index) => {
      explanation += `${index + 1}. ${risk.charAt(0).toUpperCase() + risk.slice(1)}\n`;
    });
    
    // Add personal risk if applicable
    if (userProfile.health_conditions) {
      for (const condition of userProfile.health_conditions) {
        if (data.personalizedRisk[condition]) {
          explanation += `\n🚨 ESPECIALLY DANGEROUS FOR YOU: `;
          explanation += `With ${condition.replace('_', ' ')}, this ingredient poses ${data.personalizedRisk[condition].replace('_', ' ')} risk!\n`;
          break;
        }
      }
    }
    
    explanation += `\n💡 Also hidden as: ${data.alternativeName.join(', ')}`;
    
    return explanation;
  }

  // Generate personalized warnings based on user profile
  generatePersonalizedWarnings(analysis, userProfile) {
    const warnings = [];
    
    // For diabetics
    if (userProfile.health_conditions?.includes('diabetes')) {
      if (analysis.hiddenSugars.length > 3) {
        warnings.push({
          severity: 'critical',
          message: '🚨 DIABETES ALERT: This product contains ${analysis.hiddenSugars.length} different types of sugar! Your blood glucose will spike dangerously.',
          action: 'AVOID THIS PRODUCT - Look for items with <5g total sugars'
        });
      }
    }
    
    // For parents
    if (userProfile.has_children || userProfile.health_conditions?.includes('pregnancy')) {
      const childHarmful = analysis.harmfulIngredients.filter(ing =>
        ing.personalSeverity === 'very_high' || ing.severity === 'high'
      );
      if (childHarmful.length > 0) {
        warnings.push({
          severity: 'critical',
          message: `👶 CHILD SAFETY: Contains ${childHarmful.length} ingredients linked to developmental issues and hyperactivity!`,
          action: 'Choose organic, whole food alternatives for your family'
        });
      }
    }
    
    // For weight loss
    if (userProfile.goal === 'weight_loss') {
      if (analysis.processingLevel === 'ultra_processed') {
        warnings.push({
          severity: 'high',
          message: '⚖️ WEIGHT LOSS SABOTAGE: Ultra-processed foods are designed to make you overeat and crave more!',
          action: 'This will make weight loss nearly impossible - choose whole foods instead'
        });
      }
    }
    
    // For gut health
    if (userProfile.health_conditions?.includes('ibs') || userProfile.health_conditions?.includes('digestive_issues')) {
      const gutHarmful = analysis.harmfulIngredients.filter(ing =>
        ['emulsifier', 'thickener', 'preservative'].includes(ing.category)
      );
      if (gutHarmful.length > 0) {
        warnings.push({
          severity: 'high',
          message: `🦠 GUT HEALTH DESTROYER: Contains ${gutHarmful.length} ingredients that damage gut bacteria and intestinal lining!`,
          action: 'Your digestive issues will worsen - choose fermented, probiotic foods'
        });
      }
    }
    
    return warnings;
  }

  // Suggest alternatives for a specific product
  suggestAlternatives(productType) {
    const alternatives = {
      chips: ['Baked chips', 'Air-popped popcorn', 'Vegetable chips'],
      soda: ['Sparkling water', 'Fresh juice', 'Coconut water'],
      candy: ['Dark chocolate', 'Fresh fruits', 'Dried fruits'],
      noodles: ['Whole wheat pasta', 'Rice noodles', 'Zucchini noodles'],
      cookies: ['Oat cookies', 'Homemade cookies', 'Fruit bars']
    };
    
    // Find matching category
    const productLower = (productType || '').toLowerCase();
    for (const [key, alts] of Object.entries(alternatives)) {
      if (productLower.includes(key)) {
        return alts;
      }
    }
    
    return ['Whole foods', 'Fresh alternatives', 'Homemade versions'];
  }

  // Suggest better alternatives
  async suggestBetterAlternatives(productType, processingLevel) {
    // Ensure productType is a string
    if (!productType || typeof productType !== 'string') {
      productType = 'food';
    }
    
    const alternatives = {
      'chips': ['Air-popped popcorn', 'Baked vegetable chips', 'Roasted chickpeas', 'Nuts'],
      'soda': ['Sparkling water with lemon', 'Kombucha', 'Fresh fruit juice', 'Herbal tea'],
      'candy': ['Dark chocolate (70%+)', 'Fresh fruits', 'Dates', 'Frozen grapes'],
      'cereal': ['Steel-cut oats', 'Chia pudding', 'Homemade granola', 'Eggs'],
      'bread': ['Ezekiel bread', 'Sourdough', 'Lettuce wraps', 'Sweet potato'],
      'yogurt': ['Plain Greek yogurt', 'Coconut yogurt', 'Kefir', 'Skyr'],
      'processed_meat': ['Fresh grilled chicken', 'Wild salmon', 'Beans', 'Tofu']
    };
    
    // Find the best match
    for (const [key, alts] of Object.entries(alternatives)) {
      if (productType.toLowerCase().includes(key)) {
        return alts.map(alt => ({
          name: alt,
          whyBetter: this.explainWhyBetter(alt, processingLevel)
        }));
      }
    }
    
    // Generic alternatives based on processing level
    if (processingLevel === 'ultra_processed') {
      return [
        { name: 'Any whole, single-ingredient food', whyBetter: 'No additives, preservatives, or hidden ingredients' },
        { name: 'Home-cooked version', whyBetter: 'You control every ingredient' },
        { name: 'Organic alternative', whyBetter: 'Fewer pesticides and no GMOs' }
      ];
    }
    
    return [];
  }

  // Explain why alternative is better
  explainWhyBetter(alternative, currentProcessingLevel) {
    const benefits = {
      'Air-popped popcorn': 'Whole grain, high fiber, no oils or additives',
      'Dark chocolate (70%+)': 'Antioxidants, less sugar, actual cacao benefits',
      'Plain Greek yogurt': 'High protein, probiotics, no added sugars',
      'Ezekiel bread': 'Sprouted grains, complete proteins, no preservatives',
      'Fresh grilled chicken': 'No nitrites, real protein, no processing',
      'Sparkling water with lemon': 'Zero calories, natural flavor, hydrating'
    };
    
    return benefits[alternative] || 'Minimally processed, nutrient-dense whole food';
  }

  // Generate shock factor message
  generateShockMessage(analysis) {
    if (analysis.healthScore < 20) {
      return "🚫 This is NOT FOOD - it's a chemistry experiment! Your body doesn't recognize 80% of these ingredients.";
    } else if (analysis.harmfulIngredients.length > 5) {
      return `☠️ TOXIC COCKTAIL: ${analysis.harmfulIngredients.length} harmful chemicals detected! This product is slowly poisoning you.`;
    } else if (analysis.hiddenSugars.length > 4) {
      return "🍭 SUGAR BOMB DISGUISED AS FOOD: More sugar varieties than a candy factory!";
    } else if (analysis.processingLevel === 'ultra_processed') {
      return "🏭 FACTORY FAKE FOOD: This has been so processed, there's nothing natural left!";
    } else if (analysis.additiveCount > 10) {
      return `🧪 CHEMICAL SOUP: ${analysis.additiveCount} additives! More ingredients than a science lab!`;
    }
    
    return "⚠️ QUESTIONABLE PRODUCT: Multiple concerning ingredients detected.";
  }

  // Expose marketing tricks
  exposeMarketingTricks(packaging, claims) {
    const exposed = [];
    
    for (const [claim, truth] of Object.entries(this.marketingTricks)) {
      if (packaging.toLowerCase().includes(claim) || claims.toLowerCase().includes(claim)) {
        exposed.push({
          claim: claim,
          truth: truth,
          emoji: '🎭'
        });
      }
    }
    
    return exposed;
  }
}

module.exports = new IngredientAnalyzer();