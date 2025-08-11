const axios = require('axios');
const cacheService = require('../lib/cacheService');
const errorHandler = require('../lib/errorHandler');

class PuchImageFetcher {
  constructor() {
    // Puch AI image endpoint (to be configured based on their API)
    this.baseUrl = process.env.PUCH_AI_IMAGE_API || 'https://api.puch.ai/images';
    this.apiKey = process.env.PUCH_AI_API_KEY || null;
    
    // Cache settings
    this.cachePrefix = 'puch_image:';
    this.cacheTTL = 3600; // 1 hour
    
    // Image ID pattern validation
    this.imageIdPattern = /^[a-zA-Z0-9_-]{6,20}$/;
  }

  /**
   * Validates if a string is a valid Puch AI image ID
   */
  isValidImageId(id) {
    return id && typeof id === 'string' && this.imageIdPattern.test(id);
  }

  /**
   * Fetches an image from Puch AI using an image ID
   * @param {string} imageId - The Puch AI image ID
   * @param {string} bearerToken - User's bearer token for authentication
   * @returns {Promise<{success: boolean, data?: string, error?: string}>}
   */
  async fetchImageById(imageId, bearerToken) {
    try {
      // Validate image ID format
      if (!this.isValidImageId(imageId)) {
        console.log(`Invalid image ID format: ${imageId}`);
        return {
          success: false,
          error: 'Invalid image ID format'
        };
      }

      // Check cache first
      const cacheKey = `${this.cachePrefix}${imageId}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        console.log(`Cache hit for Puch AI image: ${imageId}`);
        return {
          success: true,
          data: cached,
          source: 'cache'
        };
      }

      // If no API key configured, return error
      if (!this.apiKey) {
        console.log('Puch AI API key not configured');
        return {
          success: false,
          error: 'Puch AI image fetching not configured'
        };
      }

      console.log(`Fetching image from Puch AI: ${imageId}`);
      
      // Make API request to Puch AI
      const response = await axios.get(`${this.baseUrl}/${imageId}`, {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'X-API-Key': this.apiKey,
          'Accept': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      if (response.data && response.data.image) {
        const imageData = response.data.image;
        
        // Cache the result
        await cacheService.set(cacheKey, imageData, this.cacheTTL);
        
        return {
          success: true,
          data: imageData,
          source: 'api'
        };
      }

      return {
        success: false,
        error: 'No image data in response'
      };

    } catch (error) {
      console.error('Error fetching image from Puch AI:', error.message);
      
      // Handle specific error cases
      if (error.response) {
        switch (error.response.status) {
          case 404:
            return {
              success: false,
              error: 'Image not found'
            };
          case 401:
            return {
              success: false,
              error: 'Unauthorized - check bearer token'
            };
          case 429:
            return {
              success: false,
              error: 'Rate limit exceeded'
            };
          default:
            return {
              success: false,
              error: `API error: ${error.response.status}`
            };
        }
      }

      return {
        success: false,
        error: 'Failed to fetch image from Puch AI'
      };
    }
  }

  /**
   * Attempts to fetch image data using multiple strategies
   * @param {object} args - The request arguments
   * @param {object} req - The Express request object
   * @returns {Promise<{success: boolean, data?: string, fallback?: object}>}
   */
  async resolveImage(args, req) {
    const { puch_image_data, puch_stored_image_data, bearer_token } = args;
    
    // Strategy 1: Check if we already have base64 data
    if (puch_image_data && puch_image_data.length > 100) {
      console.log('Using existing base64 data from puch_image_data');
      return {
        success: true,
        data: puch_image_data,
        source: 'direct'
      };
    }

    // Strategy 2: Check puch_stored_image_data parameter
    if (puch_stored_image_data && puch_stored_image_data.length > 100) {
      console.log('Using stored image data from puch_stored_image_data');
      return {
        success: true,
        data: puch_stored_image_data,
        source: 'stored'
      };
    }

    // Strategy 3: If puch_image_data looks like an ID, try to fetch it
    if (this.isValidImageId(puch_image_data)) {
      console.log(`Detected image ID: ${puch_image_data}, attempting to fetch...`);
      const fetchResult = await this.fetchImageById(puch_image_data, bearer_token);
      
      if (fetchResult.success) {
        return fetchResult;
      }
      
      // If fetch failed, return fallback info
      return {
        success: false,
        fallback: {
          imageId: puch_image_data,
          foodSuggestion: args.food_suggestion || args.food_name,
          error: fetchResult.error
        }
      };
    }

    // Strategy 4: Check request body for additional image data
    if (req && req.body && req.body.params && req.body.params.image_data) {
      const bodyImageData = req.body.params.image_data;
      if (bodyImageData && bodyImageData.length > 100) {
        console.log('Found image data in request body');
        return {
          success: true,
          data: bodyImageData,
          source: 'request_body'
        };
      }
    }

    // No image data found
    return {
      success: false,
      fallback: {
        foodSuggestion: args.food_suggestion || args.food_name
      }
    };
  }

  /**
   * Generates appropriate user messages based on image resolution result
   */
  generateUserMessage(result, args) {
    if (result.success) {
      return null; // No special message needed, proceed with analysis
    }

    const { fallback } = result;
    
    if (fallback && fallback.foodSuggestion) {
      return {
        type: 'fallback_with_suggestion',
        message: `I couldn't retrieve the image, but I see you're trying to scan "${fallback.foodSuggestion}". Let me analyze that for you!`,
        suggestion: fallback.foodSuggestion
      };
    }

    if (fallback && fallback.imageId) {
      return {
        type: 'image_not_found',
        message: `🔍 IMAGE ANALYSIS PENDING

I received an image reference (${fallback.imageId}) but couldn't retrieve the actual image data.

Please either:
📝 Tell me what you ate (e.g., "2 chapati with dal")
📸 Try uploading the image again

What food would you like me to analyze?`
      };
    }

    return {
      type: 'no_image_data',
      message: `📸 IMAGE NOT RECEIVED

I didn't receive any image data to analyze. Please:

📝 Tell me what you ate (e.g., "1 bowl of bhujia")
   OR
📸 Try uploading the image again

What food would you like me to analyze?`
    };
  }
}

module.exports = new PuchImageFetcher();