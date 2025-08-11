const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Rate limiters configuration
const rateLimiters = {
  api: (req, res, next) => next(), // Simplified for now
  validate: (req, res, next) => next(),
  setupProfile: (req, res, next) => next(),
  scanFood: (req, res, next) => next(),
  addFood: (req, res, next) => next(),
  getProgress: (req, res, next) => next(),
  getLeaderboard: (req, res, next) => next(),
  checkBalance: (req, res, next) => next(),
  viewRewards: (req, res, next) => next(),
  generateMealPlan: (req, res, next) => next(),
  getWeeklyAnalysis: (req, res, next) => next(),
  exportData: (req, res, next) => next(),
  getPersonalization: (req, res, next) => next(),
  configureWebhook: (req, res, next) => next()
};

// Input validation middleware
const validateInput = (req, res, next) => {
  // Basic input validation
  if (req.body && typeof req.body === 'object') {
    // Remove any potential XSS attempts
    const sanitize = (obj) => {
      for (let key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = obj[key].replace(/<script[^>]*>.*?<\/script>/gi, '');
        } else if (typeof obj[key] === 'object') {
          sanitize(obj[key]);
        }
      }
    };
    sanitize(req.body);
  }
  next();
};

// Image validation
const validateImage = (base64String) => {
  if (!base64String) return { valid: false, error: 'No image provided' };
  
  const matches = base64String.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,/);
  if (!matches) {
    return { valid: false, error: 'Invalid image format' };
  }
  
  const imageData = base64String.replace(/^data:image\/\w+;base64,/, '');
  const sizeInBytes = Buffer.from(imageData, 'base64').length;
  const sizeInMB = sizeInBytes / (1024 * 1024);
  
  if (sizeInMB > 10) {
    return { valid: false, error: 'Image size exceeds 10MB limit' };
  }
  
  return { valid: true };
};

// Token generation
const generateToken = (phone) => {
  return jwt.sign(
    { phone, type: 'api' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Secure token validation
const secureValidateToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.phone;
  } catch (err) {
    return null;
  }
};

// CORS options
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['*'];
    
    if (allowedOrigins.includes('*') || !origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
};

// Error handler
const secureErrorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : err.message;
    
  res.status(err.status || 500).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
};

// Payload limits
const payloadLimits = {
  default: '10mb',
  image: '10mb',
  json: '1mb'
};

// API key validation
const validateAPIKeys = () => {
  const required = [
    'JWT_SECRET',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    console.log('Please check your .env file');
    process.exit(1);
  }
  
  console.log('✅ All required environment variables present');
};

module.exports = {
  rateLimiters,
  validateInput,
  validateImage,
  generateToken,
  secureValidateToken,
  corsOptions,
  securityHeaders,
  secureErrorHandler,
  payloadLimits,
  validateAPIKeys
};