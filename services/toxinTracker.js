const { getDb, collections } = require('../lib/firebase');

class ToxinTracker {
  constructor() {
    this.achievements = {
      firstCleanScan: {
        id: 'first_clean',
        name: '🌱 Clean Start',
        description: 'Scanned your first toxin-free food',
        coins: 25
      },
      toxinDetector: {
        id: 'toxin_detector',
        name: '🔍 Toxin Detector',
        description: 'Learned about 10 harmful ingredients',
        coins: 50
      },
      cleanStreak3: {
        id: 'clean_streak_3',
        name: '🔥 Clean Streak x3',
        description: '3 clean foods in a row',
        coins: 30
      },
      cleanStreak5: {
        id: 'clean_streak_5',
        name: '🔥 Clean Streak x5',
        description: '5 clean foods in a row',
        coins: 50
      },
      cleanStreak10: {
        id: 'clean_streak_10',
        name: '🔥 Clean Champion',
        description: '10 clean foods in a row',
        coins: 100
      },
      ingredientExpert: {
        id: 'ingredient_expert',
        name: '🎓 Ingredient Expert',
        description: 'Identified 25 different harmful ingredients',
        coins: 75
      },
      cleanDay: {
        id: 'clean_day',
        name: '☀️ Clean Day',
        description: '100% clean foods for an entire day',
        coins: 100
      },
      swapMaster: {
        id: 'swap_master',
        name: '🔄 Swap Master',
        description: 'Chose clean alternatives 10 times',
        coins: 50
      }
    };
  }

