const { getDb, collections, admin } = require('../lib/firebase');
const { getTodayIST, convertToISTDate } = require('../lib/dateHelper');

class RewardsService {
  constructor() {
    this.COIN_REWARDS = {
      WEEKLY_CHAMPION: 100,
      WEEKLY_ELITE: 50,
      WEEKLY_ACHIEVER: 20
    };

    this.ACHIEVEMENT_BADGES = {
      FIRST_WEEK: '🌱 First Week Hero',
      PROTEIN_MASTER: '💪 Protein Master',
      BALANCED_WARRIOR: '🥗 Balanced Warrior', 
      STREAK_LEGEND: '🔥 Streak Legend',
      NUTRITION_CHAMPION: '👑 Nutrition Champion'
    };

    this.REWARDS_CATALOG = [
      { id: 'netflix_premium', name: 'Netflix Premium 1 month', cost: 500 }
    ];
  }

  async calculateWeeklyProgress(phone) {
    const db = getDb();
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday
    
    const dailyScores = [];
    let totalScore = 0;
    let daysTracked = 0;

    // Get daily progress for current week
    for (let i = 0; i < 7; i++) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + i);
      
      if (date > today) {
        dailyScores.push(0);
        continue;
      }

      // Convert to IST date string to match stored data format
      const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
      const dateStr = istDate.toISOString().split('T')[0];
      const progress = await this.getDailyCompletionPercentage(phone, dateStr);
      
