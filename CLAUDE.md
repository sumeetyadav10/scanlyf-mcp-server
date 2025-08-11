# Scanlyf MCP Server - Complete Implementation Guide

## 🚀 Project Overview
Scanlyf is an enterprise-grade AI-powered nutrition tracking MCP (Model Context Protocol) server that integrates with Puch AI. It helps users track their food intake through multiple input methods, provides personalized health insights, and exposes harmful ingredients in packaged foods.

## 🆕 Latest Updates (August 2025)
- **scan_and_add_food**: New combined tool that scans and logs food in one call
- **list_today_foods**: View all foods eaten today with detailed nutrition info
- **remove_food**: Remove specific items from daily log
- **Improved Puch AI Integration**: Better handling of image IDs and food suggestions
- **Clearer Response Formatting**: Distinguishes between targets vs consumed amounts

## 🏗️ Architecture

### Core Server
- **Main Server**: `server.js` - Standard security with JWT authentication and rate limiting
- **Protocol**: MCP (Model Context Protocol) with JSON-RPC 2.0
- **Port**: 3000
- **Authentication**: JWT Bearer tokens

### Tech Stack
- **Backend**: Node.js + Express
- **Database**: Firebase Firestore
- **APIs**: 
  - Google Vision API (food image recognition)
  - Nutritionix API (nutrition data)
  - OpenFoodFacts API (barcode products)
  - OpenAI GPT-4 (personalization)
- **Barcode Scanning**: ZXing library with Sharp (NOT Google Vision)
- **Security**: JWT authentication, rate limiting, input validation
- **Caching**: Redis (with in-memory fallback)

## 📍 API Endpoints

### 1. Health Check
```
GET /
Response: {
  "status": "ok",
  "service": "Scanlyf MCP Server",
  "version": "2.0.0",
  "security": "standard"
}
```

### 2. Main MCP Endpoint
```
POST /mcp
Headers: 
  - Authorization: Bearer <token>
  - Content-Type: application/json

Methods:
  - initialize
  - tools/list
  - tools/call
```

## 🛠️ Available Tools (via tools/call)

### 1. validate
Validates bearer token and returns phone number
```json
{
  "name": "validate",
  "arguments": {
    "bearer_token": "string"
  }
}
```
**Implementation**: `handleValidate()` in `server.js`

### 2. setup_profile
Creates/updates user profile with health information
```json
{
  "name": "setup_profile",
  "arguments": {
    "bearer_token": "string",
    "age": "number",
    "weight": "number",
    "height": "number",
    "gender": "string",
    "activity_level": "string",
    "dietary_restrictions": ["array"],
    "health_goals": ["array"],
    "health_conditions": ["array"]
  }
}
```
**Implementation**: `handleSetupProfile()` → `userService.js`

### 3. scan_food
Scans food via image or barcode (DOES NOT LOG)
```json
{
  "name": "scan_food",
  "arguments": {
    "bearer_token": "string",
    "input": "base64_image_or_url",
    "type": "image",
    "barcode": "string (optional)",
    "puch_image_data": "string (base64 from Puch AI)",
    "food_suggestion": "string (if Puch AI detected food)"
  }
}
```
**Implementation**: 
- `handleScanFood()` → `enhancedFoodAnalysisService.js`
- Image: `visionService.js` (Google Vision) + `enhancedVisionService.js` (OpenAI fallback)
- Barcode: `barcodeServiceSharp.js` (ZXing + Sharp)
- **Note**: Only analyzes, does NOT log to daily intake

### 4. scan_and_add_food (NEW - RECOMMENDED)
Combines scanning and logging in one call
```json
{
  "name": "scan_and_add_food",
  "arguments": {
    "bearer_token": "string",
    "input": "base64_image or text",
    "puch_image_data": "string (base64 from Puch AI)",
    "type": "image|text",
    "food_name": "string (if Puch AI detected it)",
    "auto_add": "boolean (default: true)"
  }
}
```
**Implementation**: `handleScanAndAddFood()` - Automatically logs food after analysis

### 5. add_food
Logs food to daily intake
```json
{
  "name": "add_food",
  "arguments": {
    "bearer_token": "string",
    "text": "string (for text input)",
    "input": "base64_image (for image)",
    "puch_image_data": "string (base64 from Puch AI)",
    "type": "text|image",
    "confirmed": "boolean",
    "quick_add": "boolean (optional - to quickly add previously scanned food)"
  }
}
```
**Implementation**: `handleAddFood()` → `foodService.js` (Nutritionix API)

### 6. list_today_foods (NEW)
Lists all foods eaten today with detailed nutrition
```json
{
  "name": "list_today_foods",
  "arguments": {
    "bearer_token": "string"
  }
}
```
**Implementation**: `handleListTodayFoods()` - Shows each food with calories, macros, time added

### 7. remove_food (NEW)
Removes a food item from today's log
```json
{
  "name": "remove_food",
  "arguments": {
    "bearer_token": "string",
    "food_index": "number (1-based index from list)",
    "food_name": "string (alternative to index)"
  }
}
```
**Implementation**: `handleRemoveFood()` - Removes item and updates totals

