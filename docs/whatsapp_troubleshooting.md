# WhatsApp Web.js Connection Troubleshooting Guide

## Overview
This guide helps troubleshoot common WhatsApp Web.js connection issues in the Cicero V2 system.

## Common Issues and Solutions

### 1. Client Stuck in "close" State

**Symptoms:**
```
[WA] getState: close
[WA] getState=close; retrying (1/3) in 16731ms
Error: [WA] WhatsApp client not ready after 65000ms
```

**Root Causes:**
- Stale browser locks preventing new connections
- Corrupted authentication session
- Network connectivity issues
- WhatsApp Web version mismatch

**Solutions:**

#### A. Increase Timeout (Recommended First Step)
Add to your `.env` file:
```bash
WA_READY_TIMEOUT_MS=180000          # 3 minutes for admin client
WA_GATEWAY_READY_TIMEOUT_MS=240000  # 4 minutes for gateway
WA_AUTH_READY_TIMEOUT_MS=60000      # 1 minute after auth
WA_FALLBACK_READY_DELAY_MS=90000    # 1.5 minutes between checks
```

#### B. Clear Stale Sessions
The system now automatically cleans stale browser locks on startup. To manually clean:

1. Stop the application
2. Remove session locks:
```bash
cd ~/.cicero/.wwebjs_auth
find . -name "SingletonLock" -delete
find . -name "SingletonSocket" -delete
find . -name "SingletonCookie" -delete
```
3. Restart the application

#### C. Force Session Re-authentication
Set environment variable:
```bash
WA_AUTH_CLEAR_SESSION_ON_REINIT=true
```

Then restart. This will force QR code scan for re-authentication.

#### D. Check Chrome Installation
Verify Chrome/Chromium is installed:
```bash
which google-chrome
which chromium-browser
```

If not installed, install it:
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install chromium-browser

# Or
npx puppeteer browsers install chrome
```

### 2. Connection Timeout Issues

**Symptoms:**
```
[WWEBJS] connect timeout after 180000ms
```

**Solutions:**

#### A. Increase Connect Timeout
```bash
WA_CONNECT_TIMEOUT_MS=300000  # 5 minutes
```

#### B. Adjust Retry Configuration
```bash
WA_WWEBJS_CONNECT_RETRY_ATTEMPTS=5           # More retry attempts
WA_WWEBJS_CONNECT_RETRY_BACKOFF_MS=10000     # 10 seconds initial backoff
WA_WWEBJS_CONNECT_RETRY_BACKOFF_MULTIPLIER=2 # Exponential backoff
```

### 3. Protocol Timeout Errors

**Symptoms:**
```
Runtime.callFunctionOn timed out
```

**Solutions:**
```bash
WA_WWEBJS_PROTOCOL_TIMEOUT_MS=180000          # 3 minutes default
WA_WWEBJS_PROTOCOL_TIMEOUT_MS_GATEWAY=240000  # 4 minutes for gateway
WA_WWEBJS_PROTOCOL_TIMEOUT_MAX_MS=300000      # 5 minutes max
```

### 4. Health Monitoring

**Enable/Configure Health Checks:**
```bash
WA_HEALTH_CHECK_INTERVAL_MS=300000  # Check every 5 minutes
```

Set to `0` to disable health monitoring.

**What Health Checks Do:**
- Monitor connection state every 5 minutes
- Detect stuck "close" states
- Automatically trigger recovery after 5 failed checks
- Clear corrupted sessions when necessary

### 5. Network Issues

**Check Network Connectivity:**
```bash
# Test WhatsApp Web connectivity
curl -I https://web.whatsapp.com

# Test version cache URL
curl https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json
```

**Configure Web Version:**
```bash
WA_WEB_VERSION_CACHE_URL=https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json
WA_WEB_VERSION=2.2412.54  # Specific version if needed
```

### 6. Multiple Instance Issues

**Symptoms:**
```
Browser lock still active
Shared session lock detected
```

**Solutions:**

#### Use Unique Client IDs
Ensure each instance has unique IDs:
```bash
USER_WA_CLIENT_ID=wa-userrequest-prod-instance1
GATEWAY_WA_CLIENT_ID=wa-gateway-prod-instance1
```

#### Use Separate Auth Paths
```bash
# Instance 1
WA_AUTH_DATA_PATH=/app/wwebjs_auth_instance1

