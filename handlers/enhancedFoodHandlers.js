const foodAnalysisService = require('../services/enhancedFoodAnalysisService');
const userService = require('../services/userService');
const foodService = require('../services/foodService');

// Session storage for pending confirmations
const pendingConfirmations = new Map();

async function handleEnhancedScanFood(args) {
  const { bearer_token, input, type } = args;
  
  // Validate token
  const phone = await validateToken(bearer_token);
  
  // Get user profile
  const profile = await userService.getProfile(phone);
  if (!profile) {
    throw new Error('Profile not found. Please set up your profile first.');
  }
  
  if (type === 'image') {
    // Enhanced image analysis with multi-item detection
    const base64Image = input; // Assuming input is base64 for images
    const analysisResult = await foodAnalysisService.analyzeFromImageEnhanced(base64Image, profile);
    
    if (!analysisResult.success) {
      throw new Error('Failed to analyze image');
    }
    
    // Store analysis for confirmation
    pendingConfirmations.set(phone, {
      analysisId: analysisResult.analysisId,
      timestamp: Date.now()
    });
    
    // Return confirmation message
    return {
      message: analysisResult.confirmationMessage,
      requiresConfirmation: true,
      detectedItemCount: analysisResult.detectedItems.length
    };
  } else {
    // Text analysis remains the same
    const analysisResult = await foodAnalysisService.analyzeFromText(input);
    const nutritionData = analysisResult.nutrition;
    const healthAnalysis = await foodAnalysisService.analyzeForHealth(nutritionData, profile.health_conditions);
    
    return formatScanResponse(nutritionData, healthAnalysis, profile);
  }
}

async function handleFoodConfirmation(args) {
  const { bearer_token, confirmation } = args;
  
  // Validate token
  const phone = await validateToken(bearer_token);
  
  // Get pending confirmation
  const pending = pendingConfirmations.get(phone);
  if (!pending) {
    return {
      message: "No pending food analysis found. Please scan your food again.",
      success: false
    };
  }
  
  // Get user profile
  const profile = await userService.getProfile(phone);
  
  // Process confirmation
  const result = await foodAnalysisService.processUserConfirmation(
    pending.analysisId,
    confirmation,
    profile
  );
  
  if (!result.success) {
    return {
      message: result.error || "Failed to process confirmation",
      success: false
    };
  }
  
  // Clear pending confirmation
  pendingConfirmations.delete(phone);
  
  // Format comprehensive response with health report
  return formatEnhancedResponse(result, profile);
}

function formatEnhancedResponse(result, profile) {
  const { finalItems, nutritionData, healthReport } = result;
  
  let response = healthReport.greeting + '\n\n';
  
  // Items summary
  response += '🍽️ YOUR MEAL:\n';
  finalItems.forEach(item => {
    response += `• ${item.name} (${item.quantity || '1 serving'})\n`;
  });
  
  // Nutrition summary with visual indicators
  response += '\n📊 NUTRITION TOTALS:\n';
  response += `🔥 Calories: ${nutritionData.calories} (${healthReport.quickStats.caloriePercentage}% of daily)\n`;
  response += `💪 Protein: ${nutritionData.protein}g (${healthReport.quickStats.proteinPercentage}% of target)\n`;
  response += `🍞 Carbs: ${nutritionData.carbs}g\n`;
  response += `🧈 Fat: ${nutritionData.fat}g\n`;
  
  if (nutritionData.fiber > 0) {
    response += `🌾 Fiber: ${nutritionData.fiber}g\n`;
  }
  if (nutritionData.sugar > 0) {
    response += `🍬 Sugar: ${nutritionData.sugar}g\n`;
  }
  if (nutritionData.sodium > 0) {
    response += `🧂 Sodium: ${nutritionData.sodium}mg\n`;
  }
  
  // Health alerts
  if (healthReport.healthAlerts.length > 0) {
    response += '\n⚠️ HEALTH ALERTS:\n';
    healthReport.healthAlerts.forEach(alert => {
      response += `${alert.message}\n`;
    });
  }
  
  // AI Analysis (if available)
  if (healthReport.aiAnalysis) {
    response += '\n🤖 DETAILED ANALYSIS:\n';
    response += healthReport.aiAnalysis + '\n';
  }
  
  // Encouragement
  response += '\n' + healthReport.encouragement.join('\n');
  
  // Quick actions
  response += '\n\n📝 Quick Actions:';
  response += '\n• Reply "LOG" to add this meal to your diary';
  response += '\n• Reply "SCAN" to analyze another food';
  response += '\n• Reply "PROGRESS" to see daily summary';
  
  return {
    message: response,
    nutritionData: nutritionData,
    itemCount: finalItems.length,
    healthScore: calculateHealthScore(nutritionData, profile),
    success: true
  };
}

