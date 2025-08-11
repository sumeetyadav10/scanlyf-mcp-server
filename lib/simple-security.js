const jwt = require('jsonwebtoken');
const { createSafeRateLimiter } = require('./comprehensive-fix');

// Simple JWT validation
const validateToken = async (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded.phone;
  } catch (err) {
    return null;
  }
};

// Generate JWT token
const generateToken = (phone) => {
  return jwt.sign(
    { phone, type: 'api' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// Basic rate limiters for expensive operations
const rateLimiters = {
  // General API rate limit
  api: createSafeRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests, please try again later'
  }),
  
  // Stricter limits for expensive operations
  scanFood: createSafeRateLimiter({
    windowMs: 60 * 1000,
    max: 20, // 20 food scans per minute (Google Vision API costs)
    message: 'Too many food scans, please wait a moment'
  }),
  
  // Weekly analysis is expensive (multiple AI calls)
  weeklyAnalysis: createSafeRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 analyses per hour
    message: 'Weekly analysis limit reached, try again later'
  })
};

// Simple input validation - just ensure valid JSON and reasonable sizes
const validateInput = (req, res, next) => {
  // Check Content-Type
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(400).json({ error: 'Content-Type must be application/json' });
  }
  
  // Basic size check (already handled by express.json limit)
  next();
};

// Security headers - these are actually useful
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// CORS configuration
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',') 
      : ['http://localhost:3000'];
    
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Simple error handler - don't leak stack traces in production
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message);
  
  const isDev = process.env.NODE_ENV !== 'production';
  
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    ...(isDev && { stack: err.stack })
  });
};

// Validate required environment variables
const validateEnv = () => {
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
  
  console.log('✅ Environment variables validated');
};

// Simple image validation
const validateImage = (base64String) => {
  if (!base64String) {
    return { valid: false, error: 'No image provided' };
  }
  
  // Check if it's a valid base64 image with or without data URI prefix
  const hasDataPrefix = base64String.match(/^data:image\/(png|jpg|jpeg|gif|webp);base64,/);
  
  let imageData = base64String;
  if (hasDataPrefix) {
    // Extract the base64 part after the comma
    imageData = base64String.split(',')[1];
  } else {
    // Check if it looks like base64 (allowing for whitespace)
    const cleanData = base64String.replace(/\s/g, '');
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    if (!base64Regex.test(cleanData)) {
      return { valid: false, error: 'Invalid image format. Please provide a base64 encoded image.' };
    }
    imageData = base64String;
  }
  
  // Check size (rough estimate)
  const sizeInBytes = imageData.length * 0.75;
  const sizeInMB = sizeInBytes / (1024 * 1024);
  
  if (sizeInMB > 10) {
    return { valid: false, error: 'Image size exceeds 10MB limit' };
  }
  
  return { valid: true };
};

module.exports = {
  validateToken,
  generateToken,
  rateLimiters,
  validateInput,
  securityHeaders,
  corsOptions,
  errorHandler,
  validateEnv,
  validateImage
};