      dailyScores.push(progress);
      if (progress > 0) {
        totalScore += progress;
        daysTracked++;
      }
    }

    const average = daysTracked > 0 ? totalScore / daysTracked : 0;

    return {
      dailyScores,
      average: Math.round(average * 10) / 10,
      daysTracked,
      daysRemaining: 7 - today.getDay()
    };
  }

  async getDailyCompletionPercentage(phone, date) {
    const db = getDb();
    const docId = `${phone}_${date}`;
    
    // Get user profile for targets
    const userDoc = await db.collection(collections.users).doc(phone).get();
    if (!userDoc.exists) return 0;
    
    const profile = userDoc.data();
    const targets = {
      calories: profile.calorie_target,
      protein: profile.protein_target,
      carbs: profile.carb_target,
      fat: profile.fat_target
    };

    // Get daily log
    const logDoc = await db.collection(collections.dailyLogs).doc(docId).get();
    if (!logDoc.exists) return 0;
    
    const log = logDoc.data();
    const totals = log.totals;

    // Calculate percentage for each macro
    const caloriePerc = Math.min(100, (totals.calories / targets.calories) * 100);
    const proteinPerc = Math.min(100, (totals.protein / targets.protein) * 100);
    const carbPerc = Math.min(100, (totals.carbs / targets.carbs) * 100);
    const fatPerc = Math.min(100, (totals.fat / targets.fat) * 100);

    // Average of all macros
    const average = (caloriePerc + proteinPerc + carbPerc + fatPerc) / 4;
    
    return Math.round(average);
  }

  async getWeeklyLeaderboard() {
    const db = getDb();
    const currentWeek = this.getCurrentWeekId();
    
    // Get all users
    const usersSnapshot = await db.collection(collections.users).get();
    const leaderboard = [];

    // Calculate weekly average for each user
    for (const userDoc of usersSnapshot.docs) {
      const phone = userDoc.id;
      const userData = userDoc.data();
      const progress = await this.calculateWeeklyProgress(phone);
      
      if (progress.daysTracked > 0) {
        leaderboard.push({
          phone,
          name: userData.name,
          average: progress.average,
          daysTracked: progress.daysTracked
        });
      }
    }

    // Sort by average (descending)
    leaderboard.sort((a, b) => b.average - a.average);

    // Add ranks
    leaderboard.forEach((user, index) => {
      user.rank = index + 1;
    });

    return leaderboard;
  }

  async distributeWeeklyRewards() {
    const db = getDb();
    const leaderboard = await this.getWeeklyLeaderboard();
    const weekId = this.getCurrentWeekId();
    
    // Check if rewards already distributed
    const weekDoc = await db.collection('weekly_challenges').doc(weekId).get();
    if (weekDoc.exists && weekDoc.data().rewards_distributed) {
      return { message: 'Rewards already distributed for this week' };
    }

    const rewards = [];
    
    // Distribute rewards based on rank
    for (const user of leaderboard) {
      let coinsEarned = 0;
      let badge = null;

      if (user.rank === 1) {
        coinsEarned = this.COIN_REWARDS.WEEKLY_CHAMPION;
        badge = this.ACHIEVEMENT_BADGES.NUTRITION_CHAMPION;
      } else if (user.rank <= 3) {
        coinsEarned = this.COIN_REWARDS.WEEKLY_ELITE;
      } else if (user.rank <= 10) {
        coinsEarned = this.COIN_REWARDS.WEEKLY_ACHIEVER;
      }

      if (coinsEarned > 0) {
        await this.addCoins(user.phone, coinsEarned, `Week ${weekId} rank #${user.rank}`);
        if (badge) {
          await this.addBadge(user.phone, badge);
        }
        
        rewards.push({
          phone: user.phone,
          name: user.name,
          rank: user.rank,
          coinsEarned,
          badge
        });
      }
    }

    // Mark week as distributed
    await db.collection('weekly_challenges').doc(weekId).set({
      week_id: weekId,
      leaderboard: leaderboard.slice(0, 10), // Top 10
      rewards_distributed: true,
      distributed_at: new Date().toISOString()
    });

    return { rewards, leaderboard: leaderboard.slice(0, 10) };
  }

  async addCoins(phone, amount, reason) {
    const db = getDb();
    const userRef = db.collection('scanlyfcoin_transactions').doc(phone);
    
    const doc = await userRef.get();
    const currentBalance = doc.exists ? doc.data().balance : 0;
    
    const transaction = {
      type: 'earned',
      amount,
      reason,
      date: new Date().toISOString()
    };

    if (doc.exists) {
      await userRef.update({
        balance: currentBalance + amount,
        transactions: admin.firestore.FieldValue.arrayUnion(transaction),
        updated_at: new Date().toISOString()
      });
    } else {
      await userRef.set({
        phone,
        balance: amount,
        transactions: [transaction],
        created_at: new Date().toISOString()
      });
    }

    return currentBalance + amount;
  }

  async getBalance(phone) {
    const db = getDb();
    const doc = await db.collection('scanlyfcoin_transactions').doc(phone).get();
    
    if (!doc.exists) {
      return { balance: 0, transactions: [] };
    }

    return doc.data();
  }

  async redeemReward(phone, rewardId) {
    const db = getDb();
    const reward = this.REWARDS_CATALOG.find(r => r.id === rewardId);
    
    if (!reward) {
      throw new Error('Invalid reward ID');
    }

    const balanceData = await this.getBalance(phone);
    
    if (balanceData.balance < reward.cost) {
      throw new Error(`Insufficient balance. Need ${reward.cost} coins, have ${balanceData.balance}`);
    }

    // Deduct coins
    await this.addCoins(phone, -reward.cost, `Redeemed: ${reward.name}`);

    // Generate voucher code (mock)
    const voucherCode = `NUTRI${Date.now().toString(36).toUpperCase()}`;

    // Save redemption
    await db.collection('redemptions').add({
      phone,
      reward_id: rewardId,
      reward_name: reward.name,
      cost: reward.cost,
      voucher_code: voucherCode,
      redeemed_at: new Date().toISOString(),
      status: 'pending_delivery'
    });

    return {
      success: true,
      reward: reward.name,
      voucher_code: voucherCode,
      new_balance: balanceData.balance - reward.cost
    };
  }

  async addBadge(phone, badge) {
    const db = getDb();
    const userRef = db.collection(collections.users).doc(phone);
    
    await userRef.update({
      badges: admin.firestore.FieldValue.arrayUnion(badge),
      updated_at: new Date().toISOString()
    });
  }

  getCurrentWeekId() {
    const now = new Date();
    const year = now.getFullYear();
    const weekNum = Math.ceil((now - new Date(year, 0, 1)) / (7 * 24 * 60 * 60 * 1000));
    return `${year}_week_${weekNum}`;
  }

  formatLeaderboardMessage(leaderboard, userPhone) {
    let message = '🏆 WEEKLY NUTRITION LEADERBOARD 🏆\n\n';
    
    const topEmojis = ['🥇', '🥈', '🥉'];
    
    leaderboard.slice(0, 10).forEach((user, index) => {
      const emoji = topEmojis[index] || `${index + 1}.`;
      const isCurrentUser = user.phone === userPhone ? ' ← YOU' : '';
      message += `${emoji} ${user.name} - ${user.average}%${isCurrentUser}\n`;
    });

    const userRank = leaderboard.find(u => u.phone === userPhone);
    if (userRank && userRank.rank > 10) {
      message += `\n....\n${userRank.rank}. ${userRank.name} - ${userRank.average}% ← YOU`;
    }

    return message;
  }
}

module.exports = new RewardsService();