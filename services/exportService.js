const { getDb, collections } = require('../lib/firebase');
const { Parser } = require('@json2csv/plainjs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

class ExportService {
  constructor() {
    this.exportFormats = {
      JSON: 'json',
      CSV: 'csv',
      PDF: 'pdf',
      EXCEL: 'excel'
    };
  }

  // Export user data in requested format
  async exportUserData(phone, options = {}) {
    const {
      format = this.exportFormats.JSON,
      startDate = null,
      endDate = null,
      includeProfile = true,
      includeProgress = true,
      includeRewards = true,
      includeFoodLog = true
    } = options;

    // Gather all data
    const data = await this.gatherUserData(phone, {
      startDate,
      endDate,
      includeProfile,
      includeProgress,
      includeRewards,
      includeFoodLog
    });

    // Format based on requested type
    switch (format) {
      case this.exportFormats.JSON:
        return this.exportAsJSON(data);
      case this.exportFormats.CSV:
        return this.exportAsCSV(data);
      case this.exportFormats.PDF:
        return await this.exportAsPDF(data);
      case this.exportFormats.EXCEL:
        return await this.exportAsExcel(data);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  // Gather all user data
  async gatherUserData(phone, options) {
    const db = getDb();
    const data = {
      exportDate: new Date().toISOString(),
      phone: phone
    };

    // Get user profile
    if (options.includeProfile) {
      const userDoc = await db.collection(collections.users).doc(phone).get();
      if (userDoc.exists) {
        data.profile = userDoc.data();
        // Remove sensitive data
        delete data.profile.phone;
      }
    }

    // Get food logs
    if (options.includeFoodLog) {
      data.foodLogs = await this.getFoodLogs(phone, options.startDate, options.endDate);
    }

    // Get progress statistics
    if (options.includeProgress) {
      data.progressStats = await this.getProgressStats(phone, data.foodLogs);
    }

    // Get rewards data
    if (options.includeRewards) {
      data.rewards = await this.getRewardsData(phone);
    }

    return data;
  }

  // Get food logs within date range
  async getFoodLogs(phone, startDate, endDate) {
    const db = getDb();
    let query = db.collection(collections.dailyLogs)
      .where('phone', '==', phone);

    if (startDate) {
      query = query.where('date', '>=', startDate);
    }
    if (endDate) {
      query = query.where('date', '<=', endDate);
    }

    const snapshot = await query.orderBy('date', 'desc').get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      delete data.phone; // Remove phone from export
      return data;
    });
  }

  // Calculate progress statistics
  async getProgressStats(phone, foodLogs) {
    if (!foodLogs || foodLogs.length === 0) {
      return null;
    }

    const stats = {
      totalDays: foodLogs.length,
      averageCalories: 0,
      averageProtein: 0,
      averageCarbs: 0,
      averageFat: 0,
      totalFoodsLogged: 0,
      mostCommonFoods: {},
      dailyGoalAchievement: []
    };

    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;

    foodLogs.forEach(log => {
      totalCalories += log.totals.calories || 0;
      totalProtein += log.totals.protein || 0;
      totalCarbs += log.totals.carbs || 0;
      totalFat += log.totals.fat || 0;
      stats.totalFoodsLogged += log.foods.length;

      // Track food frequency
      log.foods.forEach(food => {
        const name = food.name.toLowerCase();
        stats.mostCommonFoods[name] = (stats.mostCommonFoods[name] || 0) + 1;
      });
    });

    stats.averageCalories = Math.round(totalCalories / stats.totalDays);
    stats.averageProtein = Math.round(totalProtein / stats.totalDays);
    stats.averageCarbs = Math.round(totalCarbs / stats.totalDays);
    stats.averageFat = Math.round(totalFat / stats.totalDays);

    // Get top 10 most common foods
    stats.mostCommonFoods = Object.entries(stats.mostCommonFoods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reduce((obj, [key, value]) => {
        obj[key] = value;
        return obj;
      }, {});

    return stats;
  }

  // Get rewards data
  async getRewardsData(phone) {
    const db = getDb();
    
    // Get ScanlyfCoin balance and transactions
    const coinDoc = await db.collection('scanlyfcoin_transactions').doc(phone).get();
    const coinData = coinDoc.exists ? coinDoc.data() : { balance: 0, transactions: [] };

    // Get badges
    const userDoc = await db.collection(collections.users).doc(phone).get();
    const badges = userDoc.exists ? (userDoc.data().badges || []) : [];

    // Get leaderboard history
    const leaderboardSnapshot = await db.collection('weekly_challenges')
      .where('leaderboard', 'array-contains', { phone })
      .orderBy('week_id', 'desc')
      .limit(10)
      .get();

    const leaderboardHistory = leaderboardSnapshot.docs.map(doc => {
      const data = doc.data();
      const userEntry = data.leaderboard.find(entry => entry.phone === phone);
      return {
        week: data.week_id,
        rank: userEntry ? userEntry.rank : null,
        average: userEntry ? userEntry.average : null
      };
    });

    return {
      scanlyfCoins: {
        balance: coinData.balance,
        recentTransactions: coinData.transactions.slice(-20)
      },
      badges: badges,
      leaderboardHistory: leaderboardHistory
    };
  }

  // Export as JSON
  exportAsJSON(data) {
    return {
      contentType: 'application/json',
      filename: `scanlyf_export_${data.phone}_${Date.now()}.json`,
      data: JSON.stringify(data, null, 2)
    };
  }

  // Export as CSV
  exportAsCSV(data) {
    const csvData = [];
    
    // Profile section
    if (data.profile) {
      csvData.push({
        section: 'Profile',
        key: 'Name',
        value: data.profile.name
      });
      csvData.push({
        section: 'Profile',
        key: 'Daily Calorie Target',
        value: data.profile.calorie_target
      });
    }

    // Food logs
    if (data.foodLogs) {
      data.foodLogs.forEach(log => {
        log.foods.forEach(food => {
          csvData.push({
            section: 'Food Log',
            date: log.date,
            food: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat
          });
        });
      });
    }

    const parser = new Parser();
    const csv = parser.parse(csvData);
    
    return {
      contentType: 'text/csv',
      filename: `scanlyf_export_${data.phone}_${Date.now()}.csv`,
      data: csv
    };
  }

  // Export as PDF
  async exportAsPDF(data) {
    const doc = new PDFDocument();
    const chunks = [];
    
    doc.on('data', chunk => chunks.push(chunk));
    
    // Title
    doc.fontSize(20).text('Scanlyf Nutrition Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Generated on: ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(2);

    // Profile Section
    if (data.profile) {
      doc.fontSize(16).text('Profile Information', { underline: true });
      doc.fontSize(12);
      doc.text(`Name: ${data.profile.name}`);
      doc.text(`Age: ${data.profile.age}`);
      doc.text(`Daily Targets: ${data.profile.calorie_target} cal, ${data.profile.protein_target}g protein`);
      doc.moveDown();
    }

    // Progress Statistics
    if (data.progressStats) {
      doc.fontSize(16).text('Progress Summary', { underline: true });
      doc.fontSize(12);
      doc.text(`Total Days Tracked: ${data.progressStats.totalDays}`);
      doc.text(`Average Daily Calories: ${data.progressStats.averageCalories}`);
      doc.text(`Total Foods Logged: ${data.progressStats.totalFoodsLogged}`);
      
      doc.moveDown();
      doc.text('Most Common Foods:');
      Object.entries(data.progressStats.mostCommonFoods).forEach(([food, count]) => {
        doc.text(`  • ${food}: ${count} times`);
      });
      doc.moveDown();
    }

    // Rewards Section
    if (data.rewards) {
      doc.fontSize(16).text('Rewards & Achievements', { underline: true });
      doc.fontSize(12);
      doc.text(`ScanlyfCoin Balance: ${data.rewards.scanlyfCoins.balance}`);
      
      if (data.rewards.badges.length > 0) {
        doc.text('Badges Earned:');
        data.rewards.badges.forEach(badge => {
          doc.text(`  • ${badge}`);
        });
      }
      doc.moveDown();
    }

    // Recent Food Logs (last 7 days)
    if (data.foodLogs && data.foodLogs.length > 0) {
      doc.addPage();
      doc.fontSize(16).text('Recent Food Logs', { underline: true });
      doc.fontSize(10);
      
      data.foodLogs.slice(0, 7).forEach(log => {
        doc.moveDown();
        doc.fontSize(12).text(`Date: ${log.date}`);
        doc.fontSize(10);
        doc.text(`Total: ${log.totals.calories} cal, ${log.totals.protein}g protein, ${log.totals.carbs}g carbs, ${log.totals.fat}g fat`);
        
        log.foods.forEach(food => {
          doc.text(`  • ${food.name}: ${food.calories} cal`);
        });
      });
    }

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(chunks);
        resolve({
          contentType: 'application/pdf',
          filename: `scanlyf_report_${data.phone}_${Date.now()}.pdf`,
          data: pdfData
        });
      });
    });
  }

  // Export as Excel
  async exportAsExcel(data) {
    const workbook = new ExcelJS.Workbook();
    
    // Profile Sheet
    if (data.profile) {
      const profileSheet = workbook.addWorksheet('Profile');
      profileSheet.columns = [
        { header: 'Field', key: 'field', width: 20 },
        { header: 'Value', key: 'value', width: 30 }
      ];
      
      profileSheet.addRow({ field: 'Name', value: data.profile.name });
      profileSheet.addRow({ field: 'Age', value: data.profile.age });
      profileSheet.addRow({ field: 'Height (cm)', value: data.profile.height_cm });
      profileSheet.addRow({ field: 'Weight (kg)', value: data.profile.weight_kg });
      profileSheet.addRow({ field: 'Daily Calorie Target', value: data.profile.calorie_target });
      profileSheet.addRow({ field: 'Daily Protein Target', value: data.profile.protein_target });
    }

    // Food Logs Sheet
    if (data.foodLogs) {
      const foodSheet = workbook.addWorksheet('Food Logs');
      foodSheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Food', key: 'food', width: 30 },
        { header: 'Calories', key: 'calories', width: 10 },
        { header: 'Protein (g)', key: 'protein', width: 12 },
        { header: 'Carbs (g)', key: 'carbs', width: 12 },
        { header: 'Fat (g)', key: 'fat', width: 10 }
      ];

      data.foodLogs.forEach(log => {
        log.foods.forEach(food => {
          foodSheet.addRow({
            date: log.date,
            food: food.name,
            calories: food.calories,
            protein: food.protein,
            carbs: food.carbs,
            fat: food.fat
          });
        });
      });

      // Add summary
      foodSheet.addRow({});
      foodSheet.addRow({ date: 'SUMMARY', food: 'Daily Averages' });
      if (data.progressStats) {
        foodSheet.addRow({
          date: '',
          food: 'Average',
          calories: data.progressStats.averageCalories,
          protein: data.progressStats.averageProtein,
          carbs: data.progressStats.averageCarbs,
          fat: data.progressStats.averageFat
        });
      }
    }

    // Progress Sheet
    if (data.progressStats) {
      const progressSheet = workbook.addWorksheet('Progress');
      progressSheet.columns = [
        { header: 'Metric', key: 'metric', width: 30 },
        { header: 'Value', key: 'value', width: 20 }
      ];

      progressSheet.addRow({ metric: 'Total Days Tracked', value: data.progressStats.totalDays });
      progressSheet.addRow({ metric: 'Total Foods Logged', value: data.progressStats.totalFoodsLogged });
      progressSheet.addRow({ metric: 'Average Daily Calories', value: data.progressStats.averageCalories });
      progressSheet.addRow({ metric: 'Average Daily Protein (g)', value: data.progressStats.averageProtein });
      progressSheet.addRow({ metric: 'Average Daily Carbs (g)', value: data.progressStats.averageCarbs });
      progressSheet.addRow({ metric: 'Average Daily Fat (g)', value: data.progressStats.averageFat });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `scanlyf_export_${data.phone}_${Date.now()}.xlsx`,
      data: buffer
    };
  }

  // Generate nutrition insights report
  async generateInsightsReport(phone, days = 30) {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const data = await this.gatherUserData(phone, {
      startDate,
      endDate,
      includeProfile: true,
      includeProgress: true,
      includeRewards: true,
      includeFoodLog: true
    });

    const insights = {
      period: `${startDate} to ${endDate}`,
      summary: {},
      trends: {},
      recommendations: []
    };

    if (data.progressStats && data.profile) {
      // Summary
      insights.summary = {
        daysTracked: data.progressStats.totalDays,
        complianceRate: `${Math.round((data.progressStats.totalDays / days) * 100)}%`,
        averageCalorieAccuracy: `${Math.round((data.progressStats.averageCalories / data.profile.calorie_target) * 100)}%`,
        topFoods: Object.keys(data.progressStats.mostCommonFoods).slice(0, 5)
      };

      // Trends
      insights.trends = this.analyzeTrends(data.foodLogs);

      // Recommendations
      insights.recommendations = this.generateRecommendations(data);
    }

    return insights;
  }

  // Analyze trends in food logs
  analyzeTrends(foodLogs) {
    if (!foodLogs || foodLogs.length < 7) {
      return { message: 'Not enough data for trend analysis' };
    }

    const weeklyAverages = [];
    const sortedLogs = foodLogs.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate weekly averages
    for (let i = 0; i < sortedLogs.length; i += 7) {
      const week = sortedLogs.slice(i, i + 7);
      if (week.length < 3) continue; // Skip incomplete weeks
      
      const weekTotal = week.reduce((acc, log) => ({
        calories: acc.calories + log.totals.calories,
        protein: acc.protein + log.totals.protein
      }), { calories: 0, protein: 0 });
      
      weeklyAverages.push({
        weekStart: week[0].date,
        avgCalories: Math.round(weekTotal.calories / week.length),
        avgProtein: Math.round(weekTotal.protein / week.length)
      });
    }

    // Determine trends
    const trends = {
      calorieTrend: 'stable',
      proteinTrend: 'stable'
    };

    if (weeklyAverages.length >= 2) {
      const firstWeek = weeklyAverages[0];
      const lastWeek = weeklyAverages[weeklyAverages.length - 1];
      
      const calorieChange = ((lastWeek.avgCalories - firstWeek.avgCalories) / firstWeek.avgCalories) * 100;
      const proteinChange = ((lastWeek.avgProtein - firstWeek.avgProtein) / firstWeek.avgProtein) * 100;
      
      if (calorieChange > 10) trends.calorieTrend = 'increasing';
      else if (calorieChange < -10) trends.calorieTrend = 'decreasing';
      
      if (proteinChange > 10) trends.proteinTrend = 'increasing';
      else if (proteinChange < -10) trends.proteinTrend = 'decreasing';
    }

    return {
      weeklyAverages,
      trends
    };
  }

  // Generate personalized recommendations
  generateRecommendations(data) {
    const recommendations = [];
    
    if (!data.progressStats || !data.profile) {
      return recommendations;
    }

    // Calorie recommendations
    const calorieAccuracy = data.progressStats.averageCalories / data.profile.calorie_target;
    if (calorieAccuracy < 0.8) {
      recommendations.push({
        type: 'calories',
        priority: 'high',
        message: 'You\'re consistently under your calorie target. Consider adding healthy snacks between meals.'
      });
    } else if (calorieAccuracy > 1.2) {
      recommendations.push({
        type: 'calories',
        priority: 'medium',
        message: 'You\'re exceeding your calorie target. Try portion control or lower-calorie alternatives.'
      });
    }

    // Protein recommendations
    const proteinAccuracy = data.progressStats.averageProtein / data.profile.protein_target;
    if (proteinAccuracy < 0.8) {
      recommendations.push({
        type: 'protein',
        priority: 'high',
        message: 'Your protein intake is below target. Add lean meats, legumes, or protein supplements.'
      });
    }

    // Consistency recommendations
    const complianceRate = data.progressStats.totalDays / 30;
    if (complianceRate < 0.7) {
      recommendations.push({
        type: 'consistency',
        priority: 'high',
        message: 'Track your meals more consistently for better insights. Set daily reminders!'
      });
    }

    // Food variety
    const uniqueFoods = Object.keys(data.progressStats.mostCommonFoods).length;
    if (uniqueFoods < 10) {
      recommendations.push({
        type: 'variety',
        priority: 'low',
        message: 'Try to diversify your diet with more food varieties for better nutrition.'
      });
    }

    return recommendations;
  }
}

module.exports = new ExportService();