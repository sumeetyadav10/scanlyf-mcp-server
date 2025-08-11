// Calculate daily nutrition targets based on user profile
function calculateDailyTargets(profile) {
  const { age, height_cm, weight_kg, gender } = profile;
  
  // Mifflin-St Jeor Equation for BMR
  let bmr;
  if (gender === 'male') {
    bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5;
  } else {
    bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161;
  }
  
  // Moderate activity level (BMR * 1.55)
  const dailyCalories = Math.round(bmr * 1.55);
  
  // Macronutrient distribution
  // Protein: 30% of calories (1g = 4 calories)
  const proteinCalories = dailyCalories * 0.30;
  const proteinGrams = Math.round(proteinCalories / 4);
  
  // Carbs: 40% of calories (1g = 4 calories)
  const carbCalories = dailyCalories * 0.40;
  const carbGrams = Math.round(carbCalories / 4);
  
  // Fat: 30% of calories (1g = 9 calories)
  const fatCalories = dailyCalories * 0.30;
  const fatGrams = Math.round(fatCalories / 9);
  
  return {
    calories: dailyCalories,
    protein: proteinGrams,
    carbs: carbGrams,
    fat: fatGrams
  };
}

// Parse food description to extract quantity and food name
function parseFoodDescription(description) {
  // Common patterns: "2 slices of bread", "1 cup rice", "100g chicken"
  const quantityPattern = /^(\d+(?:\.\d+)?)\s*(g|kg|oz|lb|cup|cups|slice|slices|piece|pieces|serving|servings)?\s*(?:of\s+)?(.+)$/i;
  const match = description.match(quantityPattern);
  
  if (match) {
    return {
      quantity: parseFloat(match[1]),
      unit: match[2] || 'serving',
      foodName: match[3].trim()
    };
  }
  
  // If no quantity specified, assume 1 serving
  return {
    quantity: 1,
    unit: 'serving',
    foodName: description.trim()
  };
}

// Format nutrition response
function formatNutritionResponse(food, dailyTotals, dailyTargets) {
  const emoji = '🍽️'; // Default food emoji
  
  let response = `${emoji} ${food.name}`;
  if (food.portion_size) {
    response += ` (${food.portion_size})`;
  }
  response += `\n`;
  response += `📊 This meal: ${food.calories} cal | ${food.protein}g protein | ${food.carbs}g carbs | ${food.fat}g fat\n\n`;
  response += `✅ LOGGED SUCCESSFULLY!\n`;
  response += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  response += `📈 Today's Progress:\n`;
  response += `• Consumed: ${dailyTotals.calories} calories\n`;
  response += `• Target: ${dailyTargets.calories} calories\n`;
  response += `• Remaining: ${Math.max(0, dailyTargets.calories - dailyTotals.calories)} calories\n\n`;
  response += `🤖 AVAILABLE COMMANDS:\n`;
  response += `• add_food - Add more food\n`;
  response += `• scan_food - Scan food with camera\n`;
  response += `• list_today_foods - See all foods logged today\n`;
  response += `• remove_food - Delete a logged item\n`;
  response += `• get_progress - View detailed progress\n`;
  response += `• get_weekly_analysis - Get AI insights`;
  
  return response;
}

// Get appropriate food emoji
function getfoodEmoji(foodName) {
  const foodLower = foodName.toLowerCase();
  
  const emojiMap = {
    'chicken': '🍗',
    'beef': '🥩',
    'fish': '🐟',
    'egg': '🥚',
    'bread': '🍞',
    'rice': '🍚',
    'pasta': '🍝',
    'pizza': '🍕',
    'salad': '🥗',
    'fruit': '🍎',
    'vegetable': '🥦',
    'milk': '🥛',
    'cheese': '🧀',
    'yogurt': '🥄',
    'coffee': '☕',
    'tea': '🍵',
    'water': '💧'
  };
  
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (foodLower.includes(key)) {
      return emoji;
    }
  }
  
  return '🍽️'; // Default food emoji
}

module.exports = {
  calculateDailyTargets,
  parseFoodDescription,
  formatNutritionResponse
};