  // Track a food scan
  async trackScan(phone, scanResult) {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // Get or create user's toxin tracking data
      const trackingRef = db.collection(collections.TOXIN_TRACKING).doc(phone);
      const trackingDoc = await trackingRef.get();
      
      let trackingData = trackingDoc.exists ? trackingDoc.data() : this.initializeTracking();
      
      // Update daily stats
      if (trackingData.lastScanDate !== today) {
        // New day - reset daily stats
        trackingData.dailyStats = {
          date: today,
          totalScans: 0,
          cleanScans: 0,
          toxicScans: 0,
          ingredientsFound: []
        };
        trackingData.lastScanDate = today;
      }
      
      // Update scan counts
      trackingData.dailyStats.totalScans++;
      trackingData.lifetime.totalScans++;
      
      const isClean = !scanResult.harmfulIngredients || scanResult.harmfulIngredients.length === 0;
      
      if (isClean) {
        trackingData.dailyStats.cleanScans++;
        trackingData.lifetime.cleanScans++;
        trackingData.currentStreak++;
        trackingData.bestStreak = Math.max(trackingData.bestStreak, trackingData.currentStreak);
      } else {
        trackingData.dailyStats.toxicScans++;
        trackingData.lifetime.toxicScans++;
        trackingData.currentStreak = 0;
        
        // Track harmful ingredients
        scanResult.harmfulIngredients.forEach(ing => {
          trackingData.dailyStats.ingredientsFound.push(ing.name);
          if (!trackingData.lifetime.knownIngredients[ing.name]) {
            trackingData.lifetime.knownIngredients[ing.name] = 0;
          }
          trackingData.lifetime.knownIngredients[ing.name]++;
        });
      }
      
      // Check for achievements
      const newAchievements = await this.checkAchievements(trackingData, phone);
      
      // Save updated tracking data
      await trackingRef.set(trackingData);
      
      // Return tracking info for the response
      return {
        todayScans: trackingData.dailyStats.totalScans,
        cleanScans: trackingData.dailyStats.cleanScans,
        toxicScans: trackingData.dailyStats.toxicScans,
        cleanStreak: trackingData.currentStreak,
        newAchievements,
        trackingData
      };
      
    } catch (error) {
      console.error('Error tracking scan:', error);
      return {
        todayScans: 0,
        cleanScans: 0,
        toxicScans: 0,
        cleanStreak: 0,
        newAchievements: []
      };
    }
  }

  // Initialize tracking data for new user
  initializeTracking() {
    return {
      lifetime: {
        totalScans: 0,
        cleanScans: 0,
        toxicScans: 0,
        knownIngredients: {},
        achievements: []
      },
      dailyStats: {
        date: new Date().toISOString().split('T')[0],
        totalScans: 0,
        cleanScans: 0,
        toxicScans: 0,
        ingredientsFound: []
      },
      currentStreak: 0,
      bestStreak: 0,
      lastScanDate: new Date().toISOString().split('T')[0]
    };
  }

  // Check for new achievements
  async checkAchievements(trackingData, phone) {
    const newAchievements = [];
    const earnedAchievements = trackingData.lifetime.achievements || [];
    
    // First clean scan
    if (trackingData.lifetime.cleanScans === 1 && !earnedAchievements.includes('first_clean')) {
      newAchievements.push(this.achievements.firstCleanScan);
      await this.awardAchievement(phone, this.achievements.firstCleanScan);
    }
    
    // Clean streaks
    if (trackingData.currentStreak === 3 && !earnedAchievements.includes('clean_streak_3')) {
      newAchievements.push(this.achievements.cleanStreak3);
      await this.awardAchievement(phone, this.achievements.cleanStreak3);
    }
    
    if (trackingData.currentStreak === 5 && !earnedAchievements.includes('clean_streak_5')) {
      newAchievements.push(this.achievements.cleanStreak5);
      await this.awardAchievement(phone, this.achievements.cleanStreak5);
    }
    
    if (trackingData.currentStreak === 10 && !earnedAchievements.includes('clean_streak_10')) {
      newAchievements.push(this.achievements.cleanStreak10);
      await this.awardAchievement(phone, this.achievements.cleanStreak10);
    }
    
    // Toxin detector - learned about 10 ingredients
    const knownIngredientsCount = Object.keys(trackingData.lifetime.knownIngredients).length;
    if (knownIngredientsCount >= 10 && !earnedAchievements.includes('toxin_detector')) {
      newAchievements.push(this.achievements.toxinDetector);
      await this.awardAchievement(phone, this.achievements.toxinDetector);
    }
    
    // Ingredient expert - 25 ingredients
    if (knownIngredientsCount >= 25 && !earnedAchievements.includes('ingredient_expert')) {
      newAchievements.push(this.achievements.ingredientExpert);
      await this.awardAchievement(phone, this.achievements.ingredientExpert);
    }
    
    // Clean day - 100% clean foods
    if (trackingData.dailyStats.totalScans >= 3 && 
        trackingData.dailyStats.toxicScans === 0 && 
        !earnedAchievements.includes('clean_day')) {
      newAchievements.push(this.achievements.cleanDay);
      await this.awardAchievement(phone, this.achievements.cleanDay);
    }
    
    return newAchievements;
  }

  // Award achievement and coins
  async awardAchievement(phone, achievement) {
    const db = getDb();
    
    try {
      // Update tracking data with achievement
      const trackingRef = db.collection(collections.TOXIN_TRACKING).doc(phone);
      await trackingRef.update({
        'lifetime.achievements': db.FieldValue.arrayUnion(achievement.id)
      });
      
      // Award coins
      const rewardsService = require('./rewardsService');
      await rewardsService.awardCoins(phone, achievement.coins, `Achievement: ${achievement.name}`);
      
      console.log(`🏆 Achievement unlocked for ${phone}: ${achievement.name}`);
    } catch (error) {
      console.error('Error awarding achievement:', error);
    }
  }

  // Get user's toxin tracking stats
  async getUserStats(phone) {
    const db = getDb();
    
    try {
      const trackingDoc = await db.collection(collections.TOXIN_TRACKING).doc(phone).get();
      
      if (!trackingDoc.exists) {
        return this.initializeTracking();
      }
      
      return trackingDoc.data();
    } catch (error) {
      console.error('Error getting user stats:', error);
      return this.initializeTracking();
    }
  }

  // Get daily summary
  async getDailySummary(phone) {
    const stats = await this.getUserStats(phone);
    const { dailyStats, lifetime } = stats;
    
    // Get worst ingredients of the day
    const ingredientCounts = {};
    dailyStats.ingredientsFound.forEach(ing => {
      ingredientCounts[ing] = (ingredientCounts[ing] || 0) + 1;
    });
    
    const worstIngredients = Object.entries(ingredientCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
    
    return {
      totalScans: dailyStats.totalScans,
      cleanScans: dailyStats.cleanScans,
      toxicScans: dailyStats.toxicScans,
      worstIngredients,
      currentStreak: stats.currentStreak,
      bestStreak: stats.bestStreak,
      lifetimeStats: {
        totalScans: lifetime.totalScans,
        cleanScans: lifetime.cleanScans,
        knownIngredients: Object.keys(lifetime.knownIngredients).length
      }
    };
  }

  // Get leaderboard for clean streaks
  async getCleanStreakLeaderboard(limit = 10) {
    const db = getDb();
    
    try {
      const snapshot = await db.collection(collections.TOXIN_TRACKING)
        .orderBy('currentStreak', 'desc')
        .limit(limit)
        .get();
      
      const leaderboard = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        leaderboard.push({
          phone: doc.id.slice(-4), // Last 4 digits only
          currentStreak: data.currentStreak,
          bestStreak: data.bestStreak,
          cleanPercentage: data.lifetime.totalScans > 0 
            ? Math.round((data.lifetime.cleanScans / data.lifetime.totalScans) * 100)
            : 0
        });
      });
      
      return leaderboard;
    } catch (error) {
      console.error('Error getting leaderboard:', error);
      return [];
    }
  }
}

module.exports = new ToxinTracker();