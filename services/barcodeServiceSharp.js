const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = require('@zxing/library');

// Try to load sharp, but don't fail if it's not available
let sharp;
try {
  sharp = require('sharp');
} catch (error) {
  console.log('Sharp not available, barcode scanning will be limited');
}

class BarcodeServiceSharp {
  constructor() {
    this.reader = new MultiFormatReader();
    
    // Configure reader for better detection
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    this.reader.setHints(hints);
  }

  /**
   * Scan barcode from image file using sharp
   */
  async scanFromFile(imagePath) {
    if (!sharp) {
      console.log('Sharp not available for barcode scanning');
      return null;
    }
    
    try {
      console.log(`Scanning barcode from: ${imagePath}`);
      
      // Read image with sharp
      const image = sharp(imagePath);
      const metadata = await image.metadata();
      
      // Try different preprocessing techniques
      const results = [];
      
      // 1. Try original
      const result1 = await this.tryDecodeSharp(image.clone(), metadata);
      if (result1) results.push(result1);
      
      // 2. Try with contrast enhancement
      const result2 = await this.tryDecodeSharp(
        image.clone().normalise().linear(1.5, -(128 * 1.5) + 128),
        metadata
      );
      if (result2) results.push(result2);
      
      // 3. Try grayscale
      const result3 = await this.tryDecodeSharp(
        image.clone().grayscale(),
        metadata
      );
      if (result3) results.push(result3);
      
      // 4. Try with threshold
      const result4 = await this.tryDecodeSharp(
        image.clone().threshold(128),
        metadata
      );
      if (result4) results.push(result4);
      
      if (results.length > 0) {
        console.log(`✅ Barcode detected: ${results[0]}`);
        return results[0];
      }
      
      console.log('❌ No barcode detected');
      return null;
      
    } catch (error) {
      console.error('Error scanning barcode:', error.message);
      return null;
    }
  }

  /**
   * Scan barcode from base64
   */
  async scanFromBase64(base64Image) {
    if (!sharp) {
      console.log('Sharp not available for barcode scanning');
      return null;
    }
    
    try {
      // Strip data URI prefix if present
      let cleanBase64 = base64Image;
      if (base64Image.includes('data:image')) {
        cleanBase64 = base64Image.split(',')[1];
      }
      
      const buffer = Buffer.from(cleanBase64, 'base64');
      const image = sharp(buffer);
      const metadata = await image.metadata();
      
      const result = await this.tryDecodeSharp(image, metadata);
      
      if (result) {
        console.log(`✅ Barcode detected from base64: ${result}`);
        return result;
      }
      
      return null;
    } catch (error) {
      console.error('Error scanning from base64:', error.message);
      return null;
    }
  }

  /**
   * Try to decode barcode from sharp image
   */
  async tryDecodeSharp(sharpImage, metadata) {
    try {
      // Get raw pixel data
      const { data, info } = await sharpImage
        .raw()
        .toBuffer({ resolveWithObject: true });
      
      // Convert to Uint8ClampedArray for ZXing
      const uint8Array = new Uint8ClampedArray(data);
      
      // Create luminance source
      const luminanceSource = new RGBLuminanceSource(
        uint8Array,
        info.width,
        info.height
      );
      
      const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
      
      // Try to decode
      const result = this.reader.decode(binaryBitmap);
      
      if (result) {
        return result.getText();
      }
      
      return null;
    } catch (error) {
      // Decoding failed
      return null;
    }
  }

  /**
   * Validate barcode format
   */
  validateBarcode(barcode) {
    if (!barcode || typeof barcode !== 'string') {
      return { valid: false, error: 'Invalid barcode' };
    }

    const cleaned = barcode.replace(/[^0-9]/g, '');
    
    if (cleaned.length === 13) {
      return { valid: true, type: 'EAN-13', barcode: cleaned };
    } else if (cleaned.length === 12) {
      return { valid: true, type: 'UPC-A', barcode: cleaned };
    } else if (cleaned.length === 8) {
      return { valid: true, type: 'EAN-8', barcode: cleaned };
    } else if (cleaned.length >= 8 && cleaned.length <= 14) {
      return { valid: true, type: 'GENERIC', barcode: cleaned };
    }
    
    return { valid: false, error: 'Invalid barcode length' };
  }

  /**
   * Get barcode region info
   */
  getBarcodeRegion(barcode) {
    if (barcode.length !== 13) return { region: 'Unknown' };
    
    const prefix = barcode.substring(0, 3);
    
    // Check if it's Indian barcode
    if (prefix === '890') {
      return { 
        region: 'India',
        country: 'IN',
        info: 'Indian product - may need local database lookup'
      };
    }
    
    // Other common regions
    const regions = {
      '000-019': 'USA & Canada',
      '300-379': 'France',
      '400-440': 'Germany',
      '450-459': 'Japan',
      '460-469': 'Russia',
      '489': 'Hong Kong',
      '690-699': 'China',
      '729': 'Israel',
      '750': 'Mexico',
      '890': 'India',
      '899': 'Indonesia',
      '955': 'Malaysia'
    };
    
    for (const [range, region] of Object.entries(regions)) {
      if (range.includes('-')) {
        const [start, end] = range.split('-');
        if (parseInt(prefix) >= parseInt(start) && parseInt(prefix) <= parseInt(end)) {
          return { region, country: region };
        }
      } else if (prefix === range) {
        return { region, country: region };
      }
    }
    
    return { region: 'Unknown', country: '??' };
  }
}

module.exports = new BarcodeServiceSharp();