### 8. get_progress
Gets daily nutrition progress vs targets
```json
{
  "name": "get_progress",
  "arguments": {
    "bearer_token": "string",
    "date": "string (YYYY-MM-DD, optional)"
  }
}
```
**Implementation**: `handleGetProgress()` → Firebase queries

### 9. get_weekly_analysis
Gets AI-powered weekly analysis with multi-agent insights
```json
{
  "name": "get_weekly_analysis",
  "arguments": {
    "bearer_token": "string"
  }
}
```
**Implementation**: `handleGetWeeklyAnalysis()` → `weeklyAnalysisCrew.js` (5 AI agents)

### 10. export_data
Exports nutrition data in various formats
```json
{
  "name": "export_data",
  "arguments": {
    "bearer_token": "string",
    "format": "csv|pdf|excel",
    "date_range": "week|month|all"
  }
}
```
**Implementation**: `handleExportData()` → `exportService.js`

### 11. Other Tools
- `get_leaderboard` - Gamification leaderboard
- `check_balance` - ScanlyfCoins balance
- `view_rewards` - Available rewards
- `generate_meal_plan` - AI meal planning
- `get_personalization` - User insights
- `configure_webhook` - Webhook setup

## 📁 Core Service Files

### Vision & Image Processing
- **`services/visionService.js`** - Google Vision API integration
  - `detectFoodFromBase64()` - Analyzes food images
  - `detectFoodFromImage()` - URL-based detection
  - Uses labels, web detection, and text detection

- **`services/enhancedVisionService.js`** - Enhanced food detection with OpenAI fallback
  - `analyzeImageWithAI()` - Multi-source analysis
  - Falls back to GPT-4 Vision if Google Vision fails

- **`services/barcodeServiceSharp.js`** - ZXing barcode scanning with Sharp
  - `scanFromFile()` - Scans barcode from image file
  - `scanFromBase64()` - Scans from base64 image
  - Uses ZXing library (NOT Google Vision for barcodes)

### Food Analysis
- **`services/enhancedFoodAnalysisService.js`** - Main food analysis orchestrator
  - `analyzeFood()` - Routes to appropriate handler
  - `analyzeFromBarcode()` - OpenFoodFacts lookup
  - `analyzeFromImageEnhanced()` - First checks for barcode, then food
  - `analyzeFromText()` - Natural language parsing

- **`services/foodService.js`** - Nutritionix API integration
  - `searchNutritionix()` - Gets nutrition data
  - `parsePortionSize()` - Handles portions
  - Caches results for performance

- **`services/ingredientAnalyzer.js`** - Harmful ingredient detection
  - 200+ toxic additives database
  - `analyzeIngredients()` - Checks for harmful substances
  - Personalized risk assessment based on health conditions

### Health & Personalization
- **`services/healthAnalysisService.js`** - Health condition-based analysis
  - OpenAI integration for personalized advice
  - Condition-specific recommendations

- **`services/healthRiskDetector.js`** - Real-time health risk alerts
  - `detectRisks()` - Immediate danger detection
  - Allergy, pregnancy, medication checks

- **`services/personalizationEngine.js`** - User behavior tracking
  - Personality types (Warrior, Scholar, Nurturer, Pragmatist)
  - `trackBehavior()` - Pattern analysis
  - `getPredictiveNudges()` - Behavioral predictions

- **`services/weeklyAnalysisCrew.js`** - Multi-agent AI analysis
  - 5 specialized agents:
    - Dr. Nutrition (dietary patterns)
    - BehaviorBot (psychological patterns)
    - Coach Wellness (actionable strategies)
    - DataMind (hidden correlations)
    - Dr. CleanEats (toxin exposure)

### User & Data Management
- **`services/userService.js`** - User profile management
  - `createOrUpdateProfile()` - Profile CRUD
  - `calculateDailyTargets()` - Personalized goals

- **`services/rewardsService.js`** - Gamification system
  - ScanlyfCoins management
  - Achievement tracking

- **`services/exportService.js`** - Data export
  - CSV: `@json2csv/plainjs`
  - PDF: `pdfkit`
  - Excel: `exceljs`

- **`services/webhookService.js`** - Webhook notifications
  - Event-based notifications
  - Configurable endpoints

### Security
- **`lib/simple-security.js`** - Standard security middleware
  - JWT token validation and generation
  - Rate limiting for expensive operations (food scans, weekly analysis)
  - Basic input validation
  - Security headers
  - CORS configuration

- **`lib/errorHandler.js`** - Centralized error handling
  - Structured error responses
  - Security error masking

### Infrastructure
- **`lib/firebase.js`** - Firebase initialization
  - Firestore database connection
  - Environment-based configuration

- **`lib/cacheService.js`** - Caching layer
  - Redis primary (if available)
  - In-memory fallback
  - TTL management

- **`handlers/enhancedFoodHandlers.js`** - Request handlers
  - All tool implementations
  - Response formatting

## 🔧 Puch AI Integration

### Known Issues & Solutions

