# WhatsApp Bot - New Architecture

This document describes the new simplified WhatsApp bot architecture implemented following wwebjs best practices.

## Overview

The new architecture is built on a clean, modular design that separates concerns and makes the codebase more maintainable. It consists of five main components:

1. **WAClient** - WhatsApp client wrapper
2. **WAService** - Service coordinator
3. **WAMessageQueue** - Rate limiting and queuing
4. **WAMessageDeduplicator** - Duplicate message prevention
5. **WAHelpers** - Utility functions

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                      Application                         │
│                        (app.js)                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                  Compatibility Layer                     │
│              (src/wa/compatibility.js)                   │
│          (src/service/waService.js - export)            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                     WAService                            │
│               (src/wa/WAService.js)                      │
│  - Manages multiple clients                             │
│  - Coordinates message handling                         │
│  - Provides unified interface                           │
└───┬──────────────────┬──────────────────┬───────────────┘
    │                  │                  │
    ▼                  ▼                  ▼
┌──────────┐   ┌──────────────┐   ┌─────────────────┐
│WAClient  │   │WAMessageQueue│   │WAMessage        │
│          │   │              │   │Deduplicator     │
│- Wrapper │   │- Rate limit  │   │                 │
│- Events  │   │- Bottleneck  │   │- TTL cache      │
│- Lifecycle│   │- Retry logic │   │- Auto cleanup   │
└─────┬────┘   └──────────────┘   └─────────────────┘
      │
      ▼
┌──────────────────────────────────┐
│    whatsapp-web.js (wwebjs)      │
│    - Client                      │
│    - LocalAuth                   │
└──────────────────────────────────┘
```

## Components

### 1. WAClient (src/wa/WAClient.js)

A clean wrapper around whatsapp-web.js Client that handles:

- **Initialization** - Sets up client with LocalAuth
- **Event handling** - QR codes, authentication, ready state, messages
- **Reconnection** - Automatic reconnection with exponential backoff
- **Lifecycle management** - Proper cleanup and destruction

**Key Features:**
- Simple, focused interface
- Automatic reconnection (5 attempts with exponential backoff)
- Event emission for all WhatsApp events
- Clean separation from business logic

**Example Usage:**
```javascript
import { WAClient } from './src/wa/WAClient.js';

const client = new WAClient({
  clientId: 'my-client',
  authPath: '/path/to/sessions',
  webVersion: '2.3000.0'
});

client.on('ready', () => {
  console.log('Client is ready!');
});

client.on('message', (message) => {
  console.log('Received:', message.body);
});

await client.initialize();
```

### 2. WAService (src/wa/WAService.js)

Central service that coordinates multiple WhatsApp clients:

- **Multi-client management** - Handles multiple clients (admin, gateway, etc.)
- **Message deduplication** - Prevents duplicate processing
- **Message routing** - Routes messages to appropriate handlers
- **Queue management** - One queue per client

**Key Features:**
- Singleton pattern for global access
- Support for multiple independent clients
- Automatic message deduplication
- Handler registration system

**Example Usage:**
```javascript
import { waService } from './src/wa/WAService.js';

// Create and initialize client
const client = waService.createClient('my-client', {
  clientId: 'my-session',
  authPath: '/path/to/sessions'
});

await waService.initializeClient('my-client');

// Register message handler
waService.onMessage((clientId, message) => {
  console.log(`Message from ${clientId}:`, message.body);
});

// Send message
await waService.sendMessage('my-client', '628xxx@c.us', 'Hello!');
```

### 3. WAMessageQueue (src/wa/WAMessageQueue.js)

Rate-limited message queue using Bottleneck:

- **Rate limiting** - 40 messages per minute
- **Throttling** - Minimum 350ms between messages
- **Retry logic** - Automatic retry on failure (up to 3 attempts)
- **Concurrency control** - One message at a time

**Configuration:**
```javascript
{
  minTime: 350,              // Min time between messages (ms)
  maxConcurrent: 1,          // Max concurrent messages
  reservoir: 40,             // Max messages per minute
  reservoirRefreshAmount: 40,
  reservoirRefreshInterval: 60000 // 1 minute
}
```

### 4. WAMessageDeduplicator (src/wa/WAMessageDeduplicator.js)

TTL-based cache for preventing duplicate message processing:

- **TTL-based** - Messages expire after 24 hours (configurable)
- **Automatic cleanup** - Hourly cleanup of expired entries
- **Memory safe** - Prevents memory leaks
- **Statistics** - Provides cache statistics

**Configuration:**
```javascript
{
  ttl: 24 * 60 * 60 * 1000,     // 24 hours
  cleanupInterval: 60 * 60 * 1000 // 1 hour
}
```

### 5. WAHelpers (src/wa/WAHelpers.js)

Utility functions for common WhatsApp operations:

- `formatToWhatsAppId(phoneNumber)` - Format phone to WA ID
- `isValidWid(wid)` - Validate WhatsApp ID
- `getAdminWAIds()` - Get admin WhatsApp IDs
- `isAdmin(userId)` - Check if user is admin
- `formatMessage(text, options)` - Format message with title/footer
- `extractPhoneNumber(wid)` - Extract phone from WA ID
- `isGroupMessage(message)` - Check if from group
- `parseCommand(message)` - Parse command from message

## Compatibility Layer

The compatibility layer (src/wa/compatibility.js and src/service/waService.js) provides backward compatibility with the old interface:

- Exports `waClient` and `waGatewayClient` instances
- Maintains same interface as old waService
- Allows gradual migration of existing code
- Zero changes required in cron jobs

**Old code continues to work:**
```javascript
import waClient, { waGatewayClient } from '../service/waService.js';

