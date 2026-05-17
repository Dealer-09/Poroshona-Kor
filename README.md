# Digital Autopilot Detector

Digital Autopilot Detector is an end-to-end system designed to help you break free from doomscrolling and regain your focus. It uses a Chrome Extension to track your behavioral signals (e.g. scroll velocity, tab switching) and a NestJS backend powered by Gemini and Groq AI models to intervene when your "Autopilot Score" crosses critical thresholds.

## Architecture
- **apps/api**: NestJS backend with WebSocket integration, Prisma ORM, BullMQ for job queues, and pgvector.
- **apps/web**: Next.js 15 dashboard to visualize your cognitive drift and session history.
- **apps/extension**: Chrome MV3 Extension built with Vite to track signals passively and display interventions.
- **packages/shared**: Shared TypeScript definitions across the monorepo.

## Prerequisites
- [Bun](https://bun.sh/) installed locally
- Docker (for local Postgres & Redis)
- A Supabase project (if not running Postgres locally)

## Setup & Running Locally

1. **Install dependencies:**
   ```bash
   bun install
   ```

2. **Environment Variables:**
   Copy the example environment files for the API and Web apps.
   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```
   **Important:** You must populate `GEMINI_API_KEY` and `GROQ_API_KEY` in `apps/api/.env`.

3. **Start the local database (Postgres/Redis):**
   *(Assuming you have a docker-compose.yml set up, or just use external URLs)*
   ```bash
   make dev-deps
   ```

4. **Run the development servers:**
   ```bash
   bun run dev
   ```
   This uses Turborepo to spin up the API, Web dashboard, and rebuild the extension in watch mode.

## Loading the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (top right corner).
3. Click **Load unpacked**.
4. Select the `apps/extension/dist` folder in this project directory.
5. You can now use the extension popup to set your intent and start a session!
