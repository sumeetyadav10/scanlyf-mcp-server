// User-friendly onboarding helper

const ONBOARDING_MESSAGES = {
  welcome: `👋 Welcome to Scanlyf - Your Personal AI Nutrition Assistant!

I'm here to help you track your nutrition and achieve your health goals. 

To get started, I need to know a bit about you. Please tell me:
- Your name
- Age 
- Weight (in kg)
- Height (in cm)
- Gender (male/female)
- Any health conditions (or say "none")

For example: "I'm Raj, 30 years old, 70 kg, 175 cm, male, no health conditions"`,

  profileIncomplete: `I need a few more details to set up your profile:

Missing information:
{MISSING_FIELDS}

Please provide the missing information.`,

  profileSuccess: `✅ Great! Your profile is all set up!

Your Daily Nutrition Targets:
• Calories: {CALORIES}
• Protein: {PROTEIN}g
• Carbs: {CARBS}g
• Fat: {FAT}g

Now you can:
📱 Track meals: "I ate 2 chapati with dal"
📸 Scan food photos: Upload image and say "scan this"
📊 Check progress: "Show my progress"
🥗 Get meal plans: "Create a meal plan"

What would you like to do first?`,

  firstMealPrompt: `Now let's track your first meal! 

You can:
1. Tell me what you ate: "I had 2 idli with sambhar"
2. Upload a food photo: "Scan this food" (with image)
3. Scan a barcode: "Scan this barcode" (with barcode image)

What did you have for your last meal?`,

  dailyGreeting: {
    morning: `Good morning! 🌅 Ready to track your breakfast?`,
    afternoon: `Good afternoon! ☀️ Have you had lunch yet?`,
    evening: `Good evening! 🌆 Time to log your dinner?`,
    night: `Good night! 🌙 Don't forget to track your last meal of the day!`
  }
};