#### Image Processing
- **Issue**: Puch AI sends image IDs (e.g., 'OFo4pPqa') instead of base64 data
- **Solution**: 
  - Server detects short strings (<20 chars) as image IDs
  - Returns helpful fallback message
  - Accepts `food_name` parameter if Puch AI detected the food
  - Use `scan_and_add_food` with `food_name` parameter

#### scan_food vs add_food Confusion
- **Issue**: Puch AI says "I've logged it" after scan_food (which doesn't log)
- **Solution**: 
  - Use `scan_and_add_food` for one-step process
  - Clearly documented that scan_food only analyzes
  - Response messages explicitly state if food was logged or not

#### Daily Targets vs Consumed
- **Issue**: Confusion between daily targets and actual intake
- **Solution**: 
  - Responses now clearly show:
    - "Target: X calories"
    - "Consumed: Y calories"
    - "Remaining: Z calories"

## 🔄 Data Flow

### Food Image Scanning Flow
```
1. User uploads image → Base64 encoding
2. barcodeServiceSharp checks if it's a barcode
   - If barcode: ZXing extracts number → OpenFoodFacts lookup
   - If not: Continue to food detection
3. Google Vision API analyzes food
4. Nutritionix API gets nutrition data
5. Ingredient analyzer checks harmful substances
6. Health risk detector evaluates dangers
7. Response formatted with warnings and quick-add ID
```

### Barcode Scanning Flow
```
1. Image → Sharp preprocessing (contrast, grayscale, etc.)
2. ZXing MultiFormatReader decodes barcode
3. Validate barcode format (EAN-13, UPC-A, etc.)
4. Check region (890 = India)
5. OpenFoodFacts API lookup
6. If not found: Return region-specific message
7. Ingredient analysis for harmful additives
```

### Text Food Entry Flow
```
1. Natural language input
2. Parse portion sizes and quantities
3. Nutritionix API search
4. Nutrition calculation
5. Health analysis based on user profile
```

## 🔐 Security Layers

1. **Request Validation**
   - JSON-RPC format validation
   - Input sanitization
   - Size limits (10MB for images)

2. **Authentication**
   - JWT Bearer token validation
   - Token expiry checks
   - User context injection

3. **Rate Limiting**
   - General API rate limiting (100 requests/minute)
   - Food scan limiting (20 scans/minute)
   - Weekly analysis limiting (5 analyses/hour)

## 📊 Database Schema

### Firebase Collections
```
users/{phone}
  - profile (name, age, weight, height, etc.)
  - daily_targets (calories, protein, etc.)
  - preferences (dietary, goals)

daily_logs/{id}
  - phone, date, foods[], totals
  - foods[] contains:
    - name, calories, protein, carbs, fat
    - emoji (food icon)
    - timestamp (when added)
    - portion_size (optional)

user_personalities/{phone}
  - personalityType, behaviorPatterns

weekly_analyses/{id}
  - phone, weekStart, analysis, recommendations

meal_plans/{id}
  - phone, duration, meals[]

webhooks/{phone}
  - url, events[], active
```

## 🚀 Deployment

### Environment Variables
```bash
# Firebase (from service account JSON)
FIREBASE_PROJECT_ID=
FIREBASE_PRIVATE_KEY=
FIREBASE_CLIENT_EMAIL=
# ... other Firebase vars

# Google Cloud Vision (from service account JSON)
GOOGLE_CLOUD_PROJECT_ID=
GOOGLE_CLOUD_PRIVATE_KEY=
GOOGLE_CLOUD_CLIENT_EMAIL=
# ... other Google Cloud vars

# API Keys
NUTRITIONIX_APP_ID=
NUTRITIONIX_APP_KEY=
OPENAI_API_KEY=

# Security
JWT_SECRET=
```

### Production Deployment
The server can be deployed to any Node.js hosting platform (Railway, Render, Heroku, etc.) that supports Express applications. Ensure all environment variables are properly configured on your hosting platform.

## 💡 Recommended Usage Patterns

### For Puch AI Integration
1. **Food Tracking with Images**:
   - When user uploads image and Puch AI detects food (e.g., "paneer tikka")
   - Call `scan_and_add_food` with `food_name: "paneer tikka"`
   - This logs it automatically

2. **Viewing Daily Intake**:
   - Use `list_today_foods` to show detailed food list
   - Use `get_progress` to show progress vs targets

3. **Removing Items**:
   - First call `list_today_foods` to show numbered list
   - Then use `remove_food` with the item number

### Response Format Examples
```
After adding food:
✅ LOGGED SUCCESSFULLY!
━━━━━━━━━━━━━━━━━━━━━━━━
📈 Today's Progress:
• Consumed: 600 calories
• Target: 2958 calories
• Remaining: 2358 calories
```

## 📈 Performance Notes

- **Caching**: All API responses cached to reduce costs
- **Image Processing**: Sharp for efficient image manipulation
- **Barcode Detection**: Multiple preprocessing attempts for accuracy
- **Database**: Firestore with proper indexing
- **Response Times**: <2s for images, <500ms for text

---

*Last Updated: December 2024*