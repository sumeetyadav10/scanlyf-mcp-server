const axios = require('axios');
const crypto = require('crypto');
const { getDb, collections } = require('../lib/firebase');

class WebhookService {
  constructor() {
    this.webhookTypes = {
      GOAL_ACHIEVED: 'goal_achieved',
      STREAK_MILESTONE: 'streak_milestone',
      WEEKLY_WINNER: 'weekly_winner',
      HEALTH_ALERT: 'health_alert',
      NEW_BADGE: 'new_badge',
      COINS_EARNED: 'coins_earned',
      DAILY_SUMMARY: 'daily_summary'
    };
    
    this.retryConfig = {
      maxAttempts: 3,
      initialDelay: 1000,
      backoffMultiplier: 2
    };
  }

  // Register a webhook for a user
  async registerWebhook(phone, url, events = [], secret = null) {
    const db = getDb();
    const webhookId = crypto.randomBytes(16).toString('hex');
    
    // Validate URL
    try {
      new URL(url);
    } catch (error) {
      throw new Error('Invalid webhook URL');
    }
    
    // Generate secret if not provided
    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');
    
    const webhook = {
      id: webhookId,
      phone,
      url,
      events: events.length > 0 ? events : Object.values(this.webhookTypes),
      secret: webhookSecret,
      active: true,
      created_at: new Date().toISOString(),
      failure_count: 0,
      last_error: null,
      last_success: null
    };
    
    await db.collection('webhooks').doc(webhookId).set(webhook);
    
    // Test the webhook
    await this.testWebhook(webhookId);
    
    return {
      id: webhookId,
      secret: webhookSecret,
      message: 'Webhook registered successfully'
    };
  }

  // Get user's webhooks
  async getUserWebhooks(phone) {
    const db = getDb();
    const snapshot = await db.collection('webhooks')
      .where('phone', '==', phone)
      .where('active', '==', true)
      .get();
    
    return snapshot.docs.map(doc => {
      const data = doc.data();
      // Don't expose the secret
      delete data.secret;
      return data;
    });
  }

  // Delete a webhook
  async deleteWebhook(phone, webhookId) {
    const db = getDb();
    const webhookRef = db.collection('webhooks').doc(webhookId);
    const webhook = await webhookRef.get();
    
    if (!webhook.exists) {
      throw new Error('Webhook not found');
    }
    
    if (webhook.data().phone !== phone) {
      throw new Error('Unauthorized to delete this webhook');
    }
    
    await webhookRef.update({
      active: false,
      deleted_at: new Date().toISOString()
    });
    
    return { message: 'Webhook deleted successfully' };
  }

  // Send webhook notification
  async sendWebhook(phone, eventType, payload) {
    const db = getDb();
    
    // Get active webhooks for user that subscribe to this event
    const snapshot = await db.collection('webhooks')
      .where('phone', '==', phone)
      .where('active', '==', true)
      .where('events', 'array-contains', eventType)
      .get();
    
    const promises = snapshot.docs.map(doc => {
      const webhook = doc.data();
      return this.deliverWebhook(webhook, eventType, payload);
    });
    
    const results = await Promise.allSettled(promises);
    
    return {
      sent: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length
    };
  }

  // Deliver webhook with retry logic
  async deliverWebhook(webhook, eventType, payload) {
    const event = {
      id: crypto.randomBytes(16).toString('hex'),
      type: eventType,
      timestamp: new Date().toISOString(),
      data: payload
    };
    
    // Create signature
    const signature = this.createSignature(webhook.secret, event);
    
    let lastError = null;
    
    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        const response = await axios.post(webhook.url, event, {
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-ID': webhook.id,
            'X-Event-Type': eventType
          },
          timeout: 10000, // 10 second timeout
          validateStatus: (status) => status < 500 // Don't retry on client errors
        });
        
        // Update success timestamp
        await this.updateWebhookStatus(webhook.id, {
          last_success: new Date().toISOString(),
          failure_count: 0,
          last_error: null
        });
        
