// Comprehensive fixes for all issues

// 1. Simple rate limiter that bypasses express-rate-limit issues
const createSafeRateLimiter = (options) => {
  // Simple in-memory store for production
  const store = new Map();
  const { windowMs = 60000, max = 100, message = 'Too many requests' } = options;
  
  // Clean up old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of store.entries()) {
      if (now - data.resetTime > windowMs) {
        store.delete(key);
      }
    }
  }, windowMs);
  
  return (req, res, next) => {
    try {
      // Generate a safe key from IP
      let clientKey = 'default';
      try {
        clientKey = req.headers['x-real-ip'] || 
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   req.ip || 
                   req.socket?.remoteAddress || 
                   req.connection?.remoteAddress ||
                   'default';
        
        // Sanitize the key
        clientKey = clientKey.replace(/[^a-zA-Z0-9.:]/g, '').substring(0, 50);
      } catch (e) {
        clientKey = 'default';
      }
      
      const now = Date.now();
      const clientData = store.get(clientKey) || { count: 0, resetTime: now };
      
      // Reset if window expired
      if (now - clientData.resetTime > windowMs) {
        clientData.count = 0;
        clientData.resetTime = now;
      }
      
      clientData.count++;
      store.set(clientKey, clientData);
      
      // Check if limit exceeded
      if (clientData.count > max) {
        return res.status(429).json({ error: message });
      }
      
      next();
    } catch (error) {
      console.error('Rate limiter error:', error.message);
      // Continue without rate limiting on error
      next();
    }
  };
};

// 2. Robust token extraction
const extractToken = (args, req) => {
  // List of known placeholders
  const placeholders = ['default', 'YOUR_BEARER_TOKEN', 'kjFfXhp23J'];
  
  // Try to get from args
  let token = args?.bearer_token || args?.token;
  
  // If token is a placeholder or missing, get from header
  if (!token || placeholders.includes(token) || token.length < 20) {
    const authHeader = req?.headers?.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
  }
  
  // If we still have a placeholder, return null
  if (placeholders.includes(token)) {
    return null;
  }
  
  return token;
};

// 3. Safe JSON parser
const safeJsonParse = (text, defaultValue = null) => {
  try {
    // Remove any markdown code blocks
    let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    // Trim whitespace
    cleaned = cleaned.trim();
    // Parse
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('JSON parse error:', error.message);
    return defaultValue;
  }
};

// 4. Express app configuration
const configureApp = (app) => {
  // Configure trust proxy for nginx - be specific to avoid rate limit errors
  app.set('trust proxy', 1); // Trust only first proxy (nginx)
  
  // Add request ID for debugging
  app.use((req, res, next) => {
    req.id = Math.random().toString(36).substring(7);
    next();
  });
  
  // Add error boundary
  app.use((req, res, next) => {
    try {
      next();
    } catch (error) {
      console.error('Request error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};

module.exports = {
  createSafeRateLimiter,
  extractToken,
  safeJsonParse,
  configureApp
};