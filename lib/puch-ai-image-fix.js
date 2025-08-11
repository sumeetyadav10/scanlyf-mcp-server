// Puch AI Image Processing Fix
// Based on their implementation: https://github.com/TurboML-Inc/mcp-starter

/**
 * Extract and validate image data from Puch AI requests
 * Puch AI sends base64 image data in the puch_image_data parameter
 */
function extractPuchImageData(args) {
  const {
    puch_image_data,
    input,
    image,
    image_url,
    food_suggestion,
    food_name
  } = args;
  
  // Known placeholders that Puch AI might send
  const placeholders = [
    'Base64 Image',
    'base64_image_data',
    'Base64 encoded image data',
    'image_data',
    'undefined',
    'null',
    '',
    null,
    undefined
  ];
  
  // Image ID pattern (short alphanumeric strings)
  const imageIdPattern = /^[a-zA-Z0-9]{6,12}$/;
  
  // Check puch_image_data first (primary source)
  if (puch_image_data && !placeholders.includes(puch_image_data)) {
    // Check if it's a valid base64 string (should be long)
    if (puch_image_data.length > 100) {
      console.log(`✓ Valid base64 image data in puch_image_data (${puch_image_data.length} chars)`);
      return {
        type: 'base64',
        data: puch_image_data,
        source: 'puch_image_data'
      };
    }
    
    // Check if it's an image ID
    if (imageIdPattern.test(puch_image_data)) {
      console.log(`⚠️ Image ID detected in puch_image_data: ${puch_image_data}`);
      return {
        type: 'image_id',
        id: puch_image_data,
        fallbackFood: food_suggestion || food_name,
        source: 'puch_image_data'
      };
    }
  }
  
  // Check input parameter (secondary source)
  if (input && !placeholders.includes(input) && args.type === 'image') {
    if (input.length > 100) {
      console.log(`✓ Valid base64 image data in input (${input.length} chars)`);
      return {
        type: 'base64',
        data: input,
        source: 'input'
      };
    }
    
    if (imageIdPattern.test(input)) {
      console.log(`⚠️ Image ID detected in input: ${input}`);
      return {
        type: 'image_id',
        id: input,
        fallbackFood: food_suggestion || food_name,
        source: 'input'
      };
    }
  }
  
  // Check other image parameters
  if (image && image.length > 100) {
    console.log(`✓ Valid base64 image data in image parameter (${image.length} chars)`);
    return {
      type: 'base64',
      data: image,
      source: 'image'
    };
  }
  
  if (image_url && (image_url.startsWith('http://') || image_url.startsWith('https://'))) {
    console.log(`✓ Valid image URL: ${image_url}`);
    return {
      type: 'url',
      data: image_url,
      source: 'image_url'
    };
  }
  
  // No valid image data found
  console.log('❌ No valid image data found in request');
  console.log('Parameters received:', {
    puch_image_data: puch_image_data ? `${puch_image_data.substring(0, 20)}... (${puch_image_data.length} chars)` : 'none',
    input: input ? `${input.substring(0, 20)}... (${input.length} chars)` : 'none',
    image: image ? `${image.substring(0, 20)}... (${image.length} chars)` : 'none',
    image_url: image_url || 'none',
    food_suggestion: food_suggestion || 'none',
    food_name: food_name || 'none'
  });
  
  return {
    type: 'missing',
    fallbackFood: food_suggestion || food_name,
    debugInfo: {
      puch_image_data_length: puch_image_data?.length || 0,
      input_length: input?.length || 0,
      has_food_suggestion: !!food_suggestion,
      has_food_name: !!food_name
    }
  };
}

/**
 * Generate appropriate response for different image data scenarios
 */
function generateImageResponse(imageResult, args) {
  const { food_suggestion, food_name } = args;
  const fallbackFood = food_suggestion || food_name;
  
  switch (imageResult.type) {
    case 'base64':
      // We have valid image data - no special response needed
      return null;
      
    case 'url':
      // We have a URL - no special response needed
      return null;
      
    case 'image_id':
      // We received an image ID instead of actual data
      if (fallbackFood) {
        return {
          needsFallback: true,
          message: `I received an image reference (${imageResult.id}) but not the actual image data. However, I can see you're trying to scan "${fallbackFood}". Let me analyze that for you!`,
          fallbackFood: fallbackFood
        };
      }
      
      return {
        needsTextInput: true,
        message: `🔍 IMAGE ANALYSIS PENDING

I received an image reference (${imageResult.id}) but not the actual image data. To analyze your food properly, please:

📝 Tell me what you ate (e.g., "2 chapati with dal")
   OR
📸 Try uploading the image again

What food would you like me to analyze?`
      };
      
    case 'missing':
      // No image data at all
      if (fallbackFood) {
        return {
          needsFallback: true,
          message: `I couldn't receive the image data, but I see you're trying to scan "${fallbackFood}". Let me analyze that for you!`,
          fallbackFood: fallbackFood
        };
      }
      
      const debugMsg = process.env.NODE_ENV === 'development' 
        ? `\n\nDebug info: ${JSON.stringify(imageResult.debugInfo, null, 2)}`
        : '';
      
      return {
        needsTextInput: true,
        message: `📸 IMAGE NOT RECEIVED

I didn't receive any image data to analyze. Please:

📝 Tell me what you ate (e.g., "1 bowl of bhujia")
   OR
📸 Try uploading the image again

What food would you like me to analyze?${debugMsg}`
      };
      
    default:
      return null;
  }
}

/**
 * Process image data for vision analysis
 */
function prepareImageForAnalysis(imageResult) {
  if (imageResult.type === 'base64') {
    // Strip data URI prefix if present
    let cleanBase64 = imageResult.data;
    if (cleanBase64.includes('data:image')) {
      cleanBase64 = cleanBase64.split(',')[1];
    }
    return cleanBase64;
  }
  
  if (imageResult.type === 'url') {
    return imageResult.data;
  }
  
  return null;
}

/**
 * Validate base64 image format
 */
function isValidBase64Image(str) {
  if (!str || str.length < 100) return false;
  
  // Check for data URI
  if (str.startsWith('data:image')) {
    const parts = str.split(',');
    if (parts.length !== 2) return false;
    str = parts[1];
  }
  
  // Basic base64 validation
  const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
  return base64Regex.test(str);
}

module.exports = {
  extractPuchImageData,
  generateImageResponse,
  prepareImageForAnalysis,
  isValidBase64Image
};