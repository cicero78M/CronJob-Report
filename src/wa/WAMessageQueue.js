/**
 * WAMessageQueue - Message Queue with Rate Limiting
 * 
 * Handles message sending with rate limiting to avoid WhatsApp restrictions
 */

import Bottleneck from 'bottleneck';

export class WAMessageQueue {
  constructor(options = {}) {
    this.clientId = options.clientId || 'wa-queue';
    this.minTime = options.minTime || 350; // Minimum time between messages (ms)
    this.maxConcurrent = options.maxConcurrent || 1; // Max concurrent messages
    this.reservoir = options.reservoir || 40; // Max messages per minute
    this.reservoirRefreshAmount = options.reservoirRefreshAmount || 40;
    this.reservoirRefreshInterval = options.reservoirRefreshInterval || 60000; // 1 minute
    
    // Create Bottleneck limiter
    this.limiter = new Bottleneck({
      minTime: this.minTime,
      maxConcurrent: this.maxConcurrent,
      reservoir: this.reservoir,
      reservoirRefreshAmount: this.reservoirRefreshAmount,
      reservoirRefreshInterval: this.reservoirRefreshInterval
    });

    // Event handlers
    this.limiter.on('failed', (error, jobInfo) => {
      console.error(`[${this.clientId}] Job failed:`, error);
      const retryCount = jobInfo.retryCount || 0;
      if (retryCount < 3) {
        console.log(`[${this.clientId}] Retrying in ${1000 * (retryCount + 1)}ms...`);
        return 1000 * (retryCount + 1); // Retry delay
      }
    });

    this.limiter.on('retry', (error, jobInfo) => {
      console.log(`[${this.clientId}] Retrying job (attempt ${jobInfo.retryCount + 1})...`);
    });

    console.log(`[${this.clientId}] Message queue initialized`);
  }

  /**
   * Schedule a message to be sent
   */
  async schedule(client, to, content, options = {}) {
    if (!client || !client.isReady) {
      throw new Error(`[${this.clientId}] Client is not ready`);
    }

    // Normalize options to ensure it's always an object
    const normalizedOptions = options || {};

    return this.limiter.schedule(async () => {
      try {
        const result = await client.sendMessage(to, content, normalizedOptions);
        console.log(`[${this.clientId}] Message sent to ${to}`);
        return result;
      } catch (error) {
        console.error(`[${this.clientId}] Error sending message to ${to}:`, error);
        throw error;
      }
    });
  }

  /**
   * Get queue counts
   */
  counts() {
    return this.limiter.counts();
  }

  /**
   * Clear the queue
   */
  async disconnect() {
    console.log(`[${this.clientId}] Disconnecting queue...`);
    await this.limiter.disconnect();
    console.log(`[${this.clientId}] Queue disconnected`);
  }
}

export default WAMessageQueue;
