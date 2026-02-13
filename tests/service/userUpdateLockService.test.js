// tests/service/userUpdateLockService.test.js
// Unit tests for the distributed lock service

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

describe('userUpdateLockService', () => {
  let acquireUpdateLock;
  let releaseUpdateLock;
  let isUpdateLocked;
  let withUpdateLock;
  
  // Mock Redis client
  const mockRedis = {
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn()
  };

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    
    // Mock the redis module
    jest.unstable_mockModule('../../src/config/redis.js', () => ({
      default: mockRedis
    }));
    
    // Import after mocking
    const service = await import('../../src/service/userUpdateLockService.js');
    acquireUpdateLock = service.acquireUpdateLock;
    releaseUpdateLock = service.releaseUpdateLock;
    isUpdateLocked = service.isUpdateLocked;
    withUpdateLock = service.withUpdateLock;
  });

  describe('acquireUpdateLock', () => {
    it('should return true when lock is acquired', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const result = await acquireUpdateLock('user123', 'insta');
      expect(result).toBe(true);
      expect(mockRedis.set).toHaveBeenCalledWith(
        'user_update_lock:user123:insta',
        expect.any(String),
        { NX: true, EX: 10 }
      );
    });

    it('should return false when lock cannot be acquired', async () => {
      mockRedis.set.mockResolvedValue(null);
      const result = await acquireUpdateLock('user123', 'insta');
      expect(result).toBe(false);
    });

    it('should handle redis errors gracefully', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis error'));
      const result = await acquireUpdateLock('user123', 'insta');
      expect(result).toBe(false);
    });
  });

  describe('releaseUpdateLock', () => {
    it('should delete the lock key', async () => {
      mockRedis.del.mockResolvedValue(1);
      await releaseUpdateLock('user123', 'tiktok');
      expect(mockRedis.del).toHaveBeenCalledWith('user_update_lock:user123:tiktok');
    });

    it('should handle redis errors gracefully', async () => {
      mockRedis.del.mockRejectedValue(new Error('Redis error'));
      await expect(releaseUpdateLock('user123', 'tiktok')).resolves.not.toThrow();
    });
  });

  describe('isUpdateLocked', () => {
    it('should return true when lock exists', async () => {
      mockRedis.exists.mockResolvedValue(1);
      const result = await isUpdateLocked('user123', 'whatsapp');
      expect(result).toBe(true);
    });

    it('should return false when lock does not exist', async () => {
      mockRedis.exists.mockResolvedValue(0);
      const result = await isUpdateLocked('user123', 'whatsapp');
      expect(result).toBe(false);
    });
  });

  describe('withUpdateLock', () => {
    it('should execute function when lock is acquired', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);
      
      const testFn = jest.fn().mockResolvedValue('result');
      const result = await withUpdateLock('user123', 'insta', testFn);
      
      expect(result).toBe('result');
      expect(testFn).toHaveBeenCalled();
      expect(mockRedis.set).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should throw error when lock cannot be acquired', async () => {
      mockRedis.set.mockResolvedValue(null);
      
      const testFn = jest.fn();
      await expect(
        withUpdateLock('user123', 'insta', testFn)
      ).rejects.toThrow('Operasi update sedang diproses');
      
      expect(testFn).not.toHaveBeenCalled();
    });

    it('should release lock even when function throws', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);
      
      const testFn = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(
        withUpdateLock('user123', 'insta', testFn)
      ).rejects.toThrow('Test error');
      
      expect(mockRedis.del).toHaveBeenCalled();
    });
  });
});
