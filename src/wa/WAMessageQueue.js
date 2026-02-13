/**
 * WAMessageQueue - Message Queue with Rate Limiting
 * 
 * Handles message sending with rate limiting to avoid WhatsApp restrictions
 */

import Bottleneck from 'bottleneck';
import { WAError } from './WAClient.js';

export class WAMessageQueue {
  constructor(options = {}) {
    this.clientId = options.clientId || 'wa-queue';
    
    // Read from environment with fallback to options, then defaults
    const envMinTime = Number(process.env.WA_QUEUE_MIN_TIME_MS);
    const envMaxConcurrent = Number(process.env.WA_QUEUE_MAX_CONCURRENT);
    const envReservoir = Number(process.env.WA_QUEUE_RESERVOIR);
    
    this.minTime = options.minTime || (envMinTime > 0 ? envMinTime : 150); // 150ms default (reduced from 350ms)
    this.maxConcurrent = options.maxConcurrent || (envMaxConcurrent > 0 ? envMaxConcurrent : 3); // 3 concurrent (increased from 1)
    this.reservoir = options.reservoir || (envReservoir > 0 ? envReservoir : 60); // 60 msgs/min (increased from 40)
    this.reservoirRefreshAmount = options.reservoirRefreshAmount || this.reservoir;
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
      // Check if error is non-retriable
      if (error instanceof WAError && error.isRetriable === false) {
        console.error(`[${this.clientId}] Job failed with non-retriable error:`, error.message);
        return null; // Don't retry
      }
      
      console.error(`[${this.clientId}] Job failed:`, error);
      const retryCount = jobInfo.retryCount || 0;
      if (retryCount < 3) {
        console.log(`[${this.clientId}] Retrying in ${1000 * (retryCount + 1)}ms...`);
        return 1000 * (retryCount + 1); // Retry delay
      }
      return null; // Max retries exceeded
    });

    this.limiter.on('retry', (error, jobInfo) => {
      console.log(`[${this.clientId}] Retrying job (attempt ${jobInfo.retryCount + 1})...`);
    });

    console.log(`[${this.clientId}] Message queue initialized with: minTime=${this.minTime}ms, maxConcurrent=${this.maxConcurrent}, reservoir=${this.reservoir}/min`);
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
