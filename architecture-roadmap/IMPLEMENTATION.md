# Digital Autopilot Detector — Implementation Guide

> Build this day by day, phase by phase. Each task is scoped to ~1–3 hours of AI-assisted coding.
> Commit after every task. Never skip a phase — each one builds the foundation for the next.

---

## Project Structure (Turborepo Monorepo)

```
autopilot-detector/
├── apps/
│   ├── api/              # NestJS backend
│   ├── web/              # Next.js 14 dashboard
│   └── extension/        # Chrome Extension MV3
├── packages/
│   └── shared/           # Shared TypeScript types & constants
├── ml-service/           # Python FastAPI (separate, lives outside monorepo)
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

---

## Phase 0 — Monorepo Scaffold
> Goal: One command spins up the entire project. Nothing broken at the start.

### Task 0.1 — Init Turborepo + pnpm workspaces
```
Prompt to AI:
"Set up a Turborepo monorepo with pnpm workspaces.
Workspaces: apps/api, apps/web, apps/extension, packages/shared.
Root turbo.json with pipelines: build, dev, lint, test.
Root package.json with scripts: dev (turbo run dev), build, lint.
Add .gitignore for node_modules, dist, .env, .turbo."
```
**Commit:** `chore: init turborepo monorepo with pnpm workspaces`

---

### Task 0.2 — Shared package: TypeScript types
```
Prompt to AI:
"Create packages/shared with TypeScript.
Export these types:
- BehavioralSignal { scrollVelocity, tabSwitchCount, clickRate,
  passiveTime, activeTime, timestamp, sessionId, userId }
- AutopilotScore { score, focusFragmentation, passiveRatio,
  cognitiveD rift, doomscrollProbability, timestamp }
- InterventionEvent { type, trigger, message, sessionId, timestamp }
- InterventionType enum: NUDGE | PAUSE | REFLECTION | SLEEP_MODE
- AppIntent enum: STUDY | TUTORIAL | ENTERTAINMENT | RELAXATION | AVOIDING_WORK
Configure tsconfig.json with strict mode and declaration emit."
```
**Commit:** `feat(shared): add core behavioral types and enums`

---

### Task 0.3 — Husky + ESLint + Prettier
```
Prompt to AI:
"Add Husky pre-commit hooks to the monorepo root.
ESLint with @typescript-eslint, prettier plugin.
Prettier config: single quotes, 2 spaces, trailing commas.
Husky runs lint-staged on commit: lint + format changed files only.
Add .eslintrc and .prettierrc at repo root."
```
**Commit:** `chore: add husky, eslint, prettier`

---

## Phase 1 — NestJS API Foundation
> Goal: A running API with auth, WebSocket gateway, and signal ingestion endpoint.

### Task 1.1 — Scaffold NestJS app
```
Prompt to AI:
"Scaffold a NestJS app in apps/api using @nestjs/cli.
Modules to create: AppModule, AuthModule, SignalsModule, SessionsModule.
Install: @nestjs/jwt, @nestjs/passport, passport-jwt, bcrypt,
@nestjs/websockets, @nestjs/platform-socket.io, socket.io.
Add .env.example with: DATABASE_URL, JWT_SECRET, REDIS_URL, PORT.
Configure ConfigModule globally with validation."
```
**Commit:** `feat(api): scaffold nestjs with modules and deps`

---

### Task 1.2 — Supabase + Prisma setup
```
Prompt to AI:
"Set up Prisma ORM in apps/api connected to Supabase Postgres.
Schema models:
- User { id uuid, email, createdAt, sessions Session[] }
- Session { id uuid, userId, startedAt, endedAt, appOpened,
  declaredIntent AppIntent, scores AutopilotScore[], interventions Intervention[] }
- AutopilotScore { id, sessionId, score Float, focusFragmentation Float,
  passiveRatio Float, cognitiveDrift Float, doomscrollProbability Float,
  timestamp DateTime }
