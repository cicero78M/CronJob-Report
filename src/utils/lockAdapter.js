import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let fallbackWarningLogged = false;

class SerialPerKeyLock {
  constructor() {
    this.activeChains = new Map();
  }

  async acquire(key, handler) {
    const lockKey = String(key ?? '__default__');
    const previousChain = this.activeChains.get(lockKey) || Promise.resolve();

    const executeHandler = async () => handler();
    const currentChain = previousChain.then(executeHandler, executeHandler);

    this.activeChains.set(
      lockKey,
      currentChain.finally(() => {
        if (this.activeChains.get(lockKey) === currentChain) {
          this.activeChains.delete(lockKey);
        }
      })
    );

    return currentChain;
  }
}

function resolveAsyncLockConstructor() {
  const moduleExport = require('async-lock');
  return moduleExport?.default || moduleExport;
}

function logFallbackWarningOnce(logger, error) {
  if (fallbackWarningLogged) {
    return;
  }

  fallbackWarningLogged = true;
  const reason = error?.message || String(error);
  logger.warn(
    `[WA] async-lock module unavailable; using in-memory serial lock fallback. reason=${reason}`
  );
}

export function createLockAdapter({ logger = console } = {}) {
  try {
    const AsyncLock = resolveAsyncLockConstructor();
    if (typeof AsyncLock !== 'function') {
      throw new TypeError('async-lock export is not a constructor');
    }
    return new AsyncLock();
  } catch (error) {
    logFallbackWarningOnce(logger, error);
    return new SerialPerKeyLock();
  }
}

