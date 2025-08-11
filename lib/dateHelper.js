/**
 * Date helper for handling timezone-aware dates
 * Ensures daily logs reset at midnight in user's timezone
 */

/**
 * Get today's date in IST (Indian Standard Time)
 * @returns {string} Date in YYYY-MM-DD format
 */
function getTodayIST() {
  // Create a new date object for current time
  const now = new Date();
  
  // IST is UTC+5:30
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(now.getTime() + istOffset);
  
  // Return date in YYYY-MM-DD format
  return istTime.toISOString().split('T')[0];
}

/**
 * Get current timestamp in IST
 * @returns {string} ISO timestamp adjusted for IST
 */
function getCurrentTimestampIST() {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString();
}

/**
 * Convert UTC date to IST date string
 * @param {Date|string} utcDate - UTC date
 * @returns {string} Date in YYYY-MM-DD format in IST
 */
function convertToISTDate(utcDate) {
  const date = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffset);
  return istTime.toISOString().split('T')[0];
}

/**
 * Check if a timestamp is from today (in IST)
 * @param {string} timestamp - ISO timestamp
 * @returns {boolean}
 */
function isToday(timestamp) {
  const todayIST = getTodayIST();
  const timestampIST = convertToISTDate(timestamp);
  return todayIST === timestampIST;
}

module.exports = {
  getTodayIST,
  getCurrentTimestampIST,
  convertToISTDate,
  isToday
};