function formatScanResponse(nutritionData, healthAnalysis, profile) {
  let response = `🔍 FOOD ANALYSIS: ${nutritionData.name}\n`;
  response += `\n📊 NUTRITION (per ${nutritionData.portion_size || 'serving'}):\n`;
  response += `Calories: ${nutritionData.calories}\n`;
  response += `Protein: ${nutritionData.protein}g\n`;
  response += `Carbs: ${nutritionData.carbs}g\n`;
  response += `Fat: ${nutritionData.fat}g\n`;
  
  if (nutritionData.fiber) response += `Fiber: ${nutritionData.fiber}g\n`;
  if (nutritionData.sugar) response += `Sugar: ${nutritionData.sugar}g\n`;
  if (nutritionData.sodium) response += `Sodium: ${nutritionData.sodium}mg\n`;
  
  // Health analysis
  response += `\n${healthAnalysis.overallRecommendation}\n`;
  
  if (healthAnalysis.warnings.length > 0) {
    response += '\n⚠️ WARNINGS:\n';
    healthAnalysis.warnings.forEach(w => {
      response += `• ${w.message}\n`;
    });
  }
  
  if (healthAnalysis.pros.length > 0) {
    response += '\n✅ PROS:\n';
    healthAnalysis.pros.forEach(p => response += `• ${p}\n`);
  }
  
  if (healthAnalysis.cons.length > 0) {
    response += '\n❌ CONS:\n';
    healthAnalysis.cons.forEach(c => response += `• ${c}\n`);
  }
  
  response += '\n💡 To log this food, use: add_food "' + nutritionData.name + '"';
  
  return {
    message: response,
    nutritionData: nutritionData,
    healthAnalysis: healthAnalysis,
    success: true
  };
}

function calculateHealthScore(nutritionData, profile) {
  let score = 100;
  
  // Deduct points for exceeding limits
  if (nutritionData.calories > profile.calorie_target * 0.4) score -= 10; // >40% in one meal
  if (nutritionData.sugar > 25) score -= 15;
  if (nutritionData.sodium > 800) score -= 10;
  if (nutritionData.fat > profile.fat_target * 0.5) score -= 10;
  
  // Add points for good nutrients
  if (nutritionData.protein >= profile.protein_target * 0.3) score += 10;
  if (nutritionData.fiber >= 5) score += 10;
  
  return Math.max(0, Math.min(100, score));
}

async function validateToken(bearer_token) {
  if (!bearer_token) {
    throw new Error('Bearer token is required');
  }
  // For demo purposes, return a mock phone number
  return (process.env.TEST_PHONE || 'demo_user').replace(/^\+/, '');
}

// Clean up old pending confirmations periodically
setInterval(() => {
  const now = Date.now();
  const timeout = 15 * 60 * 1000; // 15 minutes
  
  for (const [phone, pending] of pendingConfirmations.entries()) {
    if (now - pending.timestamp > timeout) {
      pendingConfirmations.delete(phone);
    }
  }
}, 5 * 60 * 1000); // Check every 5 minutes

module.exports = {
  handleEnhancedScanFood,
  handleFoodConfirmation,
  formatEnhancedResponse,
  calculateHealthScore
};