const rateLimit = require('express-rate-limit');

// Create rate limiters with proper trust proxy settings
const createRateLimiter = (options) => {
  return rateLimit({
    ...options,
    // Skip rate limiting errors that crash the server
    skipFailedRequests: true,
    skipSuccessfulRequests: false,
    // Use custom key generator that doesn't crash
    keyGenerator: (req) => {
      // Try to get IP from various sources
      const ip = req.ip || 
                 req.connection?.remoteAddress || 
                 req.headers['x-real-ip'] ||
                 req.headers['x-forwarded-for']?.split(',')[0] ||
                 'unknown';
      return ip;
    },
    // Don't validate headers
    validate: false,
    // Use legacy headers to avoid issues
    standardHeaders: false,
    legacyHeaders: true
  });
};

module.exports = { createRateLimiter };