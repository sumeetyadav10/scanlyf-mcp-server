const openai = require('openai');

class BrutalIngredientAnalyzer {
  constructor() {
    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }

    // Define our honest health agents
    this.agents = {
      toxicologist: {
        name: 'Dr. HealthGuard',
        role: 'Explain how ingredients affect your body',
        personality: 'Honest health expert who studies food chemicals'
      },
      oncologist: {
        name: 'Dr. SafetyFirst',
        role: 'Discuss health risks clearly',
        personality: 'Medical expert focused on prevention'
      },
      neurologist: {
        name: 'Dr. BrainHealth',
        role: 'Explain effects on cognitive function',
        personality: 'Neurologist who studies food additives'
      },
      metabolicExpert: {
        name: 'Dr. MetabolicHealth',
        role: 'Show how ingredients affect metabolism',
        personality: 'Endocrinologist focused on metabolic health'
      },
      gutSpecialist: {
        name: 'Dr. GutHealth',
        role: 'Explain digestive system impacts',
        personality: 'Gastroenterologist who studies gut health'
      }
    };
  }

  async analyzeFoodWithBrutalHonesty(foodData, userProfile = {}) {
    if (!foodData.harmfulIngredients || foodData.harmfulIngredients.length === 0) {
      return this.getCleanFoodResponse(foodData);
    }

    // Get analysis from each agent
    const analyses = await Promise.all([
      this.getToxicologistAnalysis(foodData, userProfile),
      this.getOncologistAnalysis(foodData, userProfile),
      this.getNeurologistAnalysis(foodData, userProfile),
      this.getMetabolicAnalysis(foodData, userProfile),
      this.getGutAnalysis(foodData, userProfile)
    ]);

    // Combine all analyses into a brutal truth report
    return this.formatBrutalTruthReport(foodData, analyses, userProfile);
  }

  async getToxicologistAnalysis(foodData, userProfile) {
    const { harmfulIngredients } = foodData;
    
    const prompt = `You are Dr. ToxinTruth, a toxicologist who has spent 20 years studying how food chemicals harm human bodies. You're deeply concerned about ${foodData.name} containing these toxins: ${harmfulIngredients.map(i => i.name).join(', ')}.

Be COMPLETELY HONEST about health impacts. Be direct and clear. Make it personal - "your body", "your health". 

User conditions: ${JSON.stringify(userProfile.health_conditions || [])}

Format: 2-3 hard-hitting sentences that will make them think twice.`;

    if (!this.openaiClient) {
      return this.getFallbackToxicologistResponse(harmfulIngredients);
    }

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });
      return completion.choices[0].message.content;
    } catch (error) {
      return this.getFallbackToxicologistResponse(harmfulIngredients);
    }
  }

  async getOncologistAnalysis(foodData, userProfile) {
    const carcinogens = foodData.harmfulIngredients.filter(i => 
      i.risks.some(r => r.toLowerCase().includes('cancer') || r.toLowerCase().includes('carcinogen'))
    );
    
    if (carcinogens.length === 0) return null;

    const prompt = `You are Dr. CancerWatch, an oncologist who has treated thousands of cancer patients. You're analyzing ${foodData.name} which contains KNOWN CARCINOGENS: ${carcinogens.map(i => i.name).join(', ')}.

Explain the REAL HEALTH RISKS clearly. Reference medical research. Make it personal and impactful but factual.

Format: 2-3 sentences that expose the cancer risk without mercy.`;

    if (!this.openaiClient) {
      return this.getFallbackOncologistResponse(carcinogens);
    }

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });
      return completion.choices[0].message.content;
    } catch (error) {
      return this.getFallbackOncologistResponse(carcinogens);
    }
  }

  async getNeurologistAnalysis(foodData, userProfile) {
    const neurotoxins = foodData.harmfulIngredients.filter(i => 
      i.name.toLowerCase().includes('msg') || 
      i.name.toLowerCase().includes('aspartame') ||
      i.risks.some(r => r.toLowerCase().includes('neuro') || r.toLowerCase().includes('brain'))
    );
    
    if (neurotoxins.length === 0) return null;

    const prompt = `You are Dr. BrainDamage, a neurologist who sees cognitive decline daily. ${foodData.name} contains NEUROTOXINS: ${neurotoxins.map(i => i.name).join(', ')}.

Explain the BRUTAL TRUTH about brain damage. Use terms like "brain fog", "memory loss", "neuron death". Make them understand their brain is under attack.

Format: 2-3 sentences of neurological horror they need to hear.`;

    if (!this.openaiClient) {
      return this.getFallbackNeurologistResponse(neurotoxins);
    }

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });
      return completion.choices[0].message.content;
    } catch (error) {
      return this.getFallbackNeurologistResponse(neurotoxins);
    }
  }

  async getMetabolicAnalysis(foodData, userProfile) {
    const metabolicWreckers = foodData.harmfulIngredients.filter(i => 
      i.name.toLowerCase().includes('hfcs') || 
      i.name.toLowerCase().includes('trans') ||
      i.risks.some(r => r.toLowerCase().includes('diabetes') || r.toLowerCase().includes('obesity'))
    );
    
    if (metabolicWreckers.length === 0) return null;

    if (!this.openaiClient) {
      return this.getFallbackMetabolicResponse(metabolicWreckers, foodData);
    }

    const prompt = `You are Dr. MetabolicMeltdown, an endocrinologist tired of seeing damaged metabolisms. ${foodData.name} contains: ${metabolicWreckers.map(i => i.name).join(', ')}.

Tell them how this DAMAGES their metabolism. Use terms like "insulin resistance", "fatty liver", "metabolic syndrome". Be HARSH about weight gain and diabetes risk.

User has: ${userProfile.health_conditions?.join(', ') || 'no conditions'}

Format: 2-3 sentences that scare them straight about metabolic damage.`;

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });
      return completion.choices[0].message.content;
    } catch (error) {
      return this.getFallbackMetabolicResponse(metabolicWreckers, foodData);
    }
  }

  async getGutAnalysis(foodData, userProfile) {
    const gutDestroyers = foodData.harmfulIngredients.filter(i => 
      i.category === 'preservative' || 
      i.category === 'emulsifier' ||
      i.risks.some(r => r.toLowerCase().includes('gut') || r.toLowerCase().includes('digest'))
    );
    
    if (gutDestroyers.length === 0) return null;

    if (!this.openaiClient) {
      return this.getFallbackGutResponse(gutDestroyers);
    }

    const prompt = `You are Dr. GutWrecker, a gastroenterologist who sees damaged digestive systems daily. ${foodData.name} contains: ${gutDestroyers.map(i => i.name).join(', ')}.

Explain how these OBLITERATE gut health. Talk about "leaky gut", "inflammation", "microbiome genocide". Make it visceral and disturbing.

Format: 2-3 sentences about digestive destruction.`;

    try {
      const completion = await this.openaiClient.chat.completions.create({
        model: 'gpt-4',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 150
      });
      return completion.choices[0].message.content;
    } catch (error) {
      return this.getFallbackGutResponse(gutDestroyers);
    }
  }

  formatBrutalTruthReport(foodData, analyses, userProfile) {
    const [toxicologist, oncologist, neurologist, metabolic, gut] = analyses;
    
    let report = `⚠️ Health Analysis for ${foodData.name} ⚠️

📋 Important Health Information:
${foodData.harmfulIngredients.length} concerning ingredients found:

`;

    // List harmful ingredients with warning symbols
    foodData.harmfulIngredients.forEach(ing => {
      const emoji = ing.severity === 'critical' ? '⚠️' : ing.severity === 'high' ? '❗' : '❕';
      report += `${emoji} ${ing.name}\n`;
    });

    report += `

🧬 Health Impact Analysis:
${toxicologist}

`;

    if (oncologist) {
      report += `🎗️ Medical Review:
${oncologist}

`;
    }

    if (neurologist) {
      report += `🧠 Cognitive Effects:
${neurologist}

`;
    }

    if (metabolic) {
      report += `⚡ Metabolic Impact:
${metabolic}

`;
    }

    if (gut) {
      report += `🦠 Digestive Health:
${gut}

`;
    }

    // Add long-term consequences
    report += `
⏰ Long-term Health Effects:
`;

    const consequences = this.getLongTermConsequences(foodData.harmfulIngredients);
    consequences.forEach(c => {
      report += `• ${c}\n`;
    });

    // Add personalized warning for user conditions
    if (userProfile.health_conditions && userProfile.health_conditions.length > 0) {
      report += `
🚫 Special Considerations for Your Health:
`;
      userProfile.health_conditions.forEach(condition => {
        const warning = this.getConditionSpecificWarning(condition, foodData.harmfulIngredients);
        if (warning) {
          report += `• ${condition}: ${warning}\n`;
        }
      });
    }

    // End with alternatives
    report += `

✅ Healthier Alternatives to Consider:
`;

    const alternatives = this.getBrutalAlternatives(foodData.name);
    alternatives.forEach(alt => {
      report += `• ${alt}\n`;
    });

    report += `

🏥 HEALTH IMPACT SCORE: ${this.calculateHealthImpact(foodData.harmfulIngredients)}/10
⚠️ POTENTIAL HEALTH ISSUES: ${this.predictHealthIssues(foodData.harmfulIngredients)}
💸 MEDICAL COSTS OVER TIME: ₹${this.calculateMedicalCosts(foodData.harmfulIngredients)}

Think twice before consuming this regularly.`;

    return report;
  }

  // Fallback responses when GPT-4 isn't available
  getFallbackToxicologistResponse(ingredients) {
    const worst = ingredients[0];
    if (worst.name.toLowerCase().includes('msg')) {
      return "MSG can overstimulate nerve cells and may cause headaches in sensitive individuals. Regular consumption has been linked to various health concerns. Consider foods without this additive.";
    } else if (worst.name.toLowerCase().includes('trans')) {
      return "Trans fats are artificial fats that negatively impact cardiovascular health. They raise bad cholesterol while lowering good cholesterol, increasing heart disease risk.";
    } else if (worst.name.toLowerCase().includes('nitrite')) {
      return "Sodium nitrite can form compounds in your body that are linked to increased health risks. Regular consumption has been associated with various health concerns.";
    } else {
      return `${worst.name} is a synthetic additive that may impact your health over time. It serves no nutritional purpose and is primarily used for shelf life extension.`;
    }
  }

  getFallbackOncologistResponse(carcinogens) {
    const worst = carcinogens[0];
    return `${worst.name} has been linked to increased health risks by medical organizations. Studies show associations with various health concerns. The effects may accumulate over time with regular consumption.`;
  }

  getFallbackNeurologistResponse(neurotoxins) {
    const worst = neurotoxins[0];
    if (worst.name.toLowerCase().includes('msg')) {
      return "MSG may cause cognitive effects in some people, including difficulty concentrating. Some individuals experience neurological symptoms after consumption.";
    } else if (worst.name.toLowerCase().includes('aspartame')) {
      return "Aspartame metabolizes into compounds that may affect brain function in sensitive individuals. Some people report neurological symptoms with regular consumption.";
    } else {
      return `${worst.name} may affect neurological function. Some people experience headaches or mood changes with regular consumption.`;
    }
  }

  getFallbackMetabolicResponse(ingredients, foodData) {
    if (ingredients.some(i => i.name.toLowerCase().includes('hfcs'))) {
      return `High Fructose Corn Syrup affects metabolism differently than regular sugar. It bypasses satiety signals and contributes to fat storage, particularly in the liver. Regular consumption is linked to metabolic issues.`;
    } else if (ingredients.some(i => i.name.toLowerCase().includes('trans'))) {
      return `Trans fats negatively impact metabolism and insulin sensitivity. They contribute to fat storage around organs and are associated with increased health risks. Your body processes these fats poorly.`;
    } else {
      return `These ingredients may negatively impact your metabolism. They can affect insulin levels and fat storage patterns. Regular consumption is associated with metabolic health concerns.`;
    }
  }

  getFallbackGutResponse(ingredients) {
    const worst = ingredients[0];
    if (worst.category === 'preservative') {
      return `${worst.name} has antibacterial properties that may affect your gut bacteria balance. This can impact digestion and overall gut health.`;
    } else if (worst.category === 'emulsifier') {
      return `${worst.name} may affect intestinal lining integrity. Some studies link emulsifiers to digestive issues and increased intestinal permeability.`;
    } else {
      return `${worst.name} may negatively impact gut health and beneficial bacteria. This can lead to digestive discomfort and other health concerns.`;
    }
  }

  getLongTermConsequences(ingredients) {
    const consequences = new Set();
    
    ingredients.forEach(ing => {
      if (ing.risks.some(r => r.includes('cancer'))) {
        consequences.add('Increased risk of certain health conditions');
      }
      if (ing.risks.some(r => r.includes('heart'))) {
        consequences.add('Higher risk of cardiovascular issues');
      }
      if (ing.risks.some(r => r.includes('diabetes'))) {
        consequences.add('Increased risk of metabolic disorders');
      }
      if (ing.risks.some(r => r.includes('liver'))) {
        consequences.add('Potential liver health concerns');
      }
      if (ing.name.toLowerCase().includes('msg') || ing.name.toLowerCase().includes('aspartame')) {
        consequences.add('Possible cognitive health impacts');
      }
    });

    if (consequences.size === 0) {
      consequences.add('Increased inflammation in the body');
      consequences.add('Accelerated aging processes');
      consequences.add('Compromised immune function');
    }

    return Array.from(consequences);
  }

  getConditionSpecificWarning(condition, ingredients) {
    const warnings = {
      diabetes: 'These ingredients may affect blood sugar levels and metabolic health',
      hypertension: 'Contains elements that may impact blood pressure',
      pregnancy: 'Some ingredients may not be recommended during pregnancy',
      heart_disease: 'These ingredients may affect cardiovascular health',
      obesity: 'These ingredients may contribute to weight management challenges'
    };
    
    return warnings[condition] || `Extra dangerous with ${condition} - accelerates disease progression`;
  }

  getBrutalAlternatives(foodName) {
    const name = foodName.toLowerCase();
    
    if (name.includes('chips') || name.includes('lay') || name.includes('bhujia')) {
      return [
        'Air-popped popcorn with sea salt',
        'Roasted chickpeas or makhana',
        'Homemade vegetable chips'
      ];
    } else if (name.includes('soda') || name.includes('cola')) {
      return [
        'Sparkling water with fresh lemon',
        'Green tea or herbal tea',
        'Fresh water with mint or cucumber'
      ];
    } else if (name.includes('candy') || name.includes('chocolate')) {
      return [
        'Dark chocolate (85% cacao or higher)',
        'Fresh seasonal fruits',
        'Dates with nut butter'
      ];
    } else {
      return [
        'Fresh vegetables and fruits',
        'Whole, unprocessed foods',
        'Traditional homemade options'
      ];
    }
  }

  calculateHealthImpact(ingredients) {
    let score = 0;
    ingredients.forEach(ing => {
      if (ing.severity === 'critical') score += 3;
      else if (ing.severity === 'high') score += 2;
      else score += 1;
    });
    return Math.min(score, 10);
  }

  predictHealthIssues(ingredients) {
    const issues = [];
    
    if (ingredients.some(i => i.risks.some(r => r.includes('cancer')))) {
      issues.push('Increased health risks');
    }
    if (ingredients.some(i => i.name.toLowerCase().includes('msg') || i.name.toLowerCase().includes('aspartame'))) {
      issues.push('Potential neurological effects');
    }
    if (ingredients.some(i => i.name.toLowerCase().includes('trans'))) {
      issues.push('Cardiovascular concerns');
    }
    if (ingredients.some(i => i.risks.some(r => r.includes('diabetes')))) {
      issues.push('Blood sugar concerns');
    }
    
    return issues.length > 0 ? issues.join(', ') : 'General health decline';
  }

  calculateMedicalCosts(ingredients) {
    // Average medical costs in India for diet-related diseases
    const baseCost = 50000; // per year
    const multiplier = ingredients.length;
    const severity = ingredients.filter(i => i.severity === 'critical' || i.severity === 'high').length;
    
    return (baseCost * multiplier * severity * 10).toLocaleString('en-IN');
  }

  getCleanFoodResponse(foodData) {
    return `✅ ${foodData.name} - No concerning ingredients detected

This appears to be a wholesome food choice with minimal processing.

Continue making healthy food choices like this for better health.

Remember: Consistency in healthy eating leads to long-term benefits.`;
  }
}

module.exports = new BrutalIngredientAnalyzer();