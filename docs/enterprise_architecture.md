# Cicero Enterprise Architecture
*Last updated: 2026-02-06*

This document provides a high level overview of the architecture behind Cicero, consisting of a **cron job service** (`Cicero_V2`) and a **Next.js dashboard with API** (`Cicero_Web`).

## Overview

- **Cron Job Service**: Node.js background service located in this repository (`Cicero_V2`). All web API endpoints have been removed.
- **Dashboard + API**: Next.js application with API backend located in the [Cicero Web repository](https://github.com/cicero78M/Cicero_Web).
- **Database**: PostgreSQL (with optional support for MySQL or SQLite via the database adapter).
- **Queue**: RabbitMQ for high‑volume asynchronous jobs.
- **Cache/Session**: Redis for caching and session storage.
- **Messaging**: Dual WhatsApp sessions powered by `whatsapp-web.js` (operator-facing `waClient` and broadcast-oriented `waGatewayClient`).
- **External APIs**: Instagram and TikTok data fetched through RapidAPI.

## Components

### Backend Cron Job Service (`Cicero_V2`)

This service runs automated scheduled tasks and background workers. Key modules include:

- `app.js` – Entry point that initializes cron jobs and background workers based on WhatsApp readiness.
- `src/cron` – Scheduled job definitions for data collection, report generation, and notifications.
- `src/service` – Cron helpers, API wrappers, WhatsApp helpers, OTP/email delivery, Google contact sync, RabbitMQ queues, and various utility functions.
- `src/handler` – WhatsApp menu logic, link amplification processors, and fetch helpers for automation.
- `src/repository` – Database helper queries.
- `src/model` – Database models for clients, users, social media posts, metrics, and visitor logs.
- `src/config` – Environment management and Redis connection.

### Frontend Dashboard (`Cicero_Web`)

Located in the separate `Cicero_Web` repository. The dashboard includes its own API backend to serve web requests. Key aspects:

- Built with Next.js 14 using TypeScript and Tailwind CSS.
- Includes API routes for authentication, data retrieval, and user management.
- Pages display analytics views for Instagram and TikTok, user directories, and client info.
- Communicates with PostgreSQL database for data persistence.

## Integration Flow

1. **Background Processing**
   - Cicero_V2 runs scheduled cron jobs to collect Instagram and TikTok data.
   - Data is stored in PostgreSQL and processed by background workers.
   - WhatsApp notifications are sent to administrators based on configured schedules.

2. **Data Access**
   - Dashboard and mobile users access data through the Cicero_Web API backend.
   - API authenticates users and serves data from the shared PostgreSQL database.
   - Both services operate independently but share the same database.

3. **Notifications & Messaging**
   - Cron buckets in Cicero_V2 fetch new posts, calculate stats, and deliver WhatsApp notifications.
   - WhatsApp menus provide interactive access to reports and data exports.
   - OTP emails are dispatched through background workers.

4. **Queue Processing**
   - High‑volume tasks can be published to RabbitMQ for asynchronous processing.
   - Both services can produce and consume queue messages as needed.

## Deployment Considerations

- Cicero_V2 (cron service) and Cicero_Web (dashboard + API) should run as separate processes.
- Environment variables are managed via `.env` files.
- Use PM2 for process management in production.
- Monitor PostgreSQL, Redis, and RabbitMQ health for reliability.

## Diagram

Below is a conceptual diagram of the main components and their interactions:

```
+-------------+      HTTPS       +--------------+
|  Browser    | <--------------> |  Next.js UI  |
+-------------+                  |  + API       |
                                 +--------------+
                                         |
                                         | Database queries
                                         v
                                 +----------------+
                                 |  PostgreSQL DB | <----- Shared database
                                 +----------------+
                                         ^
                                         | Database queries
                                         |
                                 +----------------+
                                 |  Cicero_V2     |
                                 |  Cron Service  |
                                 +----------------+
     |  ^            Redis & RabbitMQ            ^
     |  |--------------------------------------- |
     |        External Services (Instagram, TikTok, WhatsApp, SMTP, Google People API)
     |             via RapidAPI, whatsapp-web.js, Nodemailer, Google SDK
```

The frontend communicates with the Cicero_Web API backend. The Cicero_V2 cron service operates independently, processing data and sending notifications in the background.

Refer to [docs/naming_conventions.md](naming_conventions.md) for code style guidelines.
