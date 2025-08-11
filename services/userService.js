const { getDb, collections } = require('../lib/firebase');
const { calculateDailyTargets } = require('../lib/nutrition');

class UserService {
  async createOrUpdateProfile(phone, profileData) {
    const db = getDb();
    const userRef = db.collection(collections.users).doc(phone);
    
    // Calculate nutrition targets
    const targets = calculateDailyTargets(profileData);
    
    const userData = {
      ...profileData,
      phone,
      calorie_target: targets.calories,
      protein_target: targets.protein,
      carb_target: targets.carbs,
      fat_target: targets.fat,
      health_conditions: profileData.health_conditions || [],
      updated_at: new Date().toISOString()
    };
    
    await userRef.set(userData, { merge: true });
    
    return userData;
  }
  
  async getProfile(phone) {
    const db = getDb();
    const userDoc = await db.collection(collections.users).doc(phone).get();
    
    if (!userDoc.exists) {
      return null;
    }
    
    return userDoc.data();
  }
  
  async validateToken(bearerToken) {
    const db = getDb();
    
    // Query tokens collection
    const tokenSnapshot = await db.collection(collections.tokens)
      .where('token', '==', bearerToken)
      .where('active', '==', true)
      .limit(1)
      .get();
    
    if (tokenSnapshot.empty) {
      // For MVP, create a default token mapping
      // In production, this should validate against your auth system
      if (bearerToken === 'demo_token') {
        return (process.env.TEST_PHONE || 'demo_user').replace(/^\+/, '');
      }
      return null;
    }
    
    const tokenData = tokenSnapshot.docs[0].data();
    return tokenData.phone;
  }
  
  async createToken(phone, token) {
    const db = getDb();
    const tokenRef = db.collection(collections.tokens).doc();
    
    await tokenRef.set({
      phone,
      token,
      active: true,
      created_at: new Date().toISOString()
    });
    
    return tokenRef.id;
  }
}

module.exports = new UserService();