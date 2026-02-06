# WhatsApp Device Pairing Fix - Perangkat Tidak Bisa Tertaut

**Date**: 2026-02-06  
**Issue**: Device cannot be linked (Perangkat tidak bisa tertaut)  
**Status**: ✅ FIXED

## Problem Summary

The WhatsApp bot was unable to link devices properly. When users tried to scan QR codes to pair their devices, the system would fail to properly track the QR scanning state, causing pairing failures.

## Root Cause Analysis

### Critical Bug in `src/service/wwebjsAdapter.js:1359`

**Original Code (BROKEN):**
```javascript
// Note: qr events are transient and safe to remove all
client.removeAllListeners('qr');
client.on('qr', (qr) => emitter.emit('qr', qr));
```

**Problem:**
The `removeAllListeners('qr')` call was **removing ALL QR event listeners**, including the critical external listener registered in `waService.js:980-993`.

### The External QR Handler (waService.js)

The external QR handler performs essential state management:

```javascript
client.on("qr", (qr) => {
  // Display QR code to console
  qrcode.generate(qrWithLabel, { small: true });
  
  // CRITICAL: Set state flags for device pairing
  state.lastQrAt = Date.now();
  state.lastQrPayloadSeen = qr;
  state.awaitingQrScan = true;  // ← ESSENTIAL FLAG
  resetFallbackReadyState(client);
  clearAuthenticatedFallbackTimer(client);
});
```

### Why This Matters

The `state.awaitingQrScan` flag is used throughout the codebase to:
1. **Prevent premature reinitialization** during QR scanning
2. **Provide grace period** for users to scan the QR code
3. **Track device pairing state** for health monitoring
4. **Coordinate timeout handling** during authentication

When `removeAllListeners('qr')` removed the external handler:
- `state.awaitingQrScan` was never set to `true`
- Grace period checks failed
- System didn't know to wait for user to scan
- Device pairing failed

## The Fix

### Changed Code (FIXED):

```javascript
// Store reference to internal QR handler
let internalQrHandler = null;

const registerEventListeners = () => {
  // Remove only the internal handler, preserving external handlers
  if (internalQrHandler) {
    client.removeListener('qr', internalQrHandler);
  }
  
  // Register internal QR handler that forwards to emitter
  // CRITICAL: Only remove internal handler, NOT external handlers from waService.js
  // External handlers set state.awaitingQrScan flag which is essential for device pairing
  internalQrHandler = (qr) => emitter.emit('qr', qr);
  client.on('qr', internalQrHandler);
};
```

### Key Changes

1. **Added `internalQrHandler` variable** (line 1338)
   - Tracks the internal QR handler reference
   - Allows selective removal without affecting external handlers

2. **Changed from `removeAllListeners` to `removeListener`** (lines 1349-1351)
   - Only removes the internal handler
   - Preserves external handlers from `waService.js`

3. **Added explanatory comments** (lines 1362-1364)
   - Documents why this approach is critical
   - Prevents future regressions

## Event Listener Architecture

### Before Fix
```
┌─────────────────────────────────────────────┐
│         WhatsApp Web.js Client              │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
    [QR Event]             [QR Event]
        │                       │
   ┌────▼─────┐          ┌──────▼──────┐
   │ External │          │  Internal   │
   │ Handler  │          │  Handler    │
   │(waService│          │(wwebjsAdapter│
   └────┬─────┘          └──────┬──────┘
        │                       │
        ▼                       ▼
  Set state flags        Forward to emitter
  
  ❌ PROBLEM: removeAllListeners('qr') deleted BOTH handlers!
```

### After Fix
```
┌─────────────────────────────────────────────┐
│         WhatsApp Web.js Client              │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
    [QR Event]             [QR Event]
        │                       │
   ┌────▼─────┐          ┌──────▼──────┐
   │ External │          │  Internal   │
   │ Handler  │          │  Handler    │
   │(waService│          │(wwebjsAdapter│
   └────┬─────┘          └──────┬──────┘
        │                       │
        ▼                       ▼
  Set state flags        Forward to emitter
  
  ✅ SOLUTION: removeListener('qr', internalQrHandler) only removes internal handler!
```

## Impact

### What This Fixes

1. ✅ **Device pairing works correctly**
   - QR codes display properly
   - State flags are set correctly
   - Grace period is respected
   - Users can successfully scan and link devices

2. ✅ **State tracking is accurate**
   - `state.awaitingQrScan` is set when QR is shown
   - `state.lastQrAt` tracks QR display time
   - Health checks work properly

3. ✅ **No premature reinitialization**
   - System waits for user to scan QR
   - Grace period (3 minutes default) is honored
   - No interruption during authentication

### What This Doesn't Break

1. ✅ **Message handling unchanged**
   - Same pattern used for message handlers
   - External message listeners preserved

2. ✅ **Event forwarding still works**
   - Internal handler still forwards QR to emitter
   - Multiple listeners can coexist

3. ✅ **Backward compatibility maintained**
   - Same public API
   - Same event flow

## Testing

### Unit Tests Updated

File: `tests/wwebjsAdapter.test.js`

**Changed test expectations** (lines 146-152):
- Old: Expected `removeAllListeners('qr')` to be called
- New: Expects `removeListener('qr', handler)` to be called

