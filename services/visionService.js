const axios = require('axios');
const vision = require('@google-cloud/vision');

class VisionService {
  constructor() {
    // Initialize Vision client with Google Cloud environment variables
    if (process.env.GOOGLE_CLOUD_PROJECT_ID && 
        process.env.GOOGLE_CLOUD_CLIENT_EMAIL && 
        process.env.GOOGLE_CLOUD_PRIVATE_KEY) {
      try {
        const credentials = {
          type: process.env.GOOGLE_CLOUD_TYPE,
          project_id: process.env.GOOGLE_CLOUD_PROJECT_ID,
          private_key_id: process.env.GOOGLE_CLOUD_PRIVATE_KEY_ID,
          private_key: process.env.GOOGLE_CLOUD_PRIVATE_KEY.replace(/\\n/g, '\n'),
          client_email: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
          client_id: process.env.GOOGLE_CLOUD_CLIENT_ID,
          auth_uri: process.env.GOOGLE_CLOUD_AUTH_URI,
          token_uri: process.env.GOOGLE_CLOUD_TOKEN_URI,
          auth_provider_x509_cert_url: process.env.GOOGLE_CLOUD_AUTH_PROVIDER_X509_CERT_URL,
          client_x509_cert_url: process.env.GOOGLE_CLOUD_CLIENT_X509_CERT_URL,
          universe_domain: process.env.GOOGLE_CLOUD_UNIVERSE_DOMAIN
        };
        
        this.visionClient = new vision.ImageAnnotatorClient({
          credentials: credentials,
          projectId: process.env.GOOGLE_CLOUD_PROJECT_ID
        });
        console.log('Vision client initialized with environment variables');
      } catch (error) {
        console.error('Failed to initialize Vision client:', error.message);
        console.error('Full error:', error);
      }
    }
  }

  async detectFoodFromBase64(base64Image) {
    console.log('detectFoodFromBase64 called, visionClient exists:', !!this.visionClient);
    if (!this.visionClient) {
      console.log('Vision client not initialized, using mock detection');
      return this.mockImageDetection('local-image');
    }

    // Strip data URI prefix if present
    let cleanBase64 = base64Image;
    if (base64Image.includes('data:image')) {
      cleanBase64 = base64Image.split(',')[1];
    }

    console.log('Using real Vision API...');
    console.log('Base64 preview:', cleanBase64.substring(0, 50) + '...');
    try {
      const [result] = await this.visionClient.annotateImage({
        image: { content: cleanBase64 },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'WEB_DETECTION', maxResults: 5 },
          { type: 'TEXT_DETECTION', maxResults: 1 }
        ]
      });

