const rewardsService = require('../services/rewardsService');

// Run every Sunday at 11:59 PM to distribute weekly rewards
async function distributeWeeklyRewards() {
  console.log('Starting weekly rewards distribution...');
  
  try {
    const result = await rewardsService.distributeWeeklyRewards();
    
    console.log('Weekly rewards distributed successfully:', {
      rewards_count: result.rewards.length,
      top_3: result.rewards.slice(0, 3).map(r => ({
        name: r.name,
        rank: r.rank,
        coins: r.coinsEarned
      }))
    });
    
    // TODO: Send WhatsApp notifications to winners
    // This would integrate with Puch's notification system
    
    return result;
  } catch (error) {
    console.error('Error distributing weekly rewards:', error);
    throw error;
  }
}

// Manual trigger for testing
async function testWeeklyRewards() {
  console.log('Testing weekly rewards distribution...');
  const result = await distributeWeeklyRewards();
  console.log('Test complete:', result);
}

module.exports = {
  distributeWeeklyRewards,
  testWeeklyRewards
};