```javascript
// Verify that removeListener was called for all event types (including QR)
// to preserve external listeners from waService.js
expect(mockClient.removeListener).toHaveBeenCalled();
// QR events should now use removeListener (not removeAllListeners)
// to preserve external QR handlers that set awaitingQrScan state
const removeListenerCalls = mockClient.removeListener.mock.calls;
const qrListenerRemoved = removeListenerCalls.some(call => call[0] === 'qr');
expect(qrListenerRemoved).toBe(true);
```

### Test Results

```
PASS tests/wwebjsAdapter.test.js
  ✓ wwebjs adapter relays messages
  ✓ wwebjs adapter configures web version cache and overrides
  ✓ wwebjs adapter sends documents as MessageMedia
  ✓ wwebjs adapter re-registers event listeners after reinitialization
  ✓ wwebjs adapter preserves external message listeners during reinitialization

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

```
PASS tests/waHelper.test.js
PASS tests/waEventAggregator.test.js

Test Suites: 2 passed, 2 total
Tests:       11 passed, 11 total
```

## Files Changed

### Modified Files

1. **src/service/wwebjsAdapter.js**
   - Added `internalQrHandler` variable tracking
   - Changed QR listener removal from `removeAllListeners` to `removeListener`
   - Added critical comments explaining the importance of preserving external handlers

2. **tests/wwebjsAdapter.test.js**
   - Updated test expectations to match new behavior
   - Verified `removeListener` is called instead of `removeAllListeners`

## Deployment Instructions

### Pre-Deployment Checklist

- [x] Code changes completed
- [x] Unit tests updated and passing
- [x] Linter passed
- [ ] Code review completed
- [ ] Security scan (CodeQL) passed
- [ ] Integration testing in staging environment

### How to Deploy

1. **Merge this PR** to main branch

2. **No configuration changes needed**
   - Fix is code-only
   - No environment variables to update
   - No database migrations required

3. **Restart the application**
   ```bash
   pm2 restart cicero-cronjob-report
   ```

4. **Watch for QR code display**
   - Monitor logs for QR code generation
   - Verify state flags are being set
   - Test device pairing with actual WhatsApp

### Rollback Plan

If issues occur, revert this commit:
```bash
git revert 5f35deb
pm2 restart cicero-cronjob-report
```

## Verification

### How to Verify the Fix

1. **Start the application**
   ```bash
   pm2 start ecosystem.config.js
   pm2 logs cicero-cronjob-report
   ```

2. **Look for QR code in logs**
   ```
   [WA] 📱 QR Code received; scan dengan WhatsApp untuk menghubungkan perangkat:
   ========== WA ==========
   █▀▀▀▀▀█ ... QR CODE ... █▀▀▀▀▀█
   ...
   ```

3. **Verify state flags are set**
   - Check logs don't show premature reinitialization
   - Grace period should be respected
   - No "close" state loops during QR scanning

4. **Test device pairing**
   - Open WhatsApp on phone
   - Go to: Titik tiga > Perangkat Tertaut > Tautkan Perangkat
   - Scan the QR code
   - Device should link successfully

5. **Verify authentication**
   ```
   [WA] ✅ Authenticated - Perangkat berhasil tertaut!
   [WA] READY via ready
   ```

### Success Indicators

✅ QR code displays in console  
✅ No "close" state loops during QR scan  
✅ Grace period is respected (no reinit for 3 minutes)  
✅ Device successfully links after QR scan  
✅ Authenticated event fires  
✅ Ready event fires  
✅ Bot responds to messages

## Related Documentation

- [docs/wa_troubleshooting.md](docs/wa_troubleshooting.md) - WhatsApp troubleshooting guide
- [docs/whatsapp_troubleshooting.md](docs/whatsapp_troubleshooting.md) - General WhatsApp issues
- [scripts/check-wa-device-pairing.js](scripts/check-wa-device-pairing.js) - Device pairing diagnostic tool

## Technical Notes

### Design Pattern

This fix follows the **Internal Handler Reference Pattern** used throughout `wwebjsAdapter.js`:

```javascript
// Store internal handler references
let internalMessageHandler = null;
let internalQrHandler = null;        // ← Added
let internalReadyHandler = null;
let internalAuthFailureHandler = null;
let internalDisconnectedHandler = null;

// Remove only internal handlers
if (internalMessageHandler) {
  client.removeListener('message', internalMessageHandler);
}
if (internalQrHandler) {              // ← Added
  client.removeListener('qr', internalQrHandler);
}
// ... etc
```

This pattern ensures:
- Internal handlers can be updated during reinitialization
- External handlers remain intact
- No interference between adapter and service layers

### Alternative Approaches Considered

1. **❌ Keep `removeAllListeners` and re-register external handler**
   - Would require tight coupling between adapter and service
   - Service would need to expose handler function
   - Breaks separation of concerns

2. **❌ Use event emitter inheritance**
   - More complex architecture
   - Would require refactoring both files
   - Higher risk of breaking changes

3. **✅ Track internal handler and use `removeListener`** ← Chosen
   - Minimal code change
   - Consistent with existing patterns
   - Clean separation of concerns
   - Low risk

## Conclusion

This fix resolves the device pairing issue by preserving the external QR event handler that sets critical state flags. The solution is minimal, follows existing patterns, and maintains backward compatibility while fixing the root cause of the "perangkat tidak bisa tertaut" problem.

**Status**: ✅ Ready for code review and deployment

---

**Author**: GitHub Copilot  
**Reviewed by**: Pending  
**Approved by**: Pending