        return response.data;
      } catch (error) {
        lastError = error.message;
        
        // Don't retry on client errors
        if (error.response && error.response.status < 500) {
          break;
        }
        
        // Wait before retry
        if (attempt < this.retryConfig.maxAttempts - 1) {
          const delay = this.retryConfig.initialDelay * 
            Math.pow(this.retryConfig.backoffMultiplier, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Update failure count
    const db = getDb();
    const webhookRef = db.collection('webhooks').doc(webhook.id);
    const currentDoc = await webhookRef.get();
    const currentFailures = currentDoc.data().failure_count || 0;
    
    await this.updateWebhookStatus(webhook.id, {
      failure_count: currentFailures + 1,
      last_error: lastError,
      last_error_at: new Date().toISOString()
    });
    
    // Disable webhook after too many failures
    if (currentFailures + 1 >= 10) {
      await webhookRef.update({
        active: false,
        disabled_reason: 'Too many consecutive failures'
      });
    }
    
    throw new Error(`Webhook delivery failed: ${lastError}`);
  }

  // Create HMAC signature for webhook security
  createSignature(secret, payload) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  // Update webhook status
  async updateWebhookStatus(webhookId, updates) {
    const db = getDb();
    await db.collection('webhooks').doc(webhookId).update(updates);
  }

  // Test webhook endpoint
  async testWebhook(webhookId) {
    const db = getDb();
    const webhookDoc = await db.collection('webhooks').doc(webhookId).get();
    
    if (!webhookDoc.exists) {
      throw new Error('Webhook not found');
    }
    
    const webhook = webhookDoc.data();
    const testPayload = {
      message: 'This is a test webhook from Scanlyf',
      timestamp: new Date().toISOString()
    };
    
    try {
      await this.deliverWebhook(webhook, 'test', testPayload);
      return { success: true, message: 'Webhook test successful' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Trigger webhook events based on user actions
  async triggerGoalAchieved(phone, goalType, achievement) {
    await this.sendWebhook(phone, this.webhookTypes.GOAL_ACHIEVED, {
      goal_type: goalType,
      achievement: achievement,
      message: `Congratulations! You've achieved your ${goalType} goal!`
    });
  }

  async triggerStreakMilestone(phone, streakDays) {
    if ([7, 14, 30, 60, 100].includes(streakDays)) {
      await this.sendWebhook(phone, this.webhookTypes.STREAK_MILESTONE, {
        streak_days: streakDays,
        message: `Amazing! You've maintained a ${streakDays}-day streak!`
      });
    }
  }

  async triggerWeeklyWinner(phone, rank, coinsEarned) {
    await this.sendWebhook(phone, this.webhookTypes.WEEKLY_WINNER, {
      rank: rank,
      coins_earned: coinsEarned,
      message: `Congratulations! You ranked #${rank} this week and earned ${coinsEarned} ScanlyfCoins!`
    });
  }

  async triggerHealthAlert(phone, alertType, details) {
    await this.sendWebhook(phone, this.webhookTypes.HEALTH_ALERT, {
      alert_type: alertType,
      details: details,
      severity: details.severity || 'medium',
      message: details.message
    });
  }

  async triggerNewBadge(phone, badge) {
    await this.sendWebhook(phone, this.webhookTypes.NEW_BADGE, {
      badge: badge,
      message: `You've earned a new badge: ${badge}!`
    });
  }

  async triggerCoinsEarned(phone, amount, reason) {
    await this.sendWebhook(phone, this.webhookTypes.COINS_EARNED, {
      amount: amount,
      reason: reason,
      message: `You've earned ${amount} ScanlyfCoins for ${reason}!`
    });
  }

  async triggerDailySummary(phone, summary) {
    await this.sendWebhook(phone, this.webhookTypes.DAILY_SUMMARY, {
      date: summary.date,
      calories: summary.calories,
      progress_percentage: summary.progress,
      foods_logged: summary.foodCount,
      top_nutrients: summary.topNutrients,
      message: `Daily summary: ${summary.calories} calories (${summary.progress}% of goal)`
    });
  }

  // Schedule daily summary webhooks
  async scheduleDailySummaries() {
    const db = getDb();
    const today = new Date().toISOString().split('T')[0];
    
    // Get all users with webhooks subscribing to daily summaries
    const webhooksSnapshot = await db.collection('webhooks')
      .where('active', '==', true)
      .where('events', 'array-contains', this.webhookTypes.DAILY_SUMMARY)
      .get();
    
    const userPhones = [...new Set(webhooksSnapshot.docs.map(doc => doc.data().phone))];
    
    for (const phone of userPhones) {
      try {
        // Get user's daily progress
        const foodService = require('./foodService');
        const userService = require('./userService');
        
        const progress = await foodService.getDailyProgress(phone, today);
        const profile = await userService.getProfile(phone);
        
        if (profile && progress.foods.length > 0) {
          const progressPercentage = Math.round(
            (progress.totals.calories / profile.calorie_target) * 100
          );
          
          const summary = {
            date: today,
            calories: progress.totals.calories,
            progress: progressPercentage,
            foodCount: progress.foods.length,
            topNutrients: {
              protein: progress.totals.protein,
              carbs: progress.totals.carbs,
              fat: progress.totals.fat
            }
          };
          
          await this.triggerDailySummary(phone, summary);
        }
      } catch (error) {
        console.error(`Failed to send daily summary for ${phone}:`, error);
      }
    }
  }
}

module.exports = new WebhookService();