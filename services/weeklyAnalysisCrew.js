const openai = require('openai');
const { getDb, collections } = require('../lib/firebase');
const personalizationEngine = require('./personalizationEngine');
const ingredientAnalyzer = require('./ingredientAnalyzer');
const webhookService = require('./webhookService');

class WeeklyAnalysisCrew {
  constructor() {
    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }

    // Define crew agents with specific roles
    this.agents = {
      nutritionist: {
        name: 'Dr. Nutrition',
        role: 'Expert nutritionist analyzing dietary patterns',
        focus: ['nutrient balance', 'deficiencies', 'meal timing', 'portion control']
      },
      behaviorist: {
        name: 'BehaviorBot',
        role: 'Behavioral psychologist identifying patterns and triggers',
        focus: ['emotional eating', 'habit formation', 'trigger identification', 'motivation']
      },
      healthCoach: {
        name: 'Coach Wellness',
        role: 'Health coach providing actionable strategies',
        focus: ['goal setting', 'accountability', 'lifestyle changes', 'sustainable habits']
      },
      dataAnalyst: {
        name: 'DataMind',
        role: 'Data scientist finding hidden patterns',
        focus: ['trends', 'correlations', 'predictions', 'anomalies']
      },
      toxicologist: {
        name: 'Dr. CleanEats',
        role: 'Food safety expert exposing harmful ingredients',
        focus: ['additives', 'preservatives', 'processing levels', 'long-term health risks']
      }
    };
  }

  // Run weekly analysis for a user
  async runWeeklyAnalysis(phone) {
    console.log(`🚀 Starting weekly analysis crew for ${phone}`);
    
    try {
      // Gather comprehensive data
      const userData = await this.gatherUserData(phone);
      
      // Run analysis with each agent
      const analyses = await this.runAgentAnalyses(userData);
      
      // Synthesize insights
      const synthesis = await this.synthesizeInsights(analyses, userData);
      
      // Generate action plan
      const actionPlan = await this.generateActionPlan(synthesis, userData);
      
      // Save analysis
      await this.saveAnalysis(phone, {
        analyses,
        synthesis,
        actionPlan,
        generatedAt: new Date().toISOString()
      });
      
      // Send webhook notification if configured
      await webhookService.sendWebhook(phone, 'weekly_analysis_complete', {
        summary: synthesis.executiveSummary,
        topInsights: synthesis.topInsights.slice(0, 3),
        urgentActions: actionPlan.urgentActions
      });
      
      return {
        success: true,
        analysis: {
          executiveSummary: synthesis.executiveSummary,
          keyFindings: synthesis.topInsights,
          recommendations: actionPlan.recommendations,
          urgentActions: actionPlan.urgentActions
        }
      };
    } catch (error) {
      console.error('Weekly analysis error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Gather comprehensive user data
  async gatherUserData(phone) {
    const [profile, logs, personality, mealPlans] = await Promise.all([
      this.getUserProfile(phone),
      this.getWeeklyLogs(phone),
      personalizationEngine.getUserPersonality(phone),
      this.getMealPlans(phone)
    ]);

    // Analyze food quality
    const foodQualityAnalysis = await this.analyzeFoodQuality(logs);
    
    // Get behavioral patterns
    const behaviorPatterns = await personalizationEngine.analyzeBehaviorPatterns(phone);
    
    return {
      phone,
      profile,
      logs,
      personality,
      mealPlans,
      foodQualityAnalysis,
      behaviorPatterns,
      weekStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    };
  }

  // Run analysis with each agent
  async runAgentAnalyses(userData) {
    if (!this.openaiClient) {
      return this.runTemplateAnalyses(userData);
    }

    const analyses = {};
    
    for (const [agentKey, agent] of Object.entries(this.agents)) {
      console.log(`🤖 ${agent.name} analyzing...`);
      
      try {
        const analysis = await this.runAgentAnalysis(agent, userData);
        analyses[agentKey] = analysis;
      } catch (error) {
        console.error(`Error with ${agent.name}:`, error);
        analyses[agentKey] = this.getTemplateAnalysis(agentKey, userData);
      }
    }
    
    return analyses;
  }

  // Run individual agent analysis
  async runAgentAnalysis(agent, userData) {
    const prompt = this.buildAgentPrompt(agent, userData);
    
    const response = await this.openaiClient.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: `You are ${agent.name}, a ${agent.role}. Focus on: ${agent.focus.join(', ')}.
          Provide specific, actionable insights based on the user's data.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.7
    });

    const content = response.choices[0].message.content;
    
    // Parse insights
    return {
      agentName: agent.name,
      role: agent.role,
      insights: this.parseAgentInsights(content),
      rawAnalysis: content,
      confidence: 0.85
    };
  }

  // Build agent-specific prompt
  buildAgentPrompt(agent, userData) {
    const baseInfo = `
User Profile:
- Age: ${userData.profile.age}, ${userData.profile.gender}
- Goal: ${userData.profile.goal}
- Health conditions: ${userData.profile.health_conditions?.join(', ') || 'none'}
- Personality type: ${userData.personality.personalityType}

Weekly Summary:
- Total meals logged: ${userData.logs.length}
- Average daily calories: ${this.calculateAverageCalories(userData.logs)}
- Most frequent foods: ${this.getTopFoods(userData.logs).join(', ')}
- Compliance rate: ${this.calculateComplianceRate(userData.logs, userData.profile)}%
`;

    // Agent-specific data
    if (agent.name === 'Dr. CleanEats') {
      return baseInfo + `
Harmful ingredients detected this week:
${JSON.stringify(userData.foodQualityAnalysis.harmfulIngredients, null, 2)}

Processing levels:
${JSON.stringify(userData.foodQualityAnalysis.processingBreakdown, null, 2)}

Analyze the long-term health impact of these eating patterns.`;
    } else if (agent.name === 'BehaviorBot') {
      return baseInfo + `
Behavior patterns:
${JSON.stringify(userData.behaviorPatterns, null, 2)}

Identify emotional eating triggers and suggest behavioral interventions.`;
    } else if (agent.name === 'DataMind') {
      return baseInfo + `
Time patterns: ${JSON.stringify(userData.behaviorPatterns.mealTimes, null, 2)}

Find correlations between meal timing, food choices, and goal achievement.`;
    }
    
    return baseInfo + '\nProvide your expert analysis and recommendations.';
  }

  // Synthesize insights from all agents
  async synthesizeInsights(analyses, userData) {
    const allInsights = [];
    const categories = {
      urgent: [],
      important: [],
      maintenance: [],
      positive: []
    };

    // Collect all insights
    Object.values(analyses).forEach(analysis => {
      if (analysis.insights) {
        allInsights.push(...analysis.insights);
        
        analysis.insights.forEach(insight => {
          if (insight.priority === 'urgent' || insight.severity === 'high') {
            categories.urgent.push(insight);
          } else if (insight.priority === 'important') {
            categories.important.push(insight);
          } else if (insight.type === 'positive') {
            categories.positive.push(insight);
          } else {
            categories.maintenance.push(insight);
          }
        });
      }
    });

    // Generate executive summary
    const executiveSummary = await this.generateExecutiveSummary(
      categories,
      userData,
      analyses
    );

    // Identify top insights
    const topInsights = this.prioritizeInsights(allInsights);

    // Find consensus patterns
    const consensusPatterns = this.findConsensusPatterns(analyses);

    return {
      executiveSummary,
      topInsights,
      categories,
      consensusPatterns,
      totalInsights: allInsights.length,
      agentAgreement: this.calculateAgentAgreement(analyses)
    };
  }

  // Generate executive summary
  async generateExecutiveSummary(categories, userData, analyses) {
    const weekPerformance = this.calculateWeekPerformance(userData);
    
    let summary = `📊 WEEKLY HEALTH INTELLIGENCE REPORT\n\n`;
    
    // Performance overview
    summary += `Overall Performance: ${weekPerformance.score}/10\n`;
    summary += `Goal Progress: ${weekPerformance.goalProgress}%\n\n`;
    
    // Critical findings
    if (categories.urgent.length > 0) {
      summary += `🚨 URGENT ATTENTION REQUIRED:\n`;
      categories.urgent.slice(0, 3).forEach(item => {
        summary += `• ${item.message}\n`;
      });
      summary += '\n';
    }
    
    // Toxicology report
    const toxReport = analyses.toxicologist;
    if (toxReport?.insights?.some(i => i.severity === 'high')) {
      summary += `☠️ TOXIC INGREDIENT ALERT:\n`;
      summary += `${userData.foodQualityAnalysis.worstOffenders.slice(0, 3).join(', ')} detected.\n`;
      summary += `Long-term risk: ${userData.foodQualityAnalysis.overallRisk}\n\n`;
    }
    
    // Behavioral insights
    if (userData.behaviorPatterns.triggerTimes.length > 0) {
      summary += `🧠 BEHAVIORAL PATTERN DETECTED:\n`;
      summary += `High-risk eating times: ${userData.behaviorPatterns.triggerTimes.map(h => `${h}:00`).join(', ')}\n\n`;
    }
    
    // Positive reinforcement
    if (categories.positive.length > 0) {
      summary += `✨ WINS THIS WEEK:\n`;
      categories.positive.slice(0, 2).forEach(item => {
        summary += `• ${item.message}\n`;
      });
    }
    
    return summary;
  }

  // Generate action plan
  async generateActionPlan(synthesis, userData) {
    const urgentActions = [];
    const recommendations = [];
    const habits = [];
    
    // Process urgent items
    synthesis.categories.urgent.forEach(item => {
      urgentActions.push({
        action: item.action || `Address: ${item.message}`,
        deadline: 'Within 24 hours',
        impact: 'High',
        category: item.category
      });
    });
    
    // Generate personalized recommendations
    if (userData.foodQualityAnalysis.overallRisk === 'high') {
      recommendations.push({
        title: 'Detox Your Diet',
        description: 'Replace ultra-processed foods with whole alternatives',
        steps: [
          'Identify your top 3 processed foods',
          'Find whole food alternatives',
          'Transition gradually over 2 weeks'
        ],
        priority: 'high'
      });
    }
    
    // Behavioral recommendations
    if (userData.behaviorPatterns.triggerTimes.length > 0) {
      recommendations.push({
        title: 'Master Your Trigger Times',
        description: 'Develop strategies for high-risk eating periods',
        steps: [
          `Set reminder 30 min before ${userData.behaviorPatterns.triggerTimes[0]}:00`,
          'Prepare healthy snacks in advance',
          'Practice the 5-minute pause rule'
        ],
        priority: 'medium'
      });
    }
    
    // Habit formation
    const personalityHabits = this.getPersonalityBasedHabits(userData.personality.personalityType);
    habits.push(...personalityHabits);
    
    // Weekly challenges
    const challenges = this.generateWeeklyChallenges(userData, synthesis);
    
    return {
      urgentActions,
      recommendations,
      habits,
      challenges,
      timeline: this.createImplementationTimeline(recommendations, habits)
    };
  }

  // Analyze food quality for the week
  async analyzeFoodQuality(logs) {
    const allIngredients = [];
    const harmfulIngredients = [];
    const processingLevels = {
      minimally_processed: 0,
      processed: 0,
      highly_processed: 0,
      ultra_processed: 0
    };
    
    for (const log of logs) {
      for (const food of log.foods || []) {
        if (food.ingredients) {
          const analysis = await ingredientAnalyzer.analyzeIngredients(
            food.ingredients,
            { health_conditions: log.health_conditions || [] }
          );
          
          harmfulIngredients.push(...analysis.harmfulIngredients);
          processingLevels[analysis.processingLevel]++;
          allIngredients.push(food.ingredients);
        }
      }
    }
    
    // Identify worst offenders
    const ingredientCounts = {};
    harmfulIngredients.forEach(ing => {
      ingredientCounts[ing.name] = (ingredientCounts[ing.name] || 0) + 1;
    });
    
    const worstOffenders = Object.entries(ingredientCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .slice(0, 5);
    
    // Calculate overall risk
    const totalFoods = Object.values(processingLevels).reduce((a, b) => a + b, 0);
    const ultraProcessedRatio = totalFoods > 0 ? processingLevels.ultra_processed / totalFoods : 0;
    const overallRisk = ultraProcessedRatio > 0.5 ? 'high' : 
                       ultraProcessedRatio > 0.3 ? 'medium' : 'low';
    
    return {
      harmfulIngredients,
      worstOffenders,
      processingBreakdown: processingLevels,
      overallRisk,
      recommendedDetox: overallRisk === 'high'
    };
  }

  // Template analyses (fallback when no AI)
  runTemplateAnalyses(userData) {
    return {
      nutritionist: this.getTemplateAnalysis('nutritionist', userData),
      behaviorist: this.getTemplateAnalysis('behaviorist', userData),
      healthCoach: this.getTemplateAnalysis('healthCoach', userData),
      dataAnalyst: this.getTemplateAnalysis('dataAnalyst', userData),
      toxicologist: this.getTemplateAnalysis('toxicologist', userData)
    };
  }

  // Get template analysis for specific agent
  getTemplateAnalysis(agentKey, userData) {
    const analyses = {
      nutritionist: {
        insights: [
          {
            type: 'nutrient_balance',
            message: `Protein intake ${userData.profile.protein_target ? 'adequate' : 'needs attention'}`,
            priority: 'important'
          }
        ]
      },
      behaviorist: {
        insights: [
          {
            type: 'pattern',
            message: `Identified ${userData.behaviorPatterns.triggerTimes.length} trigger times for overeating`,
            priority: userData.behaviorPatterns.triggerTimes.length > 2 ? 'urgent' : 'important'
          }
        ]
      },
      healthCoach: {
        insights: [
          {
            type: 'recommendation',
            message: 'Focus on consistency over perfection',
            priority: 'maintenance'
          }
        ]
      },
      dataAnalyst: {
        insights: [
          {
            type: 'trend',
            message: `${this.calculateComplianceRate(userData.logs, userData.profile)}% compliance rate this week`,
            priority: 'important'
          }
        ]
      },
      toxicologist: {
        insights: [
          {
            type: 'toxin',
            message: `${userData.foodQualityAnalysis.worstOffenders.length} harmful ingredients detected`,
            priority: userData.foodQualityAnalysis.overallRisk === 'high' ? 'urgent' : 'important',
            severity: userData.foodQualityAnalysis.overallRisk
          }
        ]
      }
    };
    
    return analyses[agentKey] || { insights: [] };
  }

  // Helper methods
  parseAgentInsights(content) {
    // Simple parsing - in production, use more sophisticated NLP
    const insights = [];
    const lines = content.split('\n').filter(line => line.trim());
    
    lines.forEach(line => {
      if (line.includes('urgent') || line.includes('critical')) {
        insights.push({
          message: line,
          priority: 'urgent',
          type: 'warning'
        });
      } else if (line.includes('recommend') || line.includes('suggest')) {
        insights.push({
          message: line,
          priority: 'important',
          type: 'recommendation'
        });
      } else if (line.includes('good') || line.includes('excellent') || line.includes('well')) {
        insights.push({
          message: line,
          priority: 'low',
          type: 'positive'
        });
      }
    });
    
    return insights;
  }

  prioritizeInsights(insights) {
    return insights
      .sort((a, b) => {
        const priorityOrder = { urgent: 0, important: 1, maintenance: 2, low: 3 };
        return (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3);
      })
      .slice(0, 10);
  }

  findConsensusPatterns(analyses) {
    const patterns = {};
    const allMessages = [];
    
    Object.values(analyses).forEach(analysis => {
      analysis.insights?.forEach(insight => {
        allMessages.push(insight.message.toLowerCase());
      });
    });
    
    // Find common themes
    const themes = ['protein', 'sugar', 'processed', 'timing', 'portion', 'vegetable'];
    themes.forEach(theme => {
      const count = allMessages.filter(msg => msg.includes(theme)).length;
      if (count >= 2) {
        patterns[theme] = count;
      }
    });
    
    return patterns;
  }

  calculateAgentAgreement(analyses) {
    // Simple agreement score based on similar priority insights
    let agreements = 0;
    let comparisons = 0;
    
    const agentList = Object.values(analyses);
    for (let i = 0; i < agentList.length - 1; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const priorities1 = agentList[i].insights?.map(i => i.priority) || [];
        const priorities2 = agentList[j].insights?.map(i => i.priority) || [];
        
        priorities1.forEach(p1 => {
          if (priorities2.includes(p1)) agreements++;
          comparisons++;
        });
      }
    }
    
    return comparisons > 0 ? Math.round((agreements / comparisons) * 100) : 0;
  }

  calculateWeekPerformance(userData) {
    const logs = userData.logs;
    const profile = userData.profile;
    
    let score = 5; // Base score
    
    // Compliance rate
    const compliance = this.calculateComplianceRate(logs, profile);
    score += (compliance / 100) * 2;
    
    // Food quality
    if (userData.foodQualityAnalysis.overallRisk === 'low') score += 1;
    else if (userData.foodQualityAnalysis.overallRisk === 'high') score -= 1;
    
    // Consistency
    if (logs.length >= 6) score += 1;
    
    // Goal progress
    const goalProgress = this.calculateGoalProgress(logs, profile);
    score += (goalProgress / 100);
    
    return {
      score: Math.min(10, Math.max(0, Math.round(score))),
      goalProgress: Math.round(goalProgress),
      compliance: Math.round(compliance)
    };
  }

  calculateComplianceRate(logs, profile) {
    if (!profile.calorie_target || logs.length === 0) return 0;
    
    let compliantDays = 0;
    logs.forEach(log => {
      const totalCalories = log.foods?.reduce((sum, f) => sum + (f.calories || 0), 0) || 0;
      if (Math.abs(totalCalories - profile.calorie_target) <= profile.calorie_target * 0.15) {
        compliantDays++;
      }
    });
    
    return (compliantDays / 7) * 100;
  }

  calculateGoalProgress(logs, profile) {
    // Simplified goal progress calculation
    const compliance = this.calculateComplianceRate(logs, profile);
    const consistency = (logs.length / 7) * 100;
    
    return (compliance + consistency) / 2;
  }

  calculateAverageCalories(logs) {
    const totalCalories = logs.reduce((sum, log) => {
      const dayCalories = log.foods?.reduce((s, f) => s + (f.calories || 0), 0) || 0;
      return sum + dayCalories;
    }, 0);
    
    return logs.length > 0 ? Math.round(totalCalories / logs.length) : 0;
  }

  getTopFoods(logs) {
    const foodCounts = {};
    
    logs.forEach(log => {
      log.foods?.forEach(food => {
        const name = food.name.toLowerCase();
        foodCounts[name] = (foodCounts[name] || 0) + 1;
      });
    });
    
    return Object.entries(foodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);
  }

  getPersonalityBasedHabits(personalityType) {
    const habitMap = {
      warrior: [
        {
          name: 'Morning Victory Ritual',
          description: 'Start each day with a protein-rich breakfast',
          frequency: 'daily'
        },
        {
          name: 'Conquer Cravings',
          description: '5 pushups before any unplanned snack',
          frequency: 'as needed'
        }
      ],
      scholar: [
        {
          name: 'Food Journal Deep Dive',
          description: 'Note how foods affect your energy and mood',
          frequency: 'daily'
        },
        {
          name: 'Weekly Nutrition Research',
          description: 'Learn about one new healthy food each week',
          frequency: 'weekly'
        }
      ],
      nurturer: [
        {
          name: 'Mindful Meal Moments',
          description: 'Take 3 deep breaths before each meal',
          frequency: 'daily'
        },
        {
          name: 'Gratitude Practice',
          description: 'Thank your body after healthy choices',
          frequency: 'daily'
        }
      ],
      pragmatist: [
        {
          name: 'Meal Prep Sunday',
          description: 'Prepare 3 healthy meals for the week',
          frequency: 'weekly'
        },
        {
          name: 'Smart Snack Setup',
          description: 'Stock healthy snacks in visible places',
          frequency: 'weekly'
        }
      ]
    };
    
    return habitMap[personalityType] || habitMap.pragmatist;
  }

  generateWeeklyChallenges(userData, synthesis) {
    const challenges = [];
    
    // Based on identified issues
    if (synthesis.categories.urgent.length > 0) {
      challenges.push({
        name: 'Clean Eating Challenge',
        description: 'Avoid all foods with harmful additives for 3 days',
        reward: '50 ScanlyfCoins',
        difficulty: 'hard'
      });
    }
    
    // Based on personality
    if (userData.personality.personalityType === 'warrior') {
      challenges.push({
        name: 'Perfect Day Warrior',
        description: 'Hit all nutrition targets for 3 consecutive days',
        reward: '30 ScanlyfCoins',
        difficulty: 'medium'
      });
    }
    
    // Universal challenge
    challenges.push({
      name: 'Hydration Hero',
      description: 'Drink 8 glasses of water daily for a week',
      reward: '20 ScanlyfCoins',
      difficulty: 'easy'
    });
    
    return challenges;
  }

  createImplementationTimeline(recommendations, habits) {
    const timeline = {
      immediate: [],
      thisWeek: [],
      nextWeek: [],
      thisMonth: []
    };
    
    // Prioritize based on urgency
    recommendations.forEach(rec => {
      if (rec.priority === 'high') {
        timeline.immediate.push(rec.title);
      } else if (rec.priority === 'medium') {
        timeline.thisWeek.push(rec.title);
      } else {
        timeline.nextWeek.push(rec.title);
      }
    });
    
    // Add habits gradually
    habits.forEach((habit, index) => {
      if (index === 0) {
        timeline.immediate.push(`Start: ${habit.name}`);
      } else if (index === 1) {
        timeline.thisWeek.push(`Start: ${habit.name}`);
      } else {
        timeline.nextWeek.push(`Start: ${habit.name}`);
      }
    });
    
    return timeline;
  }

  // Data access methods
  async getUserProfile(phone) {
    const db = getDb();
    const doc = await db.collection(collections.users).doc(phone).get();
    return doc.exists ? doc.data() : null;
  }

  async getWeeklyLogs(phone) {
    const db = getDb();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const snapshot = await db.collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '>=', weekAgo.toISOString().split('T')[0])
      .orderBy('date', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  async getMealPlans(phone) {
    const db = getDb();
    const snapshot = await db.collection('meal_plans')
      .where('phone', '==', phone)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    
    return snapshot.empty ? null : snapshot.docs[0].data();
  }

  async saveAnalysis(phone, analysis) {
    const db = getDb();
    await db.collection('weekly_analyses').add({
      phone,
      ...analysis,
      id: `analysis_${Date.now()}`
    });
  }
}

module.exports = new WeeklyAnalysisCrew();