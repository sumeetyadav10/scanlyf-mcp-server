const { getDb, collections } = require('../lib/firebase');
const foodService = require('./foodService');
const enhancedVisionService = require('./enhancedVisionService');
const openai = require('openai');

class MealPlanningService {
  constructor() {
    this.mealTypes = {
      BREAKFAST: 'breakfast',
      LUNCH: 'lunch',
      DINNER: 'dinner',
      SNACK: 'snack'
    };
    
    this.planDurations = {
      DAILY: 1,
      WEEKLY: 7,
      BIWEEKLY: 14,
      MONTHLY: 30
    };

    this.openaiClient = null;
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new openai.OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    }
  }

  // Generate personalized meal plan
  async generateMealPlan(phone, options = {}) {
    const {
      duration = this.planDurations.WEEKLY,
      startDate = new Date().toISOString().split('T')[0],
      preferences = {},
      excludeIngredients = [],
      mealCount = 3, // meals per day
      includeSnacks = true
    } = options;

    // Get user profile
    const userService = require('./userService');
    const profile = await userService.getProfile(phone);
    
    if (!profile) {
      throw new Error('User profile not found. Please set up your profile first.');
    }

    // Get recent food history for preferences
    const recentFoods = await this.getRecentFoodHistory(phone, 14);
    
    // Generate meal plan
    const mealPlan = await this.createMealPlan({
      profile,
      duration,
      startDate,
      preferences: { ...this.analyzePreferences(recentFoods), ...preferences },
      excludeIngredients,
      mealCount,
      includeSnacks
    });

    // Save meal plan
    await this.saveMealPlan(phone, mealPlan);

    return mealPlan;
  }

  // Create meal plan based on parameters
  async createMealPlan(params) {
    const {
      profile,
      duration,
      startDate,
      preferences,
      excludeIngredients,
      mealCount,
      includeSnacks
    } = params;

    const mealPlan = {
      id: `plan_${Date.now()}`,
      created_at: new Date().toISOString(),
      start_date: startDate,
      duration_days: duration,
      daily_targets: {
        calories: profile.calorie_target,
        protein: profile.protein_target,
        carbs: profile.carb_target,
        fat: profile.fat_target
      },
      preferences,
      days: []
    };

    // Calculate meal distribution
    const mealDistribution = this.calculateMealDistribution(
      profile.calorie_target,
      mealCount,
      includeSnacks
    );

    // Generate meals for each day
    for (let day = 0; day < duration; day++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + day);
      
      const dayPlan = {
        date: currentDate.toISOString().split('T')[0],
        meals: await this.generateDayMeals({
          profile,
          mealDistribution,
          preferences,
          excludeIngredients,
          healthConditions: profile.health_conditions
        })
      };

      // Calculate day totals
      dayPlan.totals = this.calculateDayTotals(dayPlan.meals);
      mealPlan.days.push(dayPlan);
    }

    return mealPlan;
  }

  // Generate meals for a single day
  async generateDayMeals(params) {
    const {
      profile,
      mealDistribution,
      preferences,
      excludeIngredients,
      healthConditions
    } = params;

    const meals = [];

    // Generate breakfast
    meals.push(await this.generateMeal({
      type: this.mealTypes.BREAKFAST,
      targetCalories: mealDistribution.breakfast,
      preferences,
      excludeIngredients,
      healthConditions
    }));

    // Generate lunch
    meals.push(await this.generateMeal({
      type: this.mealTypes.LUNCH,
      targetCalories: mealDistribution.lunch,
      preferences,
      excludeIngredients,
      healthConditions
    }));

    // Generate dinner
    meals.push(await this.generateMeal({
      type: this.mealTypes.DINNER,
      targetCalories: mealDistribution.dinner,
      preferences,
      excludeIngredients,
      healthConditions
    }));

    // Generate snacks if included
    if (mealDistribution.snacks > 0) {
      meals.push(await this.generateMeal({
        type: this.mealTypes.SNACK,
        targetCalories: mealDistribution.snacks,
        preferences,
        excludeIngredients,
        healthConditions
      }));
    }

    return meals;
  }

  // Generate a single meal
  async generateMeal(params) {
    const {
      type,
      targetCalories,
      preferences,
      excludeIngredients,
      healthConditions
    } = params;

    // Use AI if available
    if (this.openaiClient) {
      return await this.generateMealWithAI(params);
    }

    // Fallback to template-based generation
    return await this.generateMealFromTemplates(params);
  }

  // Generate meal using OpenAI
  async generateMealWithAI(params) {
    const {
      type,
      targetCalories,
      preferences,
      excludeIngredients,
      healthConditions
    } = params;

    const prompt = `Generate a ${type} meal with approximately ${targetCalories} calories.
    
Health conditions to consider: ${healthConditions.join(', ')}
Exclude ingredients: ${excludeIngredients.join(', ')}
Preferences: ${JSON.stringify(preferences)}

Provide the meal in JSON format with:
- name: meal name
- description: brief description
- ingredients: array of {name, quantity, unit}
- instructions: array of steps
- estimated nutrition: {calories, protein, carbs, fat}`;

    try {
      const response = await this.openaiClient.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are a nutritionist creating healthy, balanced meals. Return ONLY valid JSON without any markdown formatting or code blocks."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.8
      });

      let content = response.choices[0].message.content.trim();
      
      // Import safe JSON parser
      const { safeJsonParse } = require('../lib/comprehensive-fix');
      
      // Parse with error handling
      const meal = safeJsonParse(content, null);
      
      if (!meal) {
        throw new Error('Failed to parse AI response as JSON');
      }
      
      // Add metadata
      meal.type = type;
      meal.ai_generated = true;
      
      // Get actual nutrition data
      const nutritionPromises = meal.ingredients.map(ing => 
        foodService.searchNutritionix(ing.name, ing.quantity, ing.unit)
      );
      const nutritionData = await Promise.all(nutritionPromises);
      
      // Calculate actual totals
      meal.nutrition = this.calculateMealNutrition(nutritionData);
      
      return meal;
    } catch (error) {
      console.error('AI meal generation failed:', error);
      return await this.generateMealFromTemplates(params);
    }
  }

  // Generate meal from templates (fallback)
  async generateMealFromTemplates(params) {
    const { type, targetCalories, healthConditions } = params;
    
    const templates = this.getMealTemplates(type, healthConditions);
    
    // Find best matching template based on calories
    let bestTemplate = templates[0];
    let bestDiff = Math.abs(templates[0].estimatedCalories - targetCalories);
    
    for (const template of templates) {
      const diff = Math.abs(template.estimatedCalories - targetCalories);
      if (diff < bestDiff) {
        bestTemplate = template;
        bestDiff = diff;
      }
    }

    // Get actual nutrition data
    const nutritionPromises = bestTemplate.ingredients.map(ing => 
      foodService.searchNutritionix(ing.name, ing.quantity, ing.unit)
    );
    const nutritionData = await Promise.all(nutritionPromises);
    
    return {
      ...bestTemplate,
      type,
      nutrition: this.calculateMealNutrition(nutritionData),
      template_based: true
    };
  }

  // Get meal templates
  getMealTemplates(type, healthConditions) {
    const templates = {
      breakfast: [
        {
          name: "Protein Power Bowl",
          description: "Greek yogurt with berries and granola",
          ingredients: [
            { name: "greek yogurt", quantity: 1, unit: "cup" },
            { name: "blueberries", quantity: 0.5, unit: "cup" },
            { name: "granola", quantity: 0.25, unit: "cup" },
            { name: "honey", quantity: 1, unit: "tbsp" }
          ],
          instructions: [
            "Add Greek yogurt to bowl",
            "Top with blueberries and granola",
            "Drizzle with honey"
          ],
          estimatedCalories: 350
        },
        {
          name: "Veggie Scramble",
          description: "Eggs with mixed vegetables",
          ingredients: [
            { name: "eggs", quantity: 2, unit: "large" },
            { name: "spinach", quantity: 1, unit: "cup" },
            { name: "mushrooms", quantity: 0.5, unit: "cup" },
            { name: "olive oil", quantity: 1, unit: "tsp" }
          ],
          instructions: [
            "Heat oil in pan",
            "Sauté vegetables until soft",
            "Add beaten eggs and scramble",
            "Season with salt and pepper"
          ],
          estimatedCalories: 250
        }
      ],
      lunch: [
        {
          name: "Grilled Chicken Salad",
          description: "Mixed greens with grilled chicken and vegetables",
          ingredients: [
            { name: "grilled chicken breast", quantity: 4, unit: "oz" },
            { name: "mixed greens", quantity: 2, unit: "cups" },
            { name: "cherry tomatoes", quantity: 0.5, unit: "cup" },
            { name: "cucumber", quantity: 0.5, unit: "cup" },
            { name: "olive oil", quantity: 1, unit: "tbsp" },
            { name: "balsamic vinegar", quantity: 1, unit: "tbsp" }
          ],
          instructions: [
            "Grill chicken breast until cooked",
            "Mix greens and vegetables",
            "Slice chicken and add to salad",
            "Dress with oil and vinegar"
          ],
          estimatedCalories: 400
        },
        {
          name: "Quinoa Buddha Bowl",
          description: "Nutritious bowl with quinoa and roasted vegetables",
          ingredients: [
            { name: "cooked quinoa", quantity: 1, unit: "cup" },
            { name: "roasted sweet potato", quantity: 0.5, unit: "cup" },
            { name: "chickpeas", quantity: 0.5, unit: "cup" },
            { name: "avocado", quantity: 0.5, unit: "medium" },
            { name: "tahini", quantity: 1, unit: "tbsp" }
          ],
          instructions: [
            "Cook quinoa according to package",
            "Roast sweet potato cubes",
            "Assemble bowl with all ingredients",
            "Drizzle with tahini"
          ],
          estimatedCalories: 550
        }
      ],
      dinner: [
        {
          name: "Baked Salmon with Vegetables",
          description: "Omega-3 rich salmon with roasted vegetables",
          ingredients: [
            { name: "salmon fillet", quantity: 5, unit: "oz" },
            { name: "broccoli", quantity: 1, unit: "cup" },
            { name: "brown rice", quantity: 0.5, unit: "cup" },
            { name: "lemon", quantity: 0.5, unit: "medium" },
            { name: "olive oil", quantity: 1, unit: "tbsp" }
          ],
          instructions: [
            "Season salmon with lemon and herbs",
            "Bake at 400°F for 15 minutes",
            "Steam broccoli until tender",
            "Serve with brown rice"
          ],
          estimatedCalories: 500
        }
      ],
      snack: [
        {
          name: "Apple with Almond Butter",
          description: "Fresh apple slices with protein-rich almond butter",
          ingredients: [
            { name: "apple", quantity: 1, unit: "medium" },
            { name: "almond butter", quantity: 2, unit: "tbsp" }
          ],
          instructions: [
            "Slice apple",
            "Serve with almond butter for dipping"
          ],
          estimatedCalories: 250
        }
      ]
    };

    // Filter templates based on health conditions
    let filteredTemplates = templates[type] || [];
    
    if (healthConditions.includes('diabetes')) {
      // Filter out high-sugar options
      filteredTemplates = filteredTemplates.filter(t => 
        !t.ingredients.some(i => i.name.includes('honey') || i.name.includes('granola'))
      );
    }
    
    if (healthConditions.includes('nut_allergy')) {
      // Filter out nut-containing options
      filteredTemplates = filteredTemplates.filter(t => 
        !t.ingredients.some(i => i.name.includes('almond') || i.name.includes('nut'))
      );
    }

    return filteredTemplates.length > 0 ? filteredTemplates : templates[type];
  }

  // Calculate meal nutrition from ingredients
  calculateMealNutrition(nutritionDataArray) {
    return nutritionDataArray.reduce((total, item) => ({
      calories: total.calories + (item.calories || 0),
      protein: total.protein + (item.protein || 0),
      carbs: total.carbs + (item.carbs || 0),
      fat: total.fat + (item.fat || 0),
      fiber: total.fiber + (item.fiber || 0),
      sugar: total.sugar + (item.sugar || 0),
      sodium: total.sodium + (item.sodium || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 });
  }

  // Calculate meal distribution
  calculateMealDistribution(dailyCalories, mealCount, includeSnacks) {
    const distribution = {
      breakfast: 0,
      lunch: 0,
      dinner: 0,
      snacks: 0
    };

    if (mealCount === 3) {
      distribution.breakfast = Math.round(dailyCalories * 0.25);
      distribution.lunch = Math.round(dailyCalories * 0.35);
      distribution.dinner = Math.round(dailyCalories * 0.30);
      distribution.snacks = includeSnacks ? Math.round(dailyCalories * 0.10) : 0;
    } else if (mealCount === 4) {
      distribution.breakfast = Math.round(dailyCalories * 0.20);
      distribution.lunch = Math.round(dailyCalories * 0.30);
      distribution.dinner = Math.round(dailyCalories * 0.30);
      distribution.snacks = Math.round(dailyCalories * 0.20);
    } else if (mealCount === 5) {
      // 5 smaller meals throughout the day
      const mealCalories = Math.round(dailyCalories / 5);
      distribution.breakfast = mealCalories;
      distribution.lunch = mealCalories * 2; // Combine 2 meals
      distribution.dinner = mealCalories * 2; // Combine 2 meals
      distribution.snacks = 0;
    }

    return distribution;
  }

  // Analyze user's food preferences from history
  analyzePreferences(recentFoods) {
    const preferences = {
      cuisines: {},
      ingredients: {},
      avoidances: []
    };

    recentFoods.forEach(log => {
      log.foods.forEach(food => {
        const name = food.name.toLowerCase();
        
        // Track common ingredients
        preferences.ingredients[name] = (preferences.ingredients[name] || 0) + 1;
        
        // Detect cuisine preferences
        if (name.includes('pasta') || name.includes('pizza')) {
          preferences.cuisines.italian = (preferences.cuisines.italian || 0) + 1;
        }
        if (name.includes('rice') || name.includes('curry')) {
          preferences.cuisines.asian = (preferences.cuisines.asian || 0) + 1;
        }
        if (name.includes('taco') || name.includes('burrito')) {
          preferences.cuisines.mexican = (preferences.cuisines.mexican || 0) + 1;
        }
      });
    });

    // Get top preferences
    preferences.topIngredients = Object.entries(preferences.ingredients)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ing]) => ing);

    preferences.topCuisines = Object.entries(preferences.cuisines)
      .sort((a, b) => b[1] - a[1])
      .map(([cuisine]) => cuisine);

    return preferences;
  }

  // Get recent food history
  async getRecentFoodHistory(phone, days = 14) {
    const db = getDb();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    
    const snapshot = await db.collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '>=', startDate)
      .orderBy('date', 'desc')
      .get();
    
    return snapshot.docs.map(doc => doc.data());
  }

  // Save meal plan
  async saveMealPlan(phone, mealPlan) {
    const db = getDb();
    await db.collection('meal_plans').doc(mealPlan.id).set({
      ...mealPlan,
      phone,
      status: 'active'
    });
  }

  // Get active meal plan
  async getActiveMealPlan(phone) {
    const db = getDb();
    const snapshot = await db.collection('meal_plans')
      .where('phone', '==', phone)
      .where('status', '==', 'active')
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return null;
    }
    
    return snapshot.docs[0].data();
  }

  // Update meal in plan (swap meals)
  async updateMealInPlan(phone, planId, date, mealType, newMeal) {
    const db = getDb();
    const planRef = db.collection('meal_plans').doc(planId);
    const plan = await planRef.get();
    
    if (!plan.exists || plan.data().phone !== phone) {
      throw new Error('Meal plan not found or unauthorized');
    }
    
    const planData = plan.data();
    const dayIndex = planData.days.findIndex(d => d.date === date);
    
    if (dayIndex === -1) {
      throw new Error('Date not found in meal plan');
    }
    
    const mealIndex = planData.days[dayIndex].meals.findIndex(m => m.type === mealType);
    
    if (mealIndex === -1) {
      throw new Error('Meal type not found for this date');
    }
    
    // Update the meal
    planData.days[dayIndex].meals[mealIndex] = newMeal;
    
    // Recalculate day totals
    planData.days[dayIndex].totals = this.calculateDayTotals(planData.days[dayIndex].meals);
    
    await planRef.update({
      days: planData.days,
      last_updated: new Date().toISOString()
    });
    
    return { message: 'Meal updated successfully' };
  }

  // Calculate day totals
  calculateDayTotals(meals) {
    return meals.reduce((totals, meal) => ({
      calories: totals.calories + (meal.nutrition?.calories || 0),
      protein: totals.protein + (meal.nutrition?.protein || 0),
      carbs: totals.carbs + (meal.nutrition?.carbs || 0),
      fat: totals.fat + (meal.nutrition?.fat || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }

  // Generate shopping list from meal plan
  async generateShoppingList(phone, planId) {
    const db = getDb();
    const planDoc = await db.collection('meal_plans').doc(planId).get();
    
    if (!planDoc.exists || planDoc.data().phone !== phone) {
      throw new Error('Meal plan not found or unauthorized');
    }
    
    const plan = planDoc.data();
    const shoppingList = {};
    
    // Aggregate all ingredients
    plan.days.forEach(day => {
      day.meals.forEach(meal => {
        if (meal.ingredients) {
          meal.ingredients.forEach(ing => {
            const key = ing.name.toLowerCase();
            if (!shoppingList[key]) {
              shoppingList[key] = {
                name: ing.name,
                quantity: 0,
                unit: ing.unit,
                meals: []
              };
            }
            
            // Convert units if needed and add quantities
            shoppingList[key].quantity += ing.quantity;
            shoppingList[key].meals.push(`${meal.name} (${day.date})`);
          });
        }
      });
    });
    
    // Format shopping list
    const formattedList = Object.values(shoppingList).map(item => ({
      ...item,
      quantity: Math.ceil(item.quantity), // Round up for shopping
      meals: [...new Set(item.meals)] // Remove duplicates
    }));
    
    return {
      plan_id: planId,
      generated_at: new Date().toISOString(),
      items: formattedList,
      total_items: formattedList.length
    };
  }
}

module.exports = new MealPlanningService();