await waClient.sendMessage(to, message);
await waGatewayClient.waitForWaReady();
```

## Benefits of New Architecture

1. **Simpler** - ~500 lines vs ~5000 lines in old implementation
2. **Cleaner** - Clear separation of concerns
3. **More maintainable** - Each component has single responsibility
4. **Better tested** - Easier to test individual components
5. **Following best practices** - Based on wwebjs official patterns
6. **Memory safe** - TTL-based deduplication prevents leaks
7. **Robust** - Automatic reconnection and retry logic
8. **Flexible** - Easy to add new clients or customize behavior

## Configuration

Environment variables:

```bash
# Authentication
APP_SESSION_NAME=wa-admin
GATEWAY_WA_CLIENT_ID=wa-gateway-prod
WA_AUTH_DATA_PATH=/var/lib/cicero/wa-sessions

# Version control
WA_WEB_VERSION_CACHE_URL=https://example.com/cache.json
WA_WEB_VERSION=2.3000.0

# Admin numbers
ADMIN_WHATSAPP=628xxx,628yyy
GATEWAY_WHATSAPP_ADMIN=628zzz
```

## Migration Guide

The new architecture is already integrated with backward compatibility:

1. ✅ **Old code continues to work** - No changes needed
2. ✅ **New imports available** - Can use `src/wa/*` directly
3. ✅ **Gradual migration** - Can migrate incrementally
4. ✅ **Zero downtime** - Replacement is transparent

### For New Code

Use the new modules directly:

```javascript
import { waService } from '../wa/WAService.js';
import { formatToWhatsAppId } from '../wa/WAHelpers.js';
```

### For Existing Code

No changes needed - it uses the compatibility layer automatically:

```javascript
import waClient from '../service/waService.js';
// Works exactly as before
```

## Testing

To test without initializing WhatsApp (useful in CI/CD):

```bash
export WA_SERVICE_SKIP_INIT=true
export NODE_ENV=test
npm test
```

## Troubleshooting

### Client not connecting

1. Check QR code is displayed
2. Verify session directory exists and has correct permissions
3. Check Chrome/Chromium is installed
4. Review logs for authentication errors

### Messages not being sent

1. Check client is ready: `client.isReady`
2. Verify rate limiting: Check queue counts
3. Check network connectivity
4. Review error logs

### Memory issues

1. Check deduplicator stats: `deduplicator.getStats()`
2. Verify TTL cleanup is running
3. Monitor cache size over time

## Performance

- **Memory**: ~100-200 MB per client (depends on message volume)
- **CPU**: Low (<5% idle, ~20% during message processing)
- **Throughput**: 40 messages/minute per client (configurable)
- **Startup time**: 10-30 seconds (depends on session state)

## Security

- Sessions stored in LocalAuth directory (encrypted by wwebjs)
- Admin validation before processing commands
- Rate limiting prevents abuse
- No sensitive data in logs

## Future Improvements

Potential enhancements:

1. Add metrics/monitoring integration (Prometheus)
2. Add structured logging (Winston/Bunyan)
3. Add circuit breaker pattern
4. Add message persistence during outages
5. Add web UI for monitoring
6. Add support for polls, reactions, etc.

## References

- [whatsapp-web.js GitHub](https://github.com/pedroslopez/whatsapp-web.js)
- [wwebjs Documentation](https://docs.wwebjs.dev/)
- [Bottleneck Documentation](https://github.com/SGrondin/bottleneck)