- Intervention { id, sessionId, type, message, triggeredAt DateTime }
- SessionEmbedding { id, sessionId, embedding Unsupported('vector(1536)') }
Run: prisma migrate dev."
```
**Commit:** `feat(api): add prisma schema with supabase postgres`

---

### Task 1.3 — JWT Auth (register + login)
```
Prompt to AI:
"Implement JWT auth in NestJS AuthModule.
POST /auth/register — hash password with bcrypt, create user, return JWT.
POST /auth/login — validate credentials, return JWT.
JwtAuthGuard using passport-jwt strategy.
JwtPayload type: { sub: userId, email }.
Protect all future routes with JwtAuthGuard by default.
Use @nestjs/config for JWT_SECRET."
```
**Commit:** `feat(api): jwt auth with register and login`

---

### Task 1.4 — WebSocket gateway for signal ingestion
```
Prompt to AI:
"Create SignalsGateway in NestJS using @nestjs/websockets and socket.io.
Events to handle:
- 'signal:batch' — receives BehavioralSignal[], validates with class-validator,
  stores in Redis with key session:{sessionId}:signals as a rolling buffer (last 100).
- 'session:start' — creates Session record in Postgres, emits 'session:created'.
- 'session:end' — closes session, emits 'session:ended'.
Authenticate WebSocket connections using JWT from handshake auth header.
Import SignalsModule types from packages/shared."
```
**Commit:** `feat(api): websocket gateway for signal ingestion`

---

### Task 1.5 — Autopilot score heuristic engine
```
Prompt to AI:
"Create AutopilotScoreService in NestJS SignalsModule.
Method: computeScore(signals: BehavioralSignal[]): AutopilotScore
Formula:
- scrollVelocity = avg scroll speed from last 20 signals (0–1 normalized)
- tabSwitchRate = tabSwitchCount / timeWindowMinutes
- passiveRatio = passiveTime / (passiveTime + activeTime)
- cognitiveDrift = tabSwitchRate * 0.4 + passiveRatio * 0.6
- doomscrollProbability = (scrollVelocity * 0.3 + passiveRatio * 0.4 + tabSwitchRate * 0.3)
- score = doomscrollProbability * 100 (0–100)
Thresholds: score > 60 = NUDGE, > 75 = PAUSE, > 85 = REFLECTION.
Save AutopilotScore to Postgres after every 10 signal batches.
Emit 'score:update' back to the client via WebSocket."
```
**Commit:** `feat(api): heuristic autopilot score engine`

---

### Task 1.6 — BullMQ + Redis queue setup
```
Prompt to AI:
"Set up BullMQ in NestJS with Redis.
Install: bullmq, @nestjs/bullmq, ioredis.
Create two queues:
- 'ai-intervention' — processes LLM intervention generation jobs
- 'embedding' — processes session embedding jobs for pgvector
Queue processor for 'ai-intervention': receives { sessionId, score, signals[] },
calls InterventionService (stub for now), saves result.
Add BullMQ dashboard via @bull-board/nestjs at /admin/queues (dev only).
Configure retry: 3 attempts, exponential backoff."
```
**Commit:** `feat(api): bullmq queues for ai and embedding jobs`

---

## Phase 2 — Chrome Extension
> Goal: Extension tracks real behavioral signals and streams them to the API.

### Task 2.1 — Extension scaffold (MV3)
```
Prompt to AI:
"Scaffold a Chrome Extension Manifest V3 in apps/extension.
manifest.json:
- permissions: tabs, activeTab, storage, scripting, alarms
- background service worker: background.ts
- content scripts: content.ts (matches all URLs)
- popup: popup.html + popup.ts
Build with Vite + vite-plugin-web-extension.
TypeScript strict mode.
Import BehavioralSignal type from packages/shared."
```
**Commit:** `feat(extension): scaffold chrome mv3 extension with vite`

---

### Task 2.2 — Content script: behavioral signal tracking
```
Prompt to AI:
"In apps/extension/content.ts, track these signals every 2 seconds:
- scrollVelocity: measure pixels scrolled per second using window scroll events
- passiveTime: time with no click/keydown/scroll (idle detection)
- activeTime: time with interaction events
- clickRate: click count in last 10 seconds
Batch signals into arrays of 10, send to background script via chrome.runtime.sendMessage.
Use requestAnimationFrame for scroll tracking, not setInterval.
Clean up all event listeners on page unload."
```
**Commit:** `feat(extension): content script signal tracking`

---

### Task 2.3 — Background service worker: tab tracking + WebSocket
```
Prompt to AI:
"In apps/extension/background.ts:
Tab tracking:
- Listen to chrome.tabs.onActivated and chrome.tabs.onUpdated
- Track tabSwitchCount per session (reset every 30 minutes)
- Detect rapid tab switching: >5 switches in 60 seconds
WebSocket connection:
- Connect to NestJS WebSocket on extension install/startup
- Read JWT from chrome.storage.local
- Receive signal batches from content script via chrome.runtime.onMessage
- Emit 'signal:batch' to server with merged signals (content + tab data)
- Reconnect on disconnect with exponential backoff (max 30s)"
```
**Commit:** `feat(extension): background worker with tab tracking and websocket`

---

### Task 2.4 — Intent prompt popup
```
Prompt to AI:
"Build the extension popup (popup.html + popup.ts).
When user clicks extension icon:
- Show: 'Why are you opening this?' with AppIntent buttons:
  Study | Tutorial | Entertainment | Relaxation | Avoiding Work
