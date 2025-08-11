const crypto = require('crypto');

class CacheService {
  constructor() {
    // In-memory cache as fallback
    this.memoryCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0
    };
    
    // Default TTL values (in seconds)
    this.ttl = {
      nutrition: 86400,      // 24 hours for nutrition data
      userProfile: 3600,     // 1 hour for user profiles
      leaderboard: 300,      // 5 minutes for leaderboard
      foodDetection: 3600,   // 1 hour for image detection results
      default: 1800          // 30 minutes default
    };
    
    // Start cleanup interval
    this.startCleanup();
  }

  // Initialize with Redis client if available
  setRedisClient(redisClient) {
    this.redisClient = redisClient;
    this.redisAvailable = () => {
      return redisClient && redisClient.connected;
    };
  }

  // Generate cache key
  generateKey(namespace, ...args) {
    const data = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(':');
    
    const hash = crypto.createHash('md5').update(data).digest('hex');
    return `${namespace}:${hash}`;
  }

  // Get from cache
  async get(key) {
    try {
      this.cacheStats.hits++;
      
      if (this.redisAvailable && this.redisAvailable()) {
        return await this.getFromRedis(key);
      } else {
        return await this.getFromMemory(key);
      }
    } catch (error) {
      console.error('Cache get error:', error);
      this.cacheStats.misses++;
      return null;
    }
  }

  // Set in cache
  async set(key, value, ttlSeconds = null) {
    try {
      this.cacheStats.sets++;
      const ttl = ttlSeconds || this.ttl.default;
      
      if (this.redisAvailable && this.redisAvailable()) {
        await this.setInRedis(key, value, ttl);
      } else {
        await this.setInMemory(key, value, ttl);
      }
      
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  // Delete from cache
  async delete(key) {
    try {
      if (this.redisAvailable && this.redisAvailable()) {
        await this.deleteFromRedis(key);
      } else {
        this.memoryCache.delete(key);
      }
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  // Clear entire namespace
  async clearNamespace(namespace) {
    try {
      if (this.redisAvailable && this.redisAvailable()) {
        const keys = await this.redisClient.keys(`${namespace}:*`);
        if (keys.length > 0) {
          await this.redisClient.del(keys);
        }
      } else {
        // Clear from memory cache
        const keysToDelete = [];
        for (const key of this.memoryCache.keys()) {
          if (key.startsWith(`${namespace}:`)) {
            keysToDelete.push(key);
          }
        }
        keysToDelete.forEach(key => this.memoryCache.delete(key));
      }
      return true;
    } catch (error) {
      console.error('Cache clear error:', error);
      return false;
    }
  }

  // Redis operations
  async getFromRedis(key) {
    return new Promise((resolve, reject) => {
      this.redisClient.get(key, (err, data) => {
        if (err) return reject(err);
        if (!data) {
          this.cacheStats.misses++;
          return resolve(null);
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
  }

  async setInRedis(key, value, ttl) {
    return new Promise((resolve, reject) => {
      const data = typeof value === 'object' ? JSON.stringify(value) : value;
      this.redisClient.setex(key, ttl, data, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  async deleteFromRedis(key) {
    return new Promise((resolve, reject) => {
      this.redisClient.del(key, (err) => {
        if (err) return reject(err);
        resolve(true);
      });
    });
  }

  // Memory cache operations
  async getFromMemory(key) {
    const cached = this.memoryCache.get(key);
    if (!cached) {
      this.cacheStats.misses++;
      return null;
    }
    
    if (cached.expiry < Date.now()) {
      this.memoryCache.delete(key);
      this.cacheStats.misses++;
      return null;
    }
    
    return cached.value;
  }

  async setInMemory(key, value, ttl) {
    // Implement simple LRU eviction if cache is too large
    if (this.memoryCache.size > 1000) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
      this.cacheStats.evictions++;
    }
    
    this.memoryCache.set(key, {
      value,
      expiry: Date.now() + (ttl * 1000)
    });
    
    return true;
  }

  // Cleanup expired entries from memory cache
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      const keysToDelete = [];
      
      for (const [key, data] of this.memoryCache.entries()) {
        if (data.expiry < now) {
          keysToDelete.push(key);
        }
      }
      
      keysToDelete.forEach(key => {
        this.memoryCache.delete(key);
        this.cacheStats.evictions++;
      });
    }, 60000); // Run every minute
  }

  // Cache specific data types with appropriate TTL
  async cacheNutritionData(foodName, nutritionData) {
    const key = this.generateKey('nutrition', foodName.toLowerCase());
    return await this.set(key, nutritionData, this.ttl.nutrition);
  }

  async getNutritionData(foodName) {
    const key = this.generateKey('nutrition', foodName.toLowerCase());
    return await this.get(key);
  }

  async cacheUserProfile(phone, profile) {
    const key = this.generateKey('profile', phone);
    return await this.set(key, profile, this.ttl.userProfile);
  }

  async getUserProfile(phone) {
    const key = this.generateKey('profile', phone);
    return await this.get(key);
  }

  async cacheFoodDetection(imageHash, detectionResult) {
    const key = this.generateKey('detection', imageHash);
    return await this.set(key, detectionResult, this.ttl.foodDetection);
  }

  async getFoodDetection(imageHash) {
    const key = this.generateKey('detection', imageHash);
    return await this.get(key);
  }

  async cacheLeaderboard(weekId, leaderboard) {
    const key = this.generateKey('leaderboard', weekId);
    return await this.set(key, leaderboard, this.ttl.leaderboard);
  }

  async getLeaderboard(weekId) {
    const key = this.generateKey('leaderboard', weekId);
    return await this.get(key);
  }

  // Invalidate user-specific caches
  async invalidateUserCache(phone) {
    const namespaces = ['profile', 'progress', 'balance'];
    const promises = namespaces.map(ns => 
      this.delete(this.generateKey(ns, phone))
    );
    await Promise.all(promises);
  }

  // Get cache statistics
  getStats() {
    const hitRate = this.cacheStats.hits > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(2)
      : 0;
    
    return {
      ...this.cacheStats,
      hitRate: `${hitRate}%`,
      memorySize: this.memoryCache.size,
      usingRedis: this.redisAvailable && this.redisAvailable()
    };
  }

  // Create a cache wrapper for any async function
  createCachedFunction(fn, namespace, ttl = null) {
    return async (...args) => {
      const key = this.generateKey(namespace, ...args);
      
      // Try to get from cache
      const cached = await this.get(key);
      if (cached !== null) {
        return cached;
      }
      
      // Execute function and cache result
      const result = await fn(...args);
      await this.set(key, result, ttl || this.ttl[namespace] || this.ttl.default);
      
      return result;
    };
  }

  // Batch operations for performance
  async mget(keys) {
    if (this.redisAvailable && this.redisAvailable()) {
      return new Promise((resolve, reject) => {
        this.redisClient.mget(keys, (err, values) => {
          if (err) return reject(err);
          resolve(values.map(v => v ? JSON.parse(v) : null));
        });
      });
    } else {
      return keys.map(key => this.getFromMemory(key));
    }
  }

  async mset(keyValuePairs, ttl = null) {
    const promises = keyValuePairs.map(({ key, value }) => 
      this.set(key, value, ttl)
    );
    return await Promise.all(promises);
  }
}

module.exports = new CacheService();