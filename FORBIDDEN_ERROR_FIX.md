# WhatsApp 403 Forbidden Error Fix

## Problem
The WhatsApp bot was experiencing continuous retry loops when encountering 403 forbidden errors. These errors occurred when:
- The bot lacked permission to access a group
- The bot was removed from a group
- Group access was restricted

The error logs showed:
```
Error: forbidden
  at groupMetadata (baileys/lib/Socket/groups.js:19:24)
  ...
  data: 403,
  statusCode: 500,
  error: 'Internal Server Error'
```

The system would retry indefinitely, wasting resources and flooding logs.

## Solution
Implemented a comprehensive error classification and handling system:

### 1. WAError Class (`src/wa/WAClient.js`)
- New custom error class to distinguish between retriable and non-retriable errors
- Properties:
  - `isRetriable`: Boolean indicating if the error should be retried
  - `statusCode`: HTTP status code of the error
  - `originalError`: The underlying error object

### 2. Enhanced sendMessage Method (`src/wa/WAClient.js`)
- **Group Validation**: Before sending to groups, validates access by calling `groupMetadata()`
- **Error Classification**: Categorizes errors into retriable and non-retriable based on:
  - Status code (403, 401 are non-retriable)
  - Error message content ("forbidden", "not authorized", "participant")
- **Early Detection**: Catches permission errors before attempting to send

### 3. Updated WAMessageQueue (`src/wa/WAMessageQueue.js`)
- Modified retry logic to check `error.isRetriable` property
- Non-retriable errors (403 forbidden) return `null` to prevent retries
- Retriable errors continue with exponential backoff (up to 3 retries)

## Non-Retriable Error Conditions
The following conditions are classified as non-retriable:
- 403 Forbidden: Bot lacks permission or was removed
- 401 Unauthorized: Authentication issues
- Messages containing "forbidden", "not authorized", or "participant"

## Retriable Error Conditions
All other errors are considered retriable (e.g., network timeouts, temporary service issues).

## Testing
Created comprehensive test suites:
- `tests/waClientForbiddenError.test.js`: Tests WAError class and 403 handling in WAClient
- `tests/waMessageQueueNonRetriable.test.js`: Tests queue behavior with non-retriable errors
- `tests/errorHandlingIntegration.test.js`: Integration tests for the complete flow

All tests pass successfully.

## Benefits
1. **Resource Efficiency**: No more infinite retry loops for permanent failures
2. **Cleaner Logs**: Reduced log spam from repeated failed attempts
3. **Better Error Messages**: Clear indication when bot lacks permissions
4. **Graceful Degradation**: System continues operating despite individual group failures

## Example Behavior

### Before Fix:
```
[wa-client] Error sending message: Error: forbidden
[wa-client] Retrying in 1000ms...
[wa-client] Retrying job (attempt 1)...
[wa-client] Error sending message: Error: forbidden
[wa-client] Retrying in 2000ms...
[wa-client] Retrying job (attempt 2)...
[wa-client] Error sending message: Error: forbidden
[wa-client] Retrying in 3000ms...
[wa-client] Retrying job (attempt 3)...
(continues indefinitely)
```

### After Fix:
```
[wa-client] Warning: Could not verify group access for 120363419830216549@g.us
[wa-client] Cannot send message to group 120363419830216549@g.us: Bot lacks permission or was removed from group
[wa-client] Job failed with non-retriable error: Bot lacks permission or was removed from group
(stops immediately, no retries)
```

## Backward Compatibility
- All changes are backward compatible
- Existing code continues to work without modification
- WAError is exported alongside WAClient for external use if needed