      console.log('Vision API raw result:', JSON.stringify(result, null, 2));
      const foodItems = this.extractFoodItems(result);
      console.log('Extracted food items:', foodItems);
      return {
        success: true,
        detectedFoods: foodItems,
        primaryFood: foodItems.length > 0 ? foodItems[0].name : 'Unknown food',
        raw: result
      };
    } catch (error) {
      console.error('Vision API error in detectFoodFromBase64:', error.message);
      console.error('Error code:', error.code);
      console.error('Error details:', error.details);
      return this.mockImageDetection('local-image');
    }
  }

  async detectFoodFromImage(imageUrl) {
    if (!this.visionClient) {
      console.log('Google Vision API not configured, using fallback');
      return this.mockImageDetection(imageUrl);
    }

    try {
      // Use Vision client for URL-based images
      const [result] = await this.visionClient.annotateImage({
        image: {
          source: { imageUri: imageUrl }
        },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 10 },
          { type: 'WEB_DETECTION', maxResults: 5 },
          { type: 'TEXT_DETECTION', maxResults: 1 }
        ]
      });

      const foodItems = this.extractFoodItems(result);
      return {
        success: true,
        detectedFoods: foodItems,
        primaryFood: foodItems.length > 0 ? foodItems[0].name : 'Unknown food',
        raw: result
      };
    } catch (error) {
      console.error('Vision API error:', error);
      // Fallback to REST API if available
      if (process.env.GOOGLE_VISION_API_KEY) {
        try {
          const response = await axios.post(
            `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
        {
          requests: [{
            image: {
              source: {
                imageUri: imageUrl
              }
            },
            features: [
              {
                type: 'LABEL_DETECTION',
                maxResults: 10
              },
              {
                type: 'WEB_DETECTION',
                maxResults: 5
              }
            ]
          }]
        }
          );

          if (response.data.responses && response.data.responses[0]) {
            const result = response.data.responses[0];
            const foodItems = this.extractFoodItems(result);
            
            return {
              success: true,
              detectedFoods: foodItems,
              primaryFood: foodItems[0] || 'Unknown food'
            };
          }
        } catch (error) {
          console.error('Google Vision API error:', error.message);
        }
      }
    }

    // Fallback to mock detection
    return this.mockImageDetection(imageUrl);
  }

  extractFoodItems(visionResult) {
    // Categories to EXCLUDE - these are not actual foods
    const excludeCategories = [
      'cuisine', 'food', 'ingredient', 'recipe', 'dish', 'meal',
      'breakfast', 'lunch', 'dinner', 'snack', 'staple food',
      'south indian cuisine', 'tamil cuisine', 'indian cuisine',
      'north indian cuisine', 'chinese cuisine', 'italian cuisine'
    ];
    
    // Actual food items we want to detect
    const actualFoodItems = [
      'dosa', 'masala dosa', 'plain dosa', 'rava dosa', 'idli', 'vada', 'uttapam',
      'sambar', 'chutney', 'coconut chutney', 'tomato chutney',
      'rice', 'dal', 'biryani', 'pulao', 'fried rice',
      'chapati', 'roti', 'naan', 'paratha', 'paneer', 'palak paneer',
      'chicken', 'mutton', 'fish', 'egg', 'omelette',
      'salad', 'sandwich', 'pizza', 'burger', 'pasta', 'noodles',
      // Indian snacks and packaged foods
      'bhujia', 'bikano bhujia', 'haldiram bhujia', 'aloo bhujia', 'sev',
      'namkeen', 'mixture', 'chivda', 'chakli', 'murukku',
      'chips', 'lays', 'kurkure', 'bingo', 'pringles',
      'maggi', 'instant noodles', 'yippee', 'top ramen',
      'biscuit', 'parle-g', 'marie', 'oreo', 'cookies',
      'chocolate', 'dairy milk', 'kitkat', 'snickers',
      'samosa', 'kachori', 'pakora', 'bhajiya', 'vada pav',
      'pav bhaji', 'chole bhature', 'rajma chawal',
      'ladoo', 'barfi', 'gulab jamun', 'rasgulla', 'jalebi',
      'poha', 'upma', 'dhokla', 'khandvi',
      'lassi', 'chai', 'coffee', 'tea', 'milk',
      'cola', 'pepsi', 'sprite', 'fanta', 'thumbs up'
    ];

    const detectedFoods = [];
    const addedItems = new Set(); // To avoid duplicates

    // Check label annotations
    if (visionResult.labelAnnotations) {
      console.log('Label annotations found:', visionResult.labelAnnotations.length);
      console.log('Label details:', visionResult.labelAnnotations?.map(l => ({ name: l.description, score: l.score })));
      visionResult.labelAnnotations.forEach(label => {
        const labelLower = label.description.toLowerCase();
        
        // Skip if it's a category, not actual food
        if (excludeCategories.some(cat => labelLower.includes(cat))) {
          return;
        }
        
        // Check if it's an actual food item
        const isActualFood = actualFoodItems.some(food => 
          labelLower.includes(food) || food.includes(labelLower)
        );
        
        // Special case for items that contain food names (e.g., "Masala dosa")
        const containsFoodName = actualFoodItems.some(food => {
          const words = food.split(' ');
          return words.some(word => labelLower.includes(word));
        });
        
        if ((isActualFood || containsFoodName) && !addedItems.has(labelLower)) {
          addedItems.add(labelLower);
          detectedFoods.push({
            name: label.description,
            confidence: label.score,
            source: 'label'
          });
        }
      });
    }

    // Check web detection for better food identification
    if (visionResult.webDetection) {
      console.log('Web detection available, checking for food items...');
      // Best guess labels often have specific food names
      if (visionResult.webDetection.bestGuessLabels) {
        visionResult.webDetection.bestGuessLabels.forEach(label => {
          detectedFoods.push({
            name: label.label,
            confidence: 0.9,
            source: 'web'
          });
        });
      }

      // Web entities might have food names
      if (visionResult.webDetection.webEntities) {
        visionResult.webDetection.webEntities
          .filter(entity => entity.description && entity.score > 0.5)
          .forEach(entity => {
            const entityLower = entity.description.toLowerCase();
            
            // Skip categories
            if (excludeCategories.some(cat => entityLower.includes(cat))) {
              return;
            }
            
            // Check for actual food items
            const isActualFood = actualFoodItems.some(food => 
              entityLower.includes(food) || food.includes(entityLower)
            );
            
            if (isActualFood && !addedItems.has(entityLower)) {
              addedItems.add(entityLower);
              detectedFoods.push({
                name: entity.description,
                confidence: entity.score,
                source: 'web_entity'
              });
            }
          });
      }
    }

    // Sort by confidence and remove duplicates
    const uniqueFoods = [];
    const seen = new Set();
    
    detectedFoods
      .sort((a, b) => b.confidence - a.confidence)
      .forEach(food => {
        const normalized = food.name.toLowerCase();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          uniqueFoods.push(food);
        }
      });

    return uniqueFoods;
  }

  mockImageDetection(imageUrl) {
    // Simple mock detection based on URL or random selection
    const mockFoods = [
      'Pizza',
      'Burger',
      'Salad',
      'Pasta',
      'Sandwich',
      'Rice bowl',
      'Grilled chicken',
      'Vegetable curry'
    ];

    // Try to guess from URL
    const urlLower = imageUrl.toLowerCase();
    let detectedFood = mockFoods[Math.floor(Math.random() * mockFoods.length)];

    mockFoods.forEach(food => {
      if (urlLower.includes(food.toLowerCase().replace(' ', ''))) {
        detectedFood = food;
      }
    });

    return {
      success: true,
      detectedFoods: [detectedFood],
      primaryFood: detectedFood,
      mock: true
    };
  }

}

module.exports = new VisionService();