// Parse natural language profile input
function parseProfileFromText(text) {
  const profile = {};
  
  // Extract name - more flexible patterns
  const namePatterns = [
    /(?:name is|i'm|i am|my name is|this is|myself)\s+([a-zA-Z\s]+?)(?:,|\.|\s+(?:i'm|i am|and|weight|height|\d))/i,
    /^([a-zA-Z\s]+?)(?:,|\s+(?:weight|height|\d))/i,
    /^([a-zA-Z\s]+?)\s+here/i
  ];
  
  for (const pattern of namePatterns) {
    const nameMatch = text.match(pattern);
    if (nameMatch) {
      profile.name = nameMatch[1].trim();
      break;
    }
  }
  
  // Extract age - more flexible patterns
  const agePatterns = [
    /(\d+)\s*(?:years?\s*old|yrs?\s*old|year\s*old)/i,
    /(?:age|aged)\s*(?:is)?\s*(\d+)/i,
    /(?:i'm|i am)\s*(\d+)\s*(?:years?)?(?:\s|,|\.|$)/i
  ];
  
  for (const pattern of agePatterns) {
    const ageMatch = text.match(pattern);
    if (ageMatch) {
      profile.age = parseInt(ageMatch[1]);
      break;
    }
  }
  
  // Extract weight - more flexible patterns
  const weightPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|kgs|kilos?)/i,
    /(?:weight|weigh)\s*(?:is)?\s*(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|kgs)?/i,
    /(\d+(?:\.\d+)?)\s*(?:kg|kilograms?|kgs)\s*(?:weight|heavy)/i
  ];
  
  for (const pattern of weightPatterns) {
    const weightMatch = text.match(pattern);
    if (weightMatch) {
      profile.weight_kg = parseFloat(weightMatch[1]);
      break;
    }
  }
  
  // Extract height - more flexible patterns
  const heightPatterns = [
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?|cms|centimetres?)/i,
    /(?:height|tall)\s*(?:is)?\s*(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)?/i,
    /(\d+(?:\.\d+)?)\s*(?:cm|centimeters?)\s*(?:tall|height)/i
  ];
  
  for (const pattern of heightPatterns) {
    const heightMatch = text.match(pattern);
    if (heightMatch) {
      profile.height_cm = parseFloat(heightMatch[1]);
      break;
    }
  }
  
  // Extract gender
  if (text.match(/\b(male|man|boy)\b/i)) {
    profile.gender = 'male';
  } else if (text.match(/\b(female|woman|girl)\b/i)) {
    profile.gender = 'female';
  }
  
  // Extract health conditions with flexible parsing
  if (text.match(/\b(no health conditions?|none|healthy|no conditions?|no diseases?|nothing|nil|no problems?)\b/i)) {
    profile.health_conditions = ['none'];
  } else {
    const conditions = [];
    
    // Diabetes variations
    if (text.match(/\b(diabet(?:es|ic|is)?|diabitic|diabeties|sugar\s*(?:problem|issue)?|type\s*[12]\s*diabet)/i)) {
      conditions.push('diabetes');
    }
    
    // Hypertension/BP variations
    if (text.match(/\b(hypertension|high\s*(?:blood\s*)?(?:pressure|bp)|bp\s*(?:problem|issue))/i)) {
      conditions.push('hypertension');
    }
    
    // Pregnancy variations
    if (text.match(/\b(pregnant|pregnancy|expecting|with\s*child)/i)) {
      conditions.push('pregnancy');
    }
    
    // Lactose intolerance variations
    if (text.match(/\b(lactose\s*(?:intolerant|intolerance)|milk\s*(?:allergy|problem)|dairy\s*(?:allergy|intolerant))/i)) {
      conditions.push('lactose_intolerant');
    }
    
    // Gluten variations
    if (text.match(/\b(gluten\s*(?:intolerant|intolerance|free)|celiac|coeliac|wheat\s*(?:allergy|intolerant))/i)) {
      conditions.push('gluten_intolerant');
    }
    
    // Thyroid variations
    if (text.match(/\b(thyroid|hypo\s*thyroid|hyper\s*thyroid|thyroidism)/i)) {
      conditions.push('thyroid');
    }
    
    // Heart conditions
    if (text.match(/\b(heart\s*(?:disease|condition|problem|issue)|cardiac|cardiovascular)/i)) {
      conditions.push('heart_disease');
    }
    
    // Kidney conditions
    if (text.match(/\b(kidney\s*(?:disease|condition|problem|issue)|renal)/i)) {
      conditions.push('kidney_disease');
    }
    
    // PCOS variations
    if (text.match(/\b(pcos|poly\s*cystic|polycystic)/i)) {
      conditions.push('pcos');
    }
    
    // Allergy variations
    if (text.match(/\b(nut\s*allergy|peanut\s*allergy|tree\s*nut)/i)) {
      conditions.push('nut_allergy');
    }
    if (text.match(/\b(seafood\s*allergy|fish\s*allergy|shellfish)/i)) {
      conditions.push('seafood_allergy');
    }
    
    // Check for any other conditions mentioned after common phrases
    const conditionPhrases = text.match(/(?:have|suffer\s*from|diagnosed\s*with|condition[s]?\s*(?:is|are)?|disease[s]?\s*(?:is|are)?)\s*([a-zA-Z\s,]+?)(?:\.|,|and|$)/gi);
    if (conditionPhrases) {
      // Extract any other conditions not caught above
      conditionPhrases.forEach(phrase => {
        const condition = phrase.replace(/(?:have|suffer\s*from|diagnosed\s*with|condition[s]?\s*(?:is|are)?|disease[s]?\s*(?:is|are)?)\s*/i, '').trim();
        if (condition && !conditions.includes(condition.toLowerCase())) {
          // Add the condition as-is if it's not already captured
          conditions.push(condition.toLowerCase().replace(/\s+/g, '_'));
        }
      });
    }
    
    profile.health_conditions = conditions.length > 0 ? conditions : [];
  }
  
  // Extract dietary preferences
  const dietary = [];
  if (text.match(/\bvegetarian\b/i)) dietary.push('vegetarian');
  if (text.match(/\bvegan\b/i)) dietary.push('vegan');
  if (text.match(/\bhalal\b/i)) dietary.push('halal');
  if (text.match(/\bkosher\b/i)) dietary.push('kosher');
  if (dietary.length > 0) {
    profile.dietary_restrictions = dietary;
  }
  
  // Extract activity level
  if (text.match(/\b(?:very\s*)?active|exercise\s*(?:daily|regularly)\b/i)) {
    profile.activity_level = 'high';
  } else if (text.match(/\bmoderate(?:ly)?\s*active\b/i)) {
    profile.activity_level = 'moderate';
  } else if (text.match(/\bsedentary|inactive|desk\s*job\b/i)) {
    profile.activity_level = 'low';
  }
  
  // Extract health goals
  const goals = [];
  if (text.match(/\blose\s*weight|weight\s*loss\b/i)) goals.push('weight_loss');
  if (text.match(/\bgain\s*weight|weight\s*gain\b/i)) goals.push('weight_gain');
  if (text.match(/\bmuscle|strength|bulk\b/i)) goals.push('muscle_gain');
  if (text.match(/\bhealthy|maintain|fitness\b/i)) goals.push('maintain');
  if (goals.length > 0) {
    profile.health_goals = goals;
  }
  
  return profile;
}

// Get missing required fields
function getMissingFields(profile) {
  const required = {
    name: 'Your name',
    age: 'Your age (in years)',
    weight_kg: 'Your weight (in kg)',
    height_cm: 'Your height (in cm)',
    gender: 'Your gender (male/female)'
  };
  
  const missing = [];
  for (const [field, description] of Object.entries(required)) {
    if (!profile[field] && profile[field] !== 0) {
      missing.push(`• ${description}`);
    }
  }
  
  return missing;
}

// Get time-based greeting
function getTimeBasedGreeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return ONBOARDING_MESSAGES.dailyGreeting.morning;
  if (hour >= 12 && hour < 17) return ONBOARDING_MESSAGES.dailyGreeting.afternoon;
  if (hour >= 17 && hour < 21) return ONBOARDING_MESSAGES.dailyGreeting.evening;
  return ONBOARDING_MESSAGES.dailyGreeting.night;
}

// Format profile success message
function formatProfileSuccess(profile) {
  return ONBOARDING_MESSAGES.profileSuccess
    .replace('{CALORIES}', profile.calorie_target || 2000)
    .replace('{PROTEIN}', profile.protein_target || 150)
    .replace('{CARBS}', profile.carb_target || 250)
    .replace('{FAT}', profile.fat_target || 65);
}

// Format incomplete profile message
function formatIncompleteProfile(missingFields) {
  return ONBOARDING_MESSAGES.profileIncomplete
    .replace('{MISSING_FIELDS}', missingFields.join('\n'));
}

module.exports = {
  ONBOARDING_MESSAGES,
  parseProfileFromText,
  getMissingFields,
  getTimeBasedGreeting,
  formatProfileSuccess,
  formatIncompleteProfile
};