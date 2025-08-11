// Security events removed - using standard logging

class ErrorHandler {
  constructor() {
    this.errorTypes = {
      VALIDATION_ERROR: 'ValidationError',
      AUTH_ERROR: 'AuthenticationError',
      DATABASE_ERROR: 'DatabaseError',
      API_ERROR: 'ExternalAPIError',
      RATE_LIMIT_ERROR: 'RateLimitError',
      SECURITY_ERROR: 'SecurityError',
      BUSINESS_LOGIC_ERROR: 'BusinessLogicError'
    };
  }

  // Wrap async functions with error handling
  asyncWrapper(fn, context = 'Unknown') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.logError(error, context);
        throw this.formatError(error, context);
      }
    };
  }

  // Express middleware error wrapper
  asyncMiddleware(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }

  // Format errors for consistent response
  formatError(error, context) {
    const errorId = this.generateErrorId();
    
    // Determine error type
    let errorType = this.errorTypes.BUSINESS_LOGIC_ERROR;
    let statusCode = 500;
    let userMessage = 'An error occurred processing your request';
    
    if (error.name === 'ValidationError' || error.message.includes('Invalid')) {
      errorType = this.errorTypes.VALIDATION_ERROR;
      statusCode = 400;
      userMessage = error.message;
    } else if (error.message.includes('token') || error.message.includes('authentication')) {
      errorType = this.errorTypes.AUTH_ERROR;
      statusCode = 401;
      userMessage = 'Authentication failed';
    } else if (error.message.includes('rate limit')) {
      errorType = this.errorTypes.RATE_LIMIT_ERROR;
      statusCode = 429;
      userMessage = 'Too many requests. Please try again later.';
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      errorType = this.errorTypes.API_ERROR;
      statusCode = 503;
      userMessage = 'Service temporarily unavailable';
    }
    
    return {
      error: {
        id: errorId,
        type: errorType,
        message: userMessage,
        statusCode,
        timestamp: new Date().toISOString(),
        ...(process.env.NODE_ENV === 'development' && { 
          debug: {
            originalError: error.message,
            stack: error.stack,
            context
          }
        })
      }
    };
  }

  // Log errors with context
  logError(error, context) {
    const errorLog = {
      timestamp: new Date().toISOString(),
      context,
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        type: error.name
      }
    };
    
    console.error('Error occurred:', errorLog);
    
    // Log security-related errors
    if (this.isSecurityRelated(error)) {
      console.error('Security error:', {
        context,
        error: error.message,
        timestamp: new Date()
      });
    }
  }

  isSecurityRelated(error) {
    const securityKeywords = ['token', 'auth', 'permission', 'forbidden', 'unauthorized'];
    return securityKeywords.some(keyword => 
      error.message.toLowerCase().includes(keyword)
    );
  }

  generateErrorId() {
    return `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Handle specific service errors
  handleServiceError(service, error) {
    const serviceErrors = {
      firebase: {
        'auth/id-token-expired': 'Your session has expired. Please log in again.',
        'permission-denied': 'You do not have permission to perform this action.',
        'unavailable': 'Database is temporarily unavailable.'
      },
      vision: {
        'INVALID_ARGUMENT': 'Invalid image format. Please upload a valid image.',
        'RESOURCE_EXHAUSTED': 'Image analysis quota exceeded. Please try again later.',
        'DEADLINE_EXCEEDED': 'Image analysis took too long. Please try a smaller image.'
      },
      openai: {
        'rate_limit_exceeded': 'AI service rate limit reached. Please try again in a few minutes.',
        'invalid_api_key': 'AI service configuration error.',
        'model_not_found': 'AI model temporarily unavailable.'
      }
    };
    
    const serviceError = serviceErrors[service];
    if (serviceError && serviceError[error.code]) {
      return new Error(serviceError[error.code]);
    }
    
    return error;
  }

  // Retry logic for transient failures
  async retryOperation(operation, options = {}) {
    const {
      maxRetries = 3,
      delay = 1000,
      backoff = 2,
      shouldRetry = (error) => error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED'
    } = options;
    
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (!shouldRetry(error) || attempt === maxRetries - 1) {
          throw error;
        }
        
        const waitTime = delay * Math.pow(backoff, attempt);
        console.log(`Retry attempt ${attempt + 1} after ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    throw lastError;
  }

  // Circuit breaker for external services
  createCircuitBreaker(name, options = {}) {
    const {
      threshold = 5,
      timeout = 60000,
      resetTimeout = 30000
    } = options;
    
    const state = {
      failures: 0,
      lastFailureTime: null,
      state: 'CLOSED' // CLOSED, OPEN, HALF_OPEN
    };
    
    return async (operation) => {
      // Check if circuit is open
      if (state.state === 'OPEN') {
        const now = Date.now();
        if (now - state.lastFailureTime > resetTimeout) {
          state.state = 'HALF_OPEN';
          state.failures = 0;
        } else {
          throw new Error(`Circuit breaker OPEN for ${name}`);
        }
      }
      
      try {
        const result = await Promise.race([
          operation(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timeout')), timeout)
          )
        ]);
        
        // Reset on success
        if (state.state === 'HALF_OPEN') {
          state.state = 'CLOSED';
          state.failures = 0;
        }
        
        return result;
      } catch (error) {
        state.failures++;
        state.lastFailureTime = Date.now();
        
        if (state.failures >= threshold) {
          state.state = 'OPEN';
          console.error(`Circuit breaker OPEN for ${name} after ${state.failures} failures`);
        }
        
        throw error;
      }
    };
  }
}

module.exports = new ErrorHandler();