const { getDb, collections } = require('../lib/firebase');
const axios = require('axios');
const rewardsService = require('./rewardsService');
const { getTodayIST, getCurrentTimestampIST } = require('../lib/dateHelper');

class FoodService {
  async addFood(phone, foodData, source = 'text') {
    const db = getDb();
    const today = getTodayIST();
    const docId = `${phone}_${today}`;
    
    // Get or create daily log
    const logRef = db.collection(collections.dailyLogs).doc(docId);
    const logDoc = await logRef.get();
    
    let dailyLog;
    if (!logDoc.exists) {
      dailyLog = {
        phone,
        date: today,
        foods: [],
        totals: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        }
      };
    } else {
      dailyLog = logDoc.data();
    }
    
    // Add food entry
    const foodEntry = {
      ...foodData,
      source,
      timestamp: getCurrentTimestampIST()
    };
    
    dailyLog.foods.push(foodEntry);
    
    // Update totals
    dailyLog.totals.calories += foodData.calories || 0;
    dailyLog.totals.protein += foodData.protein || 0;
    dailyLog.totals.carbs += foodData.carbs || 0;
    dailyLog.totals.fat += foodData.fat || 0;
    
    // Save to Firestore
    await logRef.set(dailyLog);
    
    return {
      food: foodEntry,
      dailyTotals: dailyLog.totals
    };
  }
  
  async getDailyProgress(phone, date = null) {
    const db = getDb();
    const targetDate = date || getTodayIST();
    const docId = `${phone}_${targetDate}`;
    
    const logDoc = await db.collection(collections.dailyLogs).doc(docId).get();
    
    if (!logDoc.exists) {
      return {
        date: targetDate,
        foods: [],
        totals: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0
        }
      };
    }
    
    return logDoc.data();
  }
  
  async resetDay(phone, date = null) {
    const db = getDb();
    const targetDate = date || getTodayIST();
    const docId = `${phone}_${targetDate}`;
    
    await db.collection(collections.dailyLogs).doc(docId).delete();
    
    return {
      message: 'Day reset successfully',
      date: targetDate
    };
  }
  
  async searchNutritionix(query, quantity = 1, unit = 'serving') {
    // Always try OpenFoodFacts first (it's free and comprehensive)
    const openFoodFactsResult = await this.searchOpenFoodFacts(query, quantity, unit);
    if (openFoodFactsResult) return openFoodFactsResult;
    
    // Try Nutritionix if configured
    const appId = process.env.NUTRITIONIX_APP_ID;
    const appKey = process.env.NUTRITIONIX_APP_KEY;
    
    if (appId && appKey) {
      try {
        const response = await axios.post(
          'https://trackapi.nutritionix.com/v2/natural/nutrients',
          {
            query: `${quantity} ${unit} ${query}`
          },
          {
            headers: {
              'x-app-id': appId,
              'x-app-key': appKey,
              'Content-Type': 'application/json'
            }
          }
        );
        
        if (response.data.foods && response.data.foods.length > 0) {
          const food = response.data.foods[0];
          return {
            name: food.food_name,
            calories: Math.round(food.nf_calories || 0),
            protein: Math.round(food.nf_protein || 0),
            carbs: Math.round(food.nf_total_carbohydrate || 0),
            fat: Math.round(food.nf_total_fat || 0),
            fiber: Math.round(food.nf_dietary_fiber || 0),
            sugar: Math.round(food.nf_sugars || 0),
            sodium: Math.round(food.nf_sodium || 0),
            portion_size: food.serving_qty + ' ' + food.serving_unit,
            source: 'Nutritionix'
          };
        }
      } catch (error) {
        console.error('Nutritionix API error:', error.message);
      }
    }
    
    // Fallback to other APIs
    return this.searchWithFallback(query, quantity, unit);
  }
  
  async searchWithFallback(query, quantity = 1, unit = 'serving') {
    // Try USDA API (free government database)
    const usdaResult = await this.searchUSDA(query, quantity);
    if (usdaResult) return usdaResult;
    
    // Final fallback to mock data
    return this.getMockNutritionData(query, quantity);
  }
  
  async searchOpenFoodFacts(query, quantity = 1, unit = 'serving') {
    try {
      // Search for products
      const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=5`;
      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Scanlyf/1.0'
        }
      });
      
      if (response.data.products && response.data.products.length > 0) {
        const product = response.data.products[0];
        const nutrients = product.nutriments || {};
        
        // Get serving size or use 100g as default
        const servingSize = product.serving_size || '100g';
        const servingMultiplier = quantity;
        
        return {
          name: product.product_name || query,
          calories: Math.round((nutrients['energy-kcal_100g'] || 0) * servingMultiplier),
          protein: Math.round((nutrients.proteins_100g || 0) * servingMultiplier),
          carbs: Math.round((nutrients.carbohydrates_100g || 0) * servingMultiplier),
          fat: Math.round((nutrients.fat_100g || 0) * servingMultiplier),
          fiber: Math.round((nutrients.fiber_100g || 0) * servingMultiplier),
          sugar: Math.round((nutrients.sugars_100g || 0) * servingMultiplier),
          sodium: Math.round((nutrients.sodium_100g || 0) * 1000 * servingMultiplier), // Convert g to mg
          portion_size: `${quantity} ${unit}`,
          source: 'OpenFoodFacts'
        };
      }
    } catch (error) {
      console.error('OpenFoodFacts API error:', error.message);
    }
    return null;
  }
  
  async searchUSDA(query, quantity = 1) {
    try {
      // USDA FoodData Central API (no key required for basic access)
      const searchUrl = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=5`;
      const response = await axios.get(searchUrl);
      
      if (response.data.foods && response.data.foods.length > 0) {
        const food = response.data.foods[0];
        const nutrients = {};
        
        // Parse nutrients from foodNutrients array
        food.foodNutrients.forEach(nutrient => {
          switch (nutrient.nutrientName) {
            case 'Energy':
              nutrients.calories = nutrient.value;
              break;
            case 'Protein':
              nutrients.protein = nutrient.value;
              break;
            case 'Carbohydrate, by difference':
              nutrients.carbs = nutrient.value;
              break;
            case 'Total lipid (fat)':
              nutrients.fat = nutrient.value;
              break;
            case 'Fiber, total dietary':
              nutrients.fiber = nutrient.value;
              break;
            case 'Sugars, total including NLEA':
              nutrients.sugar = nutrient.value;
              break;
            case 'Sodium, Na':
              nutrients.sodium = nutrient.value;
              break;
          }
        });
        
        return {
          name: food.description || query,
          calories: Math.round((nutrients.calories || 0) * quantity),
          protein: Math.round((nutrients.protein || 0) * quantity),
          carbs: Math.round((nutrients.carbs || 0) * quantity),
          fat: Math.round((nutrients.fat || 0) * quantity),
          fiber: Math.round((nutrients.fiber || 0) * quantity),
          sugar: Math.round((nutrients.sugar || 0) * quantity),
          sodium: Math.round((nutrients.sodium || 0) * quantity),
          portion_size: `${quantity} serving`,
          source: 'USDA'
        };
      }
    } catch (error) {
      console.error('USDA API error:', error.message);
    }
    return null;
  }
  
  
  getMockNutritionData(foodName, quantity = 1) {
    // Enhanced mock nutrition database with more nutrients
    const mockDb = {
      'bread': { calories: 80, protein: 3, carbs: 15, fat: 1, fiber: 1, sugar: 2, sodium: 150 },
      'chicken': { calories: 165, protein: 31, carbs: 0, fat: 4, fiber: 0, sugar: 0, sodium: 70 },
      'rice': { calories: 130, protein: 3, carbs: 28, fat: 0, fiber: 1, sugar: 0, sodium: 5 },
      'apple': { calories: 95, protein: 0, carbs: 25, fat: 0, fiber: 4, sugar: 19, sodium: 2 },
      'egg': { calories: 70, protein: 6, carbs: 1, fat: 5, fiber: 0, sugar: 1, sodium: 70 },
      'milk': { calories: 150, protein: 8, carbs: 12, fat: 8, fiber: 0, sugar: 12, sodium: 125 },
      'banana': { calories: 105, protein: 1, carbs: 27, fat: 0, fiber: 3, sugar: 14, sodium: 1 },
      'chocolate': { calories: 200, protein: 2, carbs: 25, fat: 12, fiber: 2, sugar: 20, sodium: 20 },
      'pizza': { calories: 285, protein: 12, carbs: 36, fat: 10, fiber: 2, sugar: 4, sodium: 640 },
      'coffee': { calories: 2, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 5 }
    };
    
    // Find best match
    const foodLower = foodName.toLowerCase();
    let nutritionData = null;
    
    for (const [key, value] of Object.entries(mockDb)) {
      if (foodLower.includes(key)) {
        nutritionData = value;
        break;
      }
    }
    
    // Default nutrition if not found
    if (!nutritionData) {
      nutritionData = { calories: 100, protein: 5, carbs: 15, fat: 3, fiber: 1, sugar: 5, sodium: 100 };
    }
    
    // Scale by quantity
    return {
      name: foodName,
      calories: Math.round(nutritionData.calories * quantity),
      protein: Math.round(nutritionData.protein * quantity),
      carbs: Math.round(nutritionData.carbs * quantity),
      fat: Math.round(nutritionData.fat * quantity),
      fiber: Math.round((nutritionData.fiber || 0) * quantity),
      sugar: Math.round((nutritionData.sugar || 0) * quantity),
      sodium: Math.round((nutritionData.sodium || 0) * quantity),
      portion_size: `${quantity} serving${quantity > 1 ? 's' : ''}`,
      source: 'Mock Data'
    };
  }

  // Get the timestamp of the last meal today
  async getLastMealTime(phone) {
    const today = getTodayIST();
    
    const snapshot = await getDb().collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '==', today)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return null;
    }
    
    const todayLog = snapshot.docs[0].data();
    if (!todayLog.foods || todayLog.foods.length === 0) {
      return null;
    }
    
    // Return the timestamp of the last food entry
    const lastFood = todayLog.foods[todayLog.foods.length - 1];
    return lastFood.timestamp || todayLog.updated_at;
  }

  // Get the gap in minutes since the last meal
  async getMealGap(phone) {
    const lastMealTime = await this.getLastMealTime(phone);
    
    if (!lastMealTime) {
      return null;
    }
    
    const now = new Date();
    const lastMeal = new Date(lastMealTime);
    const gapMinutes = Math.round((now - lastMeal) / 1000 / 60);
    
    return gapMinutes;
  }

  // Get total calories consumed today
  async getDailyCalories(phone) {
    const today = getTodayIST();
    
    const snapshot = await getDb().collection(collections.dailyLogs)
      .where('phone', '==', phone)
      .where('date', '==', today)
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return 0;
    }
    
    const todayLog = snapshot.docs[0].data();
    return todayLog.totals?.calories || 0;
  }

  // Log food to daily intake
  async logFood(phone, foodData) {
    const today = getTodayIST();
    const timestamp = new Date().toISOString();
    
    // Get or create today's log
    const logRef = getDb().collection(collections.dailyLogs).doc(`${phone}_${today}`);
    const logDoc = await logRef.get();
    
    if (!logDoc.exists) {
      // Create new daily log
      await logRef.set({
        phone,
        date: today,
        foods: [{ ...foodData, timestamp }],
        totals: {
          calories: foodData.calories || 0,
          protein: foodData.protein || 0,
          carbs: foodData.carbs || 0,
          fat: foodData.fat || 0
        },
        created_at: timestamp,
        updated_at: timestamp
      });
    } else {
      // Update existing log
      const currentData = logDoc.data();
      const foods = currentData.foods || [];
      foods.push({ ...foodData, timestamp });
      
      // Recalculate totals
      const totals = foods.reduce((acc, food) => ({
        calories: acc.calories + (food.calories || 0),
        protein: acc.protein + (food.protein || 0),
        carbs: acc.carbs + (food.carbs || 0),
        fat: acc.fat + (food.fat || 0)
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      
      await logRef.update({
        foods,
        totals,
        updated_at: timestamp
      });
    }
    
    return { success: true };
  }
}

module.exports = new FoodService();