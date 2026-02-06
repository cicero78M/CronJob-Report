#!/usr/bin/env node

/**
 * WhatsApp Device Pairing Diagnostic Tool
 * 
 * This script checks the current status of WhatsApp device pairing/linking
 * and helps diagnose connection issues.
 * 
 * Usage: node scripts/check-wa-device-pairing.js
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

console.log('\n' + '='.repeat(70));
console.log('WhatsApp Device Pairing Diagnostic Tool');
console.log('='.repeat(70) + '\n');

// Check environment configuration
console.log('📋 Environment Configuration:');
console.log(`  WA_SERVICE_SKIP_INIT: ${process.env.WA_SERVICE_SKIP_INIT || 'not set (will initialize)'}`);
console.log(`  WA_AUTH_DATA_PATH: ${process.env.WA_AUTH_DATA_PATH || 'not set (using default)'}`);
console.log(`  WA_AUTH_CLEAR_SESSION_ON_REINIT: ${process.env.WA_AUTH_CLEAR_SESSION_ON_REINIT || 'false'}`);
console.log(`  GATEWAY_WA_CLIENT_ID: ${process.env.GATEWAY_WA_CLIENT_ID || 'not set'}`);
console.log();

// Resolve auth data path
const DEFAULT_AUTH_DATA_PARENT_DIR = '.cicero';
const DEFAULT_AUTH_DATA_DIR = 'wwebjs_auth';

function resolveAuthDataPath() {
  const configuredPath = (process.env.WA_AUTH_DATA_PATH || '').trim();
  if (configuredPath) {
    return path.resolve(configuredPath);
  }
  const homeDir = os.homedir();
  const baseDir = homeDir || process.cwd();
  return path.resolve(path.join(baseDir, DEFAULT_AUTH_DATA_PARENT_DIR, DEFAULT_AUTH_DATA_DIR));
}

const authDataPath = resolveAuthDataPath();

console.log('📁 Session Storage:');
console.log(`  Auth data path: ${authDataPath}`);

// Check if auth data path exists
try {
  const exists = fs.existsSync(authDataPath);
  console.log(`  Path exists: ${exists ? '✅ Yes' : '❌ No'}`);
  
  if (exists) {
    const stats = fs.statSync(authDataPath);
    console.log(`  Is directory: ${stats.isDirectory() ? '✅ Yes' : '❌ No'}`);
    
    // List session directories
    const entries = fs.readdirSync(authDataPath, { withFileTypes: true });
    const sessionDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('session-'));
    
    console.log(`  Session directories found: ${sessionDirs.length}`);
    
    if (sessionDirs.length > 0) {
      console.log('\n  Session details:');
      sessionDirs.forEach(dir => {
        const sessionPath = path.join(authDataPath, dir.name);
        const clientId = dir.name.replace('session-', '');
        
        console.log(`\n  📱 Session: ${clientId}`);
        console.log(`     Path: ${sessionPath}`);
        
        // Check for lock files
        const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
        const foundLocks = lockFiles.filter(lock => 
          fs.existsSync(path.join(sessionPath, lock))
        );
        
        if (foundLocks.length > 0) {
          console.log(`     ⚠️  Browser locks found: ${foundLocks.join(', ')}`);
          console.log(`     💡 These locks may prevent device pairing`);
          console.log(`     💡 Consider cleaning: rm -rf ${sessionPath}/Singleton*`);
        } else {
          console.log(`     ✅ No browser locks detected`);
        }
        
        // Check session content
        const sessionEntries = fs.readdirSync(sessionPath, { withFileTypes: true });
        const hasContent = sessionEntries.some(e => 
          !['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(e.name)
        );
        
        if (hasContent) {
          console.log(`     ✅ Session has authentication data`);
        } else {
          console.log(`     ⚠️  Session appears empty (may need QR scan)`);
        }
      });
    }
  }
} catch (err) {
  console.log(`  ❌ Error checking path: ${err.message}`);
}

console.log('\n' + '='.repeat(70));
console.log('🔧 Troubleshooting Guide:');
console.log('='.repeat(70));
console.log(`
1. Device Not Linking (Perangkat tidak tertaut):
   → Check for browser lock files (SingletonLock, etc.)
   → Clean locks: cd ${authDataPath} && rm -rf */Singleton*
   → Restart application and scan QR code

2. UNPAIRED Disconnect:
   → Browser locks are automatically cleaned on disconnect
   → Wait for QR code to appear in console
   → Scan QR: Buka WhatsApp > Titik tiga > Perangkat Tertaut

3. Authentication Failure:
   → Remove session directory: rm -rf ${authDataPath}/session-*
   → Restart application
   → Scan fresh QR code

4. Multiple Sessions Conflict:
   → Ensure each client has unique GATEWAY_WA_CLIENT_ID
   → Use lowercase client IDs only
   → Separate sessions per client

5. QR Code Not Appearing:
   → Check logs for initialization errors
   → Verify Chrome/Chromium is installed
   → Check WA_PUPPETEER_EXECUTABLE_PATH if needed

For more help, see: docs/wa_troubleshooting.md
`);

console.log('='.repeat(70) + '\n');

process.exit(0);
