/**
 * WAMessageDeduplicator - Message Deduplication Service
 * 
 * Prevents duplicate message processing using TTL-based cache
 */

export class WAMessageDeduplicator {
  constructor(options = {}) {
    this.ttl = options.ttl || 24 * 60 * 60 * 1000; // 24 hours default
    this.cleanupInterval = options.cleanupInterval || 60 * 60 * 1000; // 1 hour
    this.cache = new Map();
    
    // Start cleanup interval
    this._startCleanup();
    
    console.log('[WAMessageDeduplicator] Initialized with TTL:', this.ttl, 'ms');
  }

  /**
   * Check if message has been processed
   */
  isDuplicate(messageId) {
    const entry = this.cache.get(messageId);
    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiry) {
      this.cache.delete(messageId);
      return false;
    }

    return true;
  }

  /**
   * Mark message as processed
   */
  markProcessed(messageId) {
    this.cache.set(messageId, {
      timestamp: Date.now(),
      expiry: Date.now() + this.ttl
    });
  }

  /**
   * Start automatic cleanup
   */
  _startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let expiredCount = 0;

      for (const [key, value] of this.cache.entries()) {
        if (now > value.expiry) {
          this.cache.delete(key);
          expiredCount++;
        }
      }

      if (expiredCount > 0) {
        console.log(`[WAMessageDeduplicator] Cleaned up ${expiredCount} expired entries. Cache size: ${this.cache.size}`);
      }
    }, this.cleanupInterval);

    // Prevent the timer from keeping the process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop cleanup and clear cache
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    console.log('[WAMessageDeduplicator] Destroyed');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      ttl: this.ttl,
      cleanupInterval: this.cleanupInterval
    };
  }
}

export default WAMessageDeduplicator;