# Instance 2
WA_AUTH_DATA_PATH=/app/wwebjs_auth_instance2
```

#### Or Configure Fallback Paths
```bash
WA_WWEBJS_FALLBACK_USER_DATA_DIR_SUFFIX=worker-${PM2_INSTANCE_ID}
```

## Best Practices

### 1. Production Configuration
```bash
# Recommended production settings
WA_READY_TIMEOUT_MS=180000
WA_GATEWAY_READY_TIMEOUT_MS=240000
WA_HEALTH_CHECK_INTERVAL_MS=300000
WA_CONNECT_TIMEOUT_MS=180000
WA_WWEBJS_CONNECT_RETRY_ATTEMPTS=3
WA_AUTH_CLEAR_SESSION_ON_REINIT=false
```

### 2. Development Configuration
```bash
# For faster development cycles
WA_READY_TIMEOUT_MS=120000
WA_GATEWAY_READY_TIMEOUT_MS=120000
WA_HEALTH_CHECK_INTERVAL_MS=60000
WA_DEBUG_LOGGING=true
```

### 3. Testing Configuration
```bash
# For testing (skip WhatsApp init)
WA_SERVICE_SKIP_INIT=true
NODE_ENV=test
```

### 4. Monitoring and Logging

**Enable Debug Logging:**
```bash
WA_DEBUG_LOGGING=true
```

**Monitor Health:**
```bash
# Check logs for health check status
grep "HEALTH CHECK" logs/*.log

# Check connection state
grep "getState:" logs/*.log | tail -20
```

### 5. Recovery Procedures

**Quick Recovery Steps:**
1. Check logs for error patterns
2. Identify stuck client (WA, WA-USER, or WA-GATEWAY)
3. Try increasing timeouts first
4. Clear stale locks if needed
5. Force re-authentication as last resort

**Full Recovery (Nuclear Option):**
```bash
# 1. Stop application
pm2 stop cicero-cronjob-report

# 2. Backup current sessions
cp -r ~/.cicero/.wwebjs_auth ~/.cicero/.wwebjs_auth.backup

# 3. Remove all sessions
rm -rf ~/.cicero/.wwebjs_auth

# 4. Restart and scan QR codes
pm2 start cicero-cronjob-report

# 5. Watch logs
pm2 logs cicero-cronjob-report
```

## Diagnostic Commands

**Check Current State:**
```bash
# Via API
curl http://localhost:3000/api/wa/readiness

# From logs
tail -100 logs/combined.log | grep -E "getState|ready|close"
```

**Monitor Connection:**
```bash
# Real-time monitoring
pm2 logs cicero-cronjob-report | grep -E "WA|close|ready"

# Count connection issues
grep "getState: close" logs/*.log | wc -l
```

**Check Session Files:**
```bash
# List sessions
ls -la ~/.cicero/.wwebjs_auth/

# Check for locks
find ~/.cicero/.wwebjs_auth -name "Singleton*"
```

## Performance Tuning

### For Slow Connections
```bash
WA_READY_TIMEOUT_MS=300000           # 5 minutes
WA_GATEWAY_READY_TIMEOUT_MS=360000   # 6 minutes
WA_FALLBACK_READY_DELAY_MS=120000    # 2 minutes
```

### For Fast Connections
```bash
WA_READY_TIMEOUT_MS=120000          # 2 minutes
WA_GATEWAY_READY_TIMEOUT_MS=150000  # 2.5 minutes
WA_FALLBACK_READY_DELAY_MS=60000    # 1 minute
```

### For High Load Systems
```bash
WA_WWEBJS_PROTOCOL_TIMEOUT_MS_GATEWAY=300000  # 5 minutes
WA_HEALTH_CHECK_INTERVAL_MS=180000            # 3 minutes
```

## Common Error Messages and Fixes

| Error | Cause | Solution |
|-------|-------|----------|
| `WhatsApp client not ready after Xms` | Timeout too short | Increase `WA_READY_TIMEOUT_MS` |
| `connect timeout after Xms` | Connection slow | Increase `WA_CONNECT_TIMEOUT_MS` |
| `Browser lock still active` | Multiple instances | Use unique `WA_AUTH_DATA_PATH` |
| `Chrome executable not found` | Missing Chrome | Install Chrome/Chromium |
| `Runtime.callFunctionOn timed out` | Protocol timeout | Increase `WA_WWEBJS_PROTOCOL_TIMEOUT_MS` |
| `getState: close` persisting | Stale session | Clear sessions and restart |

## Support

For persistent issues:
1. Enable debug logging: `WA_DEBUG_LOGGING=true`
2. Collect logs from last 24 hours
3. Note your configuration (`.env` settings)
4. Check GitHub issues: https://github.com/cicero78M/CronJob-Report/issues

## Version Information

This troubleshooting guide applies to:
- whatsapp-web.js: ^1.23.0
- Node.js: v20+
- Puppeteer: ^18.2.1

Last updated: 2026-02-06