- On selection: store intent in chrome.storage.session,
  emit 'session:start' to background with { appOpened: currentTabUrl, declaredIntent }
- Show current autopilot score (0–100) with a color indicator:
  green < 40, amber 40–70, red > 70
- Listen for 'score:update' messages from background to refresh score live.
Simple clean UI. No frameworks, just vanilla TS."
```
**Commit:** `feat(extension): intent prompt popup with live score`

---

### Task 2.5 — Intervention notification
```
Prompt to AI:
"In background.ts, listen for 'intervention:trigger' from the server via WebSocket.
For NUDGE: use chrome.notifications.create with the intervention message.
For PAUSE: inject a content script overlay that dims the page 80% and shows the
  message with two buttons: 'Continue intentionally' or 'Close tab'.
For REFLECTION: open a side panel (chrome.sidePanel) with the reflection message.
For SLEEP_MODE: reduce notification to a gentle badge on the extension icon only.
Store all interventions in chrome.storage.local for dashboard access."
```
**Commit:** `feat(extension): intervention notification system`

---

## Phase 3 — AI Intervention Layer (RAG)
> Goal: LLM generates personalized interventions using past session context via pgvector.

### Task 3.1 — pgvector: session embedding pipeline
```
Prompt to AI:
"Enable pgvector in Supabase. Run SQL: CREATE EXTENSION IF NOT EXISTS vector;
Alter SessionEmbedding table: embedding vector(1536).
Create EmbeddingService in NestJS:
- generateEmbedding(session): calls OpenAI text-embedding-3-small API
  with a summary of the session signals (avg score, intent, drift pattern)
- storeEmbedding(sessionId, embedding): upsert into SessionEmbedding
- findSimilarSessions(embedding, userId, limit=3): raw SQL with pgvector
  cosine similarity: ORDER BY embedding <=> $1 LIMIT $2
  filtered by userId for personalization.
Trigger embedding job from BullMQ 'embedding' queue after each session ends."
```
**Commit:** `feat(api): pgvector session embedding and similarity search`

---

### Task 3.2 — LLM intervention generator
```
Prompt to AI:
"Create InterventionService in NestJS.
Method: generateIntervention(sessionId, score, signals): Promise<InterventionEvent>
Steps:
1. Get current session from Postgres (intent, duration, appOpened)
2. Generate embedding of current session state
3. Find top 3 similar past sessions via pgvector similarity search
4. Build RAG prompt:
   System: 'You are a gentle digital wellbeing coach. Be concise, non-judgmental,
   and specific. Max 2 sentences.'
   User: 'User intended to {intent} on {app}.
   Current autopilot score: {score}/100.
   Past similar sessions led to: {past session outcomes}.
   Generate a contextual nudge.'
