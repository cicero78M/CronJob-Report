# Cicero Repository Suite Overview
*Last updated: 2026-02-06*

This document summarizes the three main repositories that make up the **Cicero** platform. Each repository has a specific role, but all work together to provide social media monitoring and reporting.

## Repositories

### 1. Cicero_V2 (Backend Cron Job Service)
- [GitHub: cicero78M/Cicero_V2](https://github.com/cicero78M/Cicero_V2)
- Node.js cron job service for automated social media monitoring, WhatsApp messaging orchestration, and background data processing.
- **Note:** All web API endpoints have been removed. This is now a pure background service.
- Maintains two WhatsApp sessions (`waClient` and `waGatewayClient`) for operator menus and directorate broadcasts.
- Cron buckets are activated when each WhatsApp session is ready, covering Instagram/TikTok ingestion, link amplification (reguler & khusus), directorate recaps, and database backups.
- OTP emails for data-claim flows are delivered via SMTP through background workers.
- See [enterprise_architecture.md](enterprise_architecture.md) for architecture details.

### 2. Cicero_Web (Dashboard with API Backend)
- [GitHub: cicero78M/Cicero_Web](https://github.com/cicero78M/Cicero_Web)
- Next.js dashboard repository with its own API backend.
- The web dashboard now includes its own API layer to serve frontend requests.
- Pages display Instagram and TikTok analytics as well as user directories.
- Configured through environment variables.

### 3. pegiat_medsos_apps (Android App)
- GitHub repository for the mobile client (pegiat_medsos_apps).
- Lightweight Android application for field agents.
- Communicates with the Cicero_Web API backend.

## Integration Flow
1. The Cicero_V2 service runs automated background tasks for data collection and processing.
2. Scheduled jobs in the backend collect posts and metrics, generate directorate recaps, and send WhatsApp reminders/reports once the associated WhatsApp client signals readiness.
3. Heavy tasks are processed asynchronously using background workers and queues.
4. The dashboard and Android app interact with the Cicero_Web API backend (separate from this cron job service).
5. WhatsApp menus provide interactive access to reports and data exports.

Together these repositories form a complete system: the Cicero_V2 backend orchestrates data collection and messaging as a background service, while the Cicero_Web provides web API and dashboard interfaces for users.
