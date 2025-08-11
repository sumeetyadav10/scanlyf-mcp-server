const userService = require('../services/userService');
const { 
  parseProfileFromText, 
  getMissingFields, 
  formatProfileSuccess, 
  formatIncompleteProfile,
  ONBOARDING_MESSAGES 
} = require('../lib/userOnboarding');

async function handleSmartProfileSetup(args, req, phone) {
  const { text, ...explicitData } = args;
  
  let profileData = { ...explicitData };
  
  // If text is provided, parse it for profile information
  if (text) {
    const parsedProfile = parseProfileFromText(text);
    // Merge parsed data with explicit data (explicit data takes precedence)
    profileData = { ...parsedProfile, ...profileData };
  }
  
  // Check for missing fields
  const missingFields = getMissingFields(profileData);
  
  if (missingFields.length > 0) {
    // Return friendly message about missing fields
    return {
      success: false,
      message: formatIncompleteProfile(missingFields),
      missingFields: missingFields,
      parsedData: profileData
    };
  }
  
  // Set defaults for optional fields
  profileData.activity_level = profileData.activity_level || 'moderate';
  profileData.dietary_restrictions = profileData.dietary_restrictions || [];
  profileData.health_goals = profileData.health_goals || ['maintain'];
  profileData.timezone = profileData.timezone || 'Asia/Kolkata';
  
  try {
    // Create or update profile
    const profile = await userService.createOrUpdateProfile(phone, profileData);
    
    return {
      success: true,
      message: formatProfileSuccess(profile),
      profile: profile,
      nextPrompt: ONBOARDING_MESSAGES.firstMealPrompt
    };
  } catch (error) {
    return {
      success: false,
      message: `Oops! There was an issue setting up your profile: ${error.message}. Please try again.`,
      error: error.message
    };
  }
}

// Check if text contains profile setup intent
function isProfileSetupIntent(text) {
  if (!text || typeof text !== 'string') return false;
  
  const lowerText = text.toLowerCase();
  
  // Direct profile setup phrases
  if (lowerText.includes('set up my profile') || 
      lowerText.includes('setup my profile') ||
      lowerText.includes('create my profile') ||
      lowerText.includes('update my profile')) {
    return true;
  }
  
  // Natural introduction patterns
  if (lowerText.match(/(?:i'm|i am|my name is)\s+\w+/i) &&
      (lowerText.includes('years old') || 
       lowerText.includes('kg') || 
       lowerText.includes('cm'))) {
    return true;
  }
  
  return false;
}

module.exports = {
  handleSmartProfileSetup,
  isProfileSetupIntent
};