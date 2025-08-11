const jwt = require('jsonwebtoken');

// Puch AI placeholders that indicate we need to generate a token
const PUCH_AI_PLACEHOLDERS = [
  'YOUR_BEARER_TOKEN',
  'default',
  'kjFfXhp23J'
];

// Default phone number for Puch AI users
const DEFAULT_PUCH_PHONE = process.env.TEST_PHONE || 'puch_default_user';

/**
 * Generate a valid JWT token for Puch AI when they send placeholders
 */
function generatePuchAIToken(phone = DEFAULT_PUCH_PHONE) {
  const JWT_SECRET = process.env.JWT_SECRET || 'scanlyf-jwt-secret-2024';
  
  return jwt.sign(
    { 
      phone: phone.startsWith('+') ? phone.substring(1) : phone,
      type: 'api'
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * Fix Puch AI token issues by generating a real token when needed
 */
function fixPuchAIToken(args, req) {
  // Check if bearer_token is a placeholder
  const bearerToken = args?.bearer_token;
  
  if (!bearerToken || PUCH_AI_PLACEHOLDERS.includes(bearerToken)) {
    console.log(`Puch AI sent placeholder token: ${bearerToken}, generating real JWT...`);
    
    // Check if there's a phone number in the request context
    let phone = DEFAULT_PUCH_PHONE;
    
    // Try to extract phone from various sources
    if (req?.body?.context?.phone) {
      phone = req.body.context.phone;
    } else if (req?.headers?.['x-user-phone']) {
      phone = req.headers['x-user-phone'];
    } else if (args?.phone) {
      phone = args.phone;
    }
    
    // Generate a new token
    const newToken = generatePuchAIToken(phone);
    console.log(`Generated new JWT for phone: ${phone}`);
    
    // Replace the placeholder with real token
    args.bearer_token = newToken;
    
    // Also add to Authorization header for consistency
    if (req && req.headers) {
      req.headers.authorization = `Bearer ${newToken}`;
    }
    
    return newToken;
  }
  
  // Check if it's already a valid JWT
  if (bearerToken && bearerToken.includes('.') && bearerToken.length > 100) {
    return bearerToken;
  }
  
  // If no valid token found, generate one
  console.log('No valid token found, generating default JWT for Puch AI...');
  const newToken = generatePuchAIToken();
  args.bearer_token = newToken;
  
  return newToken;
}

module.exports = {
  generatePuchAIToken,
  fixPuchAIToken,
  PUCH_AI_PLACEHOLDERS
};