5. Call Claude API (claude-sonnet-4-20250514), max_tokens 150
6. Save Intervention to Postgres, return InterventionEvent
Enqueue from BullMQ 'ai-intervention' queue."
```
**Commit:** `feat(api): rag-powered llm intervention generator`

---

### Task 3.3 — Dynamic intervention timing
```
Prompt to AI:
"Create InterventionTimingService in NestJS.
Logic to decide when and what type to trigger:
- Score 60–74 AND first time today: NUDGE
- Score 75–84 OR score crossed 60 three times: PAUSE
- Score > 85 OR session > 90 minutes: REFLECTION
- Time between 11pm–6am AND score > 50: SLEEP_MODE (override all others)
- Cooldown: no intervention within 15 minutes of last one
- Never trigger during active typing (activeTime dominant in last 30s)
Store last intervention timestamp per user in Redis.
Emit 'intervention:trigger' to client via WebSocket after generating message."
```
**Commit:** `feat(api): dynamic intervention timing engine`

---

## Phase 4 — Next.js Dashboard
> Goal: A reflection dashboard showing live score, drift patterns, and AI chat.

### Task 4.1 — Next.js 14 scaffold + auth
```
Prompt to AI:
"Scaffold Next.js 14 app in apps/web with App Router.
Install: next-auth v5, @supabase/supabase-js, tailwindcss, framer-motion,
recharts, lucide-react, socket.io-client.
Configure next-auth with credentials provider (calls NestJS /auth/login).
Middleware to protect all routes except /login.
Tailwind config with custom colors matching the product (dark theme preferred).
Layout.tsx with sidebar navigation:
  Dashboard | Sessions | Interventions | AI Reflection"
```
**Commit:** `feat(web): scaffold next.js 14 with auth and layout`

---

### Task 4.2 — Live autopilot score widget
```
Prompt to AI:
"Create LiveScoreWidget component in apps/web.
- Connect to NestJS WebSocket using socket.io-client on mount
- Authenticate with JWT from next-auth session
- Listen for 'score:update' events
- Display score 0–100 as a circular gauge (SVG, animated with framer-motion)
- Color: green (#22c55e) 0–40, amber (#f59e0b) 40–70, red (#ef4444) 70–100
- Show sub-metrics below: Focus Fragmentation, Passive Ratio, Cognitive Drift
  each as small labeled bars
- Animate score changes smoothly (spring animation, 600ms)
- Show 'Intentional' badge when score < 30 for > 5 minutes"
```
**Commit:** `feat(web): live autopilot score widget with websocket`

---

### Task 4.3 — Drift timeline chart
```
Prompt to AI:
"Create DriftTimeline component using Recharts.
Fetch /api/sessions/:id/scores (NestJS endpoint, paginated).
AreaChart showing autopilot score over time for the current session.
- X axis: time (HH:mm)
- Y axis: score 0–100
- Reference line at 60 (nudge threshold) and 75 (pause threshold)
- Dots on intervention events (different colors per type)
- Tooltip showing score, dominant signal, and intervention if any
- Animate on mount with Recharts animationDuration 800ms
Add NestJS endpoint: GET /sessions/:id/scores returns AutopilotScore[]"
```
**Commit:** `feat(web): drift timeline chart with intervention markers`

---

### Task 4.4 — Session history + app influence table
```
Prompt to AI:
"Create SessionsPage in apps/web at /sessions.
Table of past sessions (server component, fetches from NestJS):
Columns: Date | App | Declared Intent | Actual Behavior | Peak Score | Interventions
'Actual Behavior' = inferred from signals: Study / Entertainment / Doomscrolling / Mixed
'App Influence' section below table:
  Bar chart (Recharts) showing average peak score per app domain
  e.g. YouTube: 82, Twitter: 91, Reddit: 78
Add NestJS endpoint: GET /sessions?userId returns Session[] with scores joined."
```
**Commit:** `feat(web): session history and app influence analysis`

---

### Task 4.5 — AI Reflection chat
```
Prompt to AI:
"Create ReflectionChat component in apps/web.
Chat interface (not a full page, a slide-over panel triggered from dashboard).
Calls NestJS POST /reflection/chat endpoint.
NestJS endpoint:
- Accepts { message, sessionId }
- Fetches session context from Postgres
- Finds similar past sessions via pgvector
- Calls Claude API with system prompt:
  'You are a digital wellbeing coach. Use the session data to give specific,
  actionable insights. Be warm, not preachy. Reference specific patterns.'
- Streams response back using Server-Sent Events
Frontend: render streaming tokens as they arrive using ReadableStream.
Show quick prompt chips: 'Why do I doomscroll?', 'What triggers my drift?',
'How was my focus today?'"
```
**Commit:** `feat(web): ai reflection chat with streaming`

---

### Task 4.6 — Cognitive health meter + heatmap
```
Prompt to AI:
"Create CognitiveHealthMeter component.
Weekly heatmap (7 columns x 24 rows = days x hours):
- Each cell = average autopilot score for that hour of that day
- Color scale: green → amber → red
- Hover tooltip: 'Tuesday 11pm: avg score 87, 3 interventions'
Fetch from NestJS: GET /analytics/heatmap?userId&weeks=4
Returns matrix: { day: 0-6, hour: 0-23, avgScore, interventionCount }[]
Also show 'Healthiest day' and 'Riskiest hour' summary cards below.
Use CSS grid for heatmap, framer-motion for cell reveal animation on mount."
```
**Commit:** `feat(web): cognitive health heatmap and summary cards`

---

## Phase 5 — Polish, Error Handling & Dev Experience
> Goal: Production-ready error handling, logging, and local dev setup.

### Task 5.1 — NestJS global error handling + logging
```
Prompt to AI:
"Add to NestJS apps/api:
- Global exception filter: catches all unhandled errors, logs them,
  returns { error, message, statusCode } JSON.
- Pino logger via nestjs-pino (fast structured JSON logging).
- Request/response logging middleware (method, path, duration, statusCode).
- Winston transport for errors only → logs/error.log.
- Health check endpoint: GET /health returns { status, db, redis, timestamp }.
  Checks Prisma connection and Redis ping."
```
**Commit:** `feat(api): global error handling, pino logging, health check`

---

### Task 5.2 — Rate limiting + security
```
Prompt to AI:
"Add to NestJS apps/api:
- Rate limiting with @nestjs/throttler: 100 req/min per IP globally,
  stricter on /auth routes: 10 req/min.
- Helmet for security headers.
- CORS configured for apps/web origin only.
- WebSocket connection limit: max 5 concurrent connections per userId.
- Input validation: all DTOs use class-validator decorators.
- Sanitize all string inputs with class-sanitizer."
```
**Commit:** `feat(api): rate limiting, helmet, cors, validation`

---

### Task 5.3 — Docker Compose for local dev
```
Prompt to AI:
"Create docker-compose.yml at repo root for local development:
Services:
- postgres: postgres:16-alpine, port 5432, with pgvector extension init script
- redis: redis:7-alpine, port 6379
- (no app containers — apps run with pnpm dev outside Docker)
Add init SQL script: CREATE EXTENSION IF NOT EXISTS vector;
Update .env.example with docker-compose connection strings.
Add Makefile with commands:
  make dev-deps — starts postgres + redis
  make stop — stops all
  make reset-db — drops and recreates postgres volume"
```
**Commit:** `chore: docker-compose for local postgres and redis`

---

### Task 5.4 — Turbo dev pipeline
```
Prompt to AI:
"Configure turbo.json so 'pnpm dev' starts all apps in the right order:
1. packages/shared (tsc --watch)
2. apps/api (nest start --watch) — depends on shared
3. apps/web (next dev) — depends on shared
4. apps/extension (vite build --watch) — depends on shared
Set up turbo pipeline with dependsOn correctly.
Add a root-level dev script in package.json.
Document in README.md: prerequisites (pnpm, Docker), setup steps,
how to load the extension in Chrome (chrome://extensions → load unpacked → apps/extension/dist)"
```
**Commit:** `chore: turbo dev pipeline and readme setup`

---

### Task 5.5 — Environment validation
```
Prompt to AI:
"Add runtime environment validation to apps/api using Zod.
Validate on startup: DATABASE_URL, JWT_SECRET, REDIS_URL, OPENAI_API_KEY
  (or ANTHROPIC_API_KEY), PORT.
If any missing: throw descriptive error listing which vars are absent, then exit.
Add same to apps/web using Next.js env validation pattern with Zod.
Add to packages/shared: EnvSchema type so both apps share the contract."
```
**Commit:** `feat: runtime env validation with zod`

---

## Phase 6 — ML Microservice (Python)
> Goal: A FastAPI service that replaces the heuristic score with a trained model.
> Only build this once you have real session data (50+ sessions minimum).

### Task 6.1 — FastAPI scaffold
```
Prompt to AI:
"Create ml-service/ directory (outside the monorepo).
FastAPI app with:
- POST /predict — accepts BehavioralSignalBatch, returns AutopilotScorePrediction
- GET /health
- POST /train — triggers model retraining (protected by API key)
Dependencies in requirements.txt:
  fastapi, uvicorn, scikit-learn, numpy, pandas, joblib, pydantic
BehavioralSignalBatch: list of { scrollVelocity, tabSwitchRate,
  passiveRatio, clickRate, timestamp } (last 60 signals)
Run: uvicorn main:app --reload"
```
**Commit:** `feat(ml): fastapi scaffold with predict endpoint`

---

### Task 6.2 — Data export from Postgres
```
Prompt to AI:
"Create a Python script ml-service/scripts/export_training_data.py.
Connects to Supabase Postgres via psycopg2.
Exports: all AutopilotScore records joined with Session (intent, appOpened)
  and the preceding BehavioralSignal window.
Label: score > 75 = 1 (autopilot), else 0.
Saves to ml-service/data/training.csv with columns:
  scrollVelocity_mean, scrollVelocity_std, tabSwitchRate,
  passiveRatio, clickRate_mean, sessionDuration, label
Prints: total rows, class balance."
```
**Commit:** `feat(ml): training data export script`

---

### Task 6.3 — Train XGBoost classifier
```
Prompt to AI:
"Create ml-service/train.py.
Load data/training.csv.
Features: scrollVelocity_mean, scrollVelocity_std, tabSwitchRate,
  passiveRatio, clickRate_mean, sessionDuration.
Target: label (binary).
Train XGBoost classifier with cross-validation (5-fold).
Print: accuracy, precision, recall, F1, AUC-ROC.
Save model with joblib to models/autopilot_classifier.joblib.
Save feature names and threshold to models/config.json.
Add confusion matrix output."
```
**Commit:** `feat(ml): xgboost classifier training script`

---

### Task 6.4 — Wire ML service into NestJS
```
Prompt to AI:
"In NestJS apps/api, create MlService.
Method: predictScore(signals: BehavioralSignal[]): Promise<number>
- Aggregates signals into feature vector matching training data schema
- POST to ML_SERVICE_URL/predict with feature vector
- Returns predicted doomscroll probability (0–1) * 100
- Falls back to heuristic score if ML service is unavailable (circuit breaker pattern)
Add ML_SERVICE_URL to .env.example.
Update AutopilotScoreService to use MlService when available,
log which scorer was used (ml vs heuristic)."
```
**Commit:** `feat(api): wire ml microservice with heuristic fallback`

---

## Phase 7 — Testing
> Goal: Confidence that the core behavioral pipeline works correctly.

### Task 7.1 — Unit tests: score engine
```
Prompt to AI:
"Write Jest unit tests for AutopilotScoreService in apps/api.
Test cases:
- Low signals (all zeros) → score near 0
- High scroll velocity + high passive ratio → score > 75
- Late night (11pm) signals → doomscrollProbability boosted
- Active typing dominant → score suppressed
- Threshold crossing: score 74 → NUDGE, 76 → PAUSE, 86 → REFLECTION
Use @nestjs/testing TestingModule."
```
**Commit:** `test(api): unit tests for autopilot score engine`

---

### Task 7.2 — Integration test: signal ingestion pipeline
```
Prompt to AI:
"Write a Jest integration test for the signal ingestion flow in apps/api.
Use supertest for HTTP and a test WebSocket client (socket.io-client).
Test flow:
1. Register user → get JWT
2. Connect WebSocket with JWT
3. Emit 'session:start' with intent
4. Emit 10x 'signal:batch' with escalating scroll velocity
5. Assert 'score:update' received with score > 0
6. Assert score saved to test Postgres DB
7. Emit 'session:end', assert session closed
Use a separate test DB (TEST_DATABASE_URL in .env.test)."
```
**Commit:** `test(api): integration test for signal ingestion pipeline`

---

### Task 7.3 — E2E test: extension → API → intervention
```
Prompt to AI:
"Write a Playwright E2E test simulating the full autopilot detection flow.
Mock the Chrome Extension APIs (use a test page that sends signals directly).
Test:
1. User opens test page, sets intent to 'Study'
2. Page simulates doomscrolling signals for 60 seconds
3. Assert intervention notification appears in the dashboard
4. Assert intervention saved in DB
5. Assert pgvector embedding created for the session
Run with: playwright test (add to turbo pipeline)."
```
**Commit:** `test: e2e test for full autopilot detection flow`

---

## Phase 8 — Deployment
> Goal: Live, accessible, secure deployment.

### Task 8.1 — Deploy NestJS API to Railway
```
Prompt to AI:
"Create Dockerfile for apps/api.
Multi-stage build:
- Stage 1 (builder): node:20-alpine, install deps, build NestJS
- Stage 2 (runner): node:20-alpine, copy dist, run node dist/main
Add .dockerignore.
Create railway.json for Railway deployment config.
Add GitHub Actions workflow .github/workflows/deploy-api.yml:
  On push to main: build Docker image, deploy to Railway.
Add production environment variables list to README."
```
**Commit:** `chore: dockerfile and railway deployment for api`

---

### Task 8.2 — Deploy Next.js to Vercel
```
Prompt to AI:
"Configure apps/web for Vercel deployment.
vercel.json with build command and output directory for monorepo.
Add .github/workflows/deploy-web.yml:
  On push to main: deploy to Vercel via vercel CLI.
Configure environment variables in Vercel:
  NEXTAUTH_URL, NEXTAUTH_SECRET, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WS_URL.
Add CSP headers in next.config.js for security."
```
**Commit:** `chore: vercel deployment config for next.js dashboard`

---

### Task 8.3 — Publish Chrome Extension
```
Prompt to AI:
"Add GitHub Actions workflow .github/workflows/publish-extension.yml.
On push to main with version tag (v*.*.*):
- Build extension with vite
- Zip dist/ folder
- Upload to Chrome Web Store via chrome-webstore-action
- Requires secrets: CHROME_EXTENSION_ID, CHROME_CLIENT_ID,
  CHROME_CLIENT_SECRET, CHROME_REFRESH_TOKEN
Add version bump script to package.json in apps/extension.
Update manifest.json version from package.json version automatically."
```
**Commit:** `chore: github actions for chrome extension publish`

---

## Daily Build Checklist

Use this every day before starting a new task:

```
[ ] Pull latest main
[ ] pnpm install (in case deps changed)
[ ] make dev-deps (start postgres + redis if not running)
[ ] pnpm dev (start all apps)
[ ] Check /health endpoint responds
[ ] Run pnpm test before committing
[ ] Write a clear commit message
[ ] Push and check CI passes
```

---

## Key Technical Decisions (Reference)

| Decision | Choice | Why |
|---|---|---|
| Monorepo | Turborepo + pnpm | Shared types, single dev command |
| Backend | NestJS | TypeScript-native, WebSocket built-in, modular |
| Queue | BullMQ + Redis | Async AI calls, retry logic, dashboard |
| Database | Supabase (Postgres) | pgvector built-in, auth, realtime, free tier |
| Vector DB | pgvector | Free, inside Supabase, no extra infra |
| Vector DB (scale) | Pinecone | Only if pgvector too slow at millions of users |
| LLM | Claude via Anthropic API | RAG interventions, reflection chat |
| ML (v1) | Heuristic formula | No training data needed on day 1 |
| ML (v2) | XGBoost / FastAPI | Replace heuristic once 50+ sessions exist |
| Frontend | Next.js 14 App Router | Server components, streaming, best DX |
| Extension | Chrome MV3 | Required for all new Chrome extensions |
| Dev tooling | Husky + ESLint + Prettier | Code quality without friction |
| Deployment | Railway (API) + Vercel (web) | Simple, fast, free tiers available |

---

## Environment Variables Reference

### apps/api (.env)
```
DATABASE_URL=postgresql://...
TEST_DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-here
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...
ML_SERVICE_URL=http://localhost:8000
PORT=3001
```

### apps/web (.env.local)
```
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001
```

### ml-service (.env)
```
DATABASE_URL=postgresql://...
API_KEY=your-ml-api-key
MODEL_PATH=models/autopilot_classifier.joblib
```

---

## Phase Summary

| Phase | What you build | Estimated days |
|---|---|---|
| 0 | Monorepo scaffold + shared types | 1 day |
| 1 | NestJS API: auth, WebSocket, score engine, queues | 3–4 days |
| 2 | Chrome Extension: tracking, popup, interventions | 3–4 days |
| 3 | AI Layer: RAG, pgvector, LLM interventions | 2–3 days |
| 4 | Next.js Dashboard: live score, charts, AI chat | 3–4 days |
| 5 | Polish: error handling, Docker, dev experience | 1–2 days |
| 6 | ML Microservice (after real data) | 2–3 days |
| 7 | Testing | 2 days |
| 8 | Deployment | 1–2 days |
| **Total** | | **~18–25 days** |
