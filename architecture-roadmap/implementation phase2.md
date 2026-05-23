# Autopilot Detector — Stage 2 Implementation Guide

> **Total time budget: 3 hours.** Every task is scoped for LLM-assisted (vibe) coding.
> Commit after every task. Phases are ordered by impact — if time runs short, drop
> Phase 4 and 5 before dropping anything in Phase 1, 2, or 3.

---

## What We're Adding in Stage 2

| Feature | Why | Phase |
|---|---|---|
| Scroll depth + page reset tracking | Stronger signal engine, smarter score | 1 |
| Context-aware intervention messages | Hyper-specific nudges using intent + domain | 1 |
| Mood check post-session | Unique in the market — no competitor does this | 2 |
| Mood × drift correlation chart | Shows emotional patterns behind doomscrolling | 2 |
| Per-site daily time budgets | Rize has nothing like this — enforcement, not just reporting | 3 |
| Pomodoro focus mode | Directly competes with Rize's Pomodoro feature | 4 |
| Passive mode (no Intent Gate) | Lowers barrier for Rize-style users | 4 |
| README update | Stage 2 diff + new screenshots | 5 |

---

## Existing Stack (Do Not Change)

```
apps/api/          NestJS + Prisma + Supabase (Postgres + pgvector)
                   Clerk auth, BullMQ + Redis, Groq + Gemini embeddings
apps/web/          Next.js 15 App Router, Tailwind neo-brutalist design
apps/extension/    Chrome MV3, Vite + TypeScript, React popup
packages/shared/   Shared TypeScript types
```

---

## Phase 1 — Smarter Signal Engine + Context-Aware Interventions
> Goal: Extension tracks richer behavioral signals. AI nudges know exactly what you were doing.
> Time budget: **45 minutes**

---

### Task 1.1 — Add scroll depth + page reset to shared types

```
Prompt to AI:
"In packages/shared/src/index.ts, extend the existing BehavioralSignal type
with two new optional fields:
- scrollDepthPercent: number  (0–100, how far down the page the user scrolled)
- pageResetCount: number      (how many times scrollY reset to near 0 this interval,
                               indicating infinite scroll refresh behavior)

Also extend AutopilotScore type with:
- scrollDepthAvg: number      (average scroll depth across signals in this batch)
- pageResetRate: number       (resets per minute, signals infinite scroll looping)

Do not remove any existing fields. Keep all existing types intact.
Rebuild packages/shared so downstream apps pick up the new types."
```
**Commit:** `feat(shared): add scrollDepthPercent and pageResetCount to signal types`

---

### Task 1.2 — Track scroll depth + page resets in content.ts

```
Prompt to AI:
"In apps/extension/src/content.ts, add two new tracking mechanisms alongside
the existing scroll velocity tracking. All existing logic stays untouched.

1. Scroll depth tracking:
   - On every scroll event (passive: true listener already exists — add to it):
     const scrollDepthPercent = Math.round(
       (window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100
     );
   - Track maxScrollDepth per signal interval (reset each batch).

2. Page reset detection:
   - Keep a variable: let lastScrollY = 0;
   - If the new scrollY is less than 50px AND lastScrollY was greater than 500px,
     increment a pageResetCount for this interval.
     (This detects the user hitting bottom and the page refreshing to top —
      the core infinite scroll loop signal.)
   - Reset pageResetCount after each batch is sent.

3. Include scrollDepthPercent: maxScrollDepth and pageResetCount in the signal
   batch objects sent via chrome.runtime.sendMessage({ type: 'SIGNAL_BATCH' }).

4. Reset maxScrollDepth and pageResetCount to 0 after each batch."
```
**Commit:** `feat(extension): track scroll depth and infinite scroll page resets`

---

### Task 1.3 — Integrate scroll depth into autopilot score formula

```
Prompt to AI:
"In apps/api/src/signals/autopilot-score.service.ts, update the existing
calculateScore() method to factor in the two new signals.

Current formula (do not remove existing variables):
  scrollVelocity, tabSwitchRate, passiveRatio, cognitiveDrift, doomscrollProbability

Add:
  const avgScrollDepth = avg(signals.map(s => s.scrollDepthPercent ?? 0)) / 100; // 0–1
  const pageResetRate = sum(signals.map(s => s.pageResetCount ?? 0)) / windowMinutes;

Update doomscrollProbability:
  // Old: scrollVelocity * 0.3 + passiveRatio * 0.4 + tabSwitchRate * 0.3
  // New: weight page resets heavily — they are the strongest doomscroll signal
  const doomscrollProbability =
    scrollVelocity * 0.25 +
    passiveRatio * 0.30 +
    tabSwitchRate * 0.20 +
    (pageResetRate > 2 ? 0.25 : pageResetRate / 2 * 0.25); // caps at 0.25

Include scrollDepthAvg and pageResetRate in the returned AutopilotScore object."
```
**Commit:** `feat(api): integrate scroll depth and page reset rate into autopilot score`

---

### Task 1.4 — Context-aware intervention messages via Groq

```
Prompt to AI:
"In apps/api/src/queues/ai-intervention.processor.ts, update the BullMQ
job processor that generates intervention messages.

Currently it calls Groq with a generic prompt. Update it to pass rich context:

From the job data, extract (these fields already exist on the session/score objects):
  - sessionId, userId
  - declaredIntent (from Session.declaredIntent)
  - activeDomain (from the most recent BehavioralSignal.activeDomain)
  - activeTabTitle (from the most recent BehavioralSignal.activeTabTitle)
  - currentScore (the triggering AutopilotScore.score)
  - interventionType (NUDGE | PAUSE | REFLECTION)
  - pageResetRate (from AutopilotScore.pageResetRate)

Build a context-rich Groq prompt:
  system: 'You are the Autopilot Detector intervention engine. Generate ONE short,
  punchy intervention message (max 15 words). Be specific — use the exact domain
  and intent provided. Be firm but non-judgmental. No emojis.'

  user: 'User said they opened the browser to: ${declaredIntent}.
  They are currently on: ${activeDomain} (${activeTabTitle}).
  Their cognitive drift score is ${currentScore}/100.
  They have refreshed the infinite scroll ${pageResetRate} times per minute.
  Intervention type: ${interventionType}.
  Generate the intervention message.'

Example output for NUDGE: 'You said study. Reddit says otherwise. Score: 78.'
Example output for PAUSE: 'YouTube opened 4 times this hour. You said you had work.'
Example output for REFLECTION: 'Is this what you meant by learning? 43 minutes on TikTok.'

Use the existing Groq client pattern in the codebase. Max 60 tokens output."
```
**Commit:** `feat(api): context-aware intervention messages with domain and intent`

---

## Phase 2 — Mood Correlation Engine
> Goal: Post-session mood check + correlation chart. Completely unique in the market.
> Time budget: **55 minutes**

---

### Task 2.1 — Add mood field to Prisma schema

```
Prompt to AI:
"In apps/api/prisma/schema.prisma, add a moodRating field to the Session model:
  moodRating  Int?   // 1–5 scale, null if not rated, set post-session

Run prisma migrate dev --name add_mood_rating_to_session

Also add a MoodEntry model for tracking mood over time (for correlation chart):
  model MoodEntry {
    id          String   @id @default(cuid())
    userId      String
    sessionId   String   @unique
    moodRating  Int      // 1–5
    avgScore    Float    // autopilot score average for that session
    createdAt   DateTime @default(now())
    user        User     @relation(fields: [userId], references: [id])
    session     Session  @relation(fields: [sessionId], references: [id])
  }

Add the reverse relation on Session: moodEntry MoodEntry?
Add the reverse relation on User: moodEntries MoodEntry[]"
```
**Commit:** `feat(api): add moodRating to Session and MoodEntry model`

---

### Task 2.2 — Mood check overlay in content.ts

```
Prompt to AI:
"In apps/extension/src/content.ts, add a mood check overlay that fires when
the content script receives a SHOW_MOOD_CHECK message from background.ts.

The overlay should:
1. Inject a full-screen semi-transparent overlay (z-index: 2147483647)
   matching the existing neo-brutalist design in content.css:
   black border, white background, bold uppercase font.

2. Show the heading: 'HOW DID THAT SESSION FEEL?' in large bold text.

3. Show 5 large clickable emoji buttons in a row:
   1 = 😩 (Drained)
   2 = 😕 (Meh)
   3 = 😐 (Neutral)
   4 = 🙂 (Good)
   5 = 😄 (Energized)
   Each button shows the emoji + label below it.

4. On click: send chrome.runtime.sendMessage({ type: 'MOOD_RATING', payload: { rating: N } })
   Then immediately remove the overlay from DOM.

5. Add a small 'Skip' text link below the emojis that also removes the overlay
   and sends { type: 'MOOD_RATING', payload: { rating: null } }.

6. Auto-dismiss after 20 seconds if no interaction (remove overlay, send null).

Add the corresponding styles to apps/extension/src/content.css:
.mood-overlay, .mood-overlay-card, .mood-emoji-btn classes
following the same neo-brutalist pattern as existing overlay styles."
```
**Commit:** `feat(extension): post-session mood check overlay with emoji scale`

---

### Task 2.3 — Wire mood rating through background → API

```
Prompt to AI:
"In apps/extension/src/background.ts, make two changes:

1. After END_SESSION is processed (session:end emitted to WebSocket), send a message
   to the active content script tab to show the mood check:
   chrome.tabs.query({ active: true, windowType: 'normal' }, (tabs) => {
     if (tabs[0]?.id) {
       chrome.tabs.sendMessage(tabs[0].id, { type: 'SHOW_MOOD_CHECK' });
     }
   });

2. Add a MOOD_RATING message handler:
   if (message.type === 'MOOD_RATING') {
     const { rating } = message.payload;
     if (rating !== null && currentSessionId) {
       // POST to API to save mood
       const token = (await chrome.storage.local.get(['accessToken'])).accessToken;
       fetch(`${API_URL}/sessions/${currentSessionId}/mood`, {
         method: 'PATCH',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${token}`
         },
         body: JSON.stringify({ moodRating: rating })
       }).catch(err => console.error('Failed to save mood:', err));
     }
   }

In apps/api/src/sessions/sessions.controller.ts, add:
  @Patch(':id/mood')
  @UseGuards(JwtAuthGuard)
  async saveMood(
    @Param('id') id: string,
    @Request() req,
    @Body() body: { moodRating: number }
  ) {
    return this.sessionsService.saveMoodRating(id, req.user.id, body.moodRating);
  }

In apps/api/src/sessions/sessions.service.ts, add saveMoodRating():
  - Verify session belongs to userId (IDOR check)
  - Update Session.moodRating
  - Calculate session avgScore from its AutopilotScores
  - Upsert MoodEntry { userId, sessionId, moodRating, avgScore }"
```
**Commit:** `feat(api,extension): wire mood rating from overlay through to MoodEntry DB`

---

### Task 2.4 — Mood × Drift correlation chart in dashboard

```
Prompt to AI:
"In apps/api/src/analytics/analytics.controller.ts, add:
  GET /analytics/mood-correlation → protected by JwtAuthGuard
  Returns last 30 MoodEntry records for the user, ordered by createdAt desc.
  Each record: { moodRating, avgScore, createdAt }

In apps/api/src/analytics/analytics.service.ts add getMoodCorrelation(userId):
  this.prisma.moodEntry.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { moodRating: true, avgScore: true, createdAt: true }
  })

In apps/web/app/dashboard/analytics/page.tsx:
  Fetch /analytics/mood-correlation server-side (same pattern as heatmap fetch).
  Pass data to a new <MoodCorrelationChart /> client component.

Create apps/web/app/dashboard/analytics/MoodCorrelationChart.tsx:
  'use client'
  Use Recharts ScatterChart.
  X-axis: moodRating (1–5), label 'Mood After Session'
  Y-axis: avgScore (0–100), label 'Avg Drift Score'
  Each dot = one session. Color: red if avgScore > 60, green if < 40, yellow otherwise.
  Add a ReferenceLine at y=60 (dashed, label 'Danger Zone').
  Add neo-brutalist styling: black borders, bold axis labels, custom tooltip.
  Tooltip shows: 'Mood: 😐 Neutral | Drift Score: 74 | Date: ...'
  Title: 'MOOD × DRIFT CORRELATION' in the same neo-brutalist header style
  as CognitiveHealthMeter."
```
**Commit:** `feat(web,api): mood x drift scatter chart in analytics dashboard`

---

## Phase 3 — Per-Site Daily Time Budgets
> Goal: Users set daily time limits per domain. Extension enforces them. Rize cannot do this.
> Time budget: **50 minutes**

---

### Task 3.1 — Budget settings UI in extension popup

```
Prompt to AI:
"In apps/extension/src/popup.html and popup.ts, add a third view: viewBudgets.

In popup.html add a 'BUDGETS' nav button alongside the existing 'INTENT' and
'DASHBOARD' views. Add the viewBudgets div with:
  - A heading: 'DAILY SITE BUDGETS'
  - A small input row: text input for domain (placeholder: 'youtube.com') +
    number input for minutes (placeholder: '30') + ADD button
  - A list div (#budget-list) showing existing budgets
  - A 'CLEAR ALL' link at the bottom

In popup.ts:
  On init, load budgets from chrome.storage.local.get(['siteBudgets']).
  siteBudgets format: Record<string, number> — { 'youtube.com': 1800 } (seconds)

  ADD button handler:
    const domain = domainInput.value.trim().toLowerCase();
    const seconds = parseInt(minutesInput.value) * 60;
    if (!domain || !seconds) return;
    const existing = await getBudgets();
    existing[domain] = seconds;
    await chrome.storage.local.set({ siteBudgets: existing });
    renderBudgetList(existing);

  renderBudgetList(budgets):
    For each entry, show: 'youtube.com — 30 min/day' with a delete ✕ button.

  Use the same neo-brutalist input and button styles already in popup.html."
```
**Commit:** `feat(extension): per-site daily time budget settings UI in popup`

---

### Task 3.2 — Budget tracking and enforcement in background.ts

```
Prompt to AI:
"In apps/extension/src/background.ts, add budget tracking logic.

Add a new in-memory tracker: Map<string, number> called domainTimeToday.
  Key: domain string. Value: seconds spent on that domain today.

In the chrome.tabs.onActivated and chrome.tabs.onUpdated listeners (that already
exist for tab tracking), also update domainTimeToday:
  - When a tab becomes active, record a startTime = Date.now() for that domain.
  - When the tab loses focus or changes, calculate elapsed = (Date.now() - startTime) / 1000
    and add it to domainTimeToday[domain].

Add a setInterval every 30 seconds:
  1. Get current active tab domain.
  2. Load siteBudgets from chrome.storage.local.
  3. For the active domain, check if domainTimeToday[domain] >= siteBudgets[domain].
  4. If budget exceeded, send BUDGET_EXCEEDED message to the active content script tab:
     chrome.tabs.sendMessage(tabId, {
       type: 'SHOW_BUDGET_OVERLAY',
       payload: { domain, usedSeconds: domainTimeToday[domain], budgetSeconds: siteBudgets[domain] }
     });

Reset domainTimeToday at midnight using chrome.alarms:
  chrome.alarms.create('resetDailyBudgets', { when: tomorrowMidnight, periodInMinutes: 1440 });
  On alarm: domainTimeToday = {};

Persist domainTimeToday to chrome.storage.local on every update so it survives
service worker restarts."
```
**Commit:** `feat(extension): budget time tracking and midnight reset in background`

---

### Task 3.3 — Budget exhausted overlay in content.ts

```
Prompt to AI:
"In apps/extension/src/content.ts, add a handler for SHOW_BUDGET_OVERLAY message.

When received:
  const { domain, usedSeconds, budgetSeconds } = message.payload;
  const usedMins = Math.round(usedSeconds / 60);
  const budgetMins = Math.round(budgetSeconds / 60);

Inject a full-screen overlay (same neo-brutalist pattern as existing overlays):
  - Red background (bg: #ff3b30, or use the existing danger color from content.css)
  - Large heading: 'BUDGET EXHAUSTED'
  - Sub-heading: '${domain}'
  - Body text: 'You set a ${budgetMins} min daily limit. You have used ${usedMins} min today.'
  - Two buttons in a row:
      [LEAVE SITE] → window.history.back()
      [OVERRIDE — I'M SURE] → removes overlay, sends BUDGET_OVERRIDE to background
  - Small footer: 'Budget resets at midnight.'

The overlay should NOT have a timer auto-dismiss — it stays until the user actively
chooses to leave or override.

Add BUDGET_OVERRIDE handler in background.ts:
  On override, add the domain to a chrome.storage.local key 'budgetOverrides'
  with a timestamp. The 30-second check skips domains in budgetOverrides for 60 minutes."
```
**Commit:** `feat(extension): budget exhausted full-screen overlay with override option`

---

## Phase 4 — Pomodoro Mode + Passive Mode
> Goal: Two toggles that widen the product's appeal to different user types.
> Time budget: **30 minutes**

---

### Task 4.1 — Pomodoro mode in popup + background

```
Prompt to AI:
"In apps/extension/src/popup.html, in the existing viewDashboard section, add
a Pomodoro row below the current score display:
  [🍅 START FOCUS — 25 MIN] button (id='pomodoro-btn')
  When active, shows: '🍅 FOCUS: 18:32 remaining | [END BREAK]' or
                      '☕ BREAK: 4:12 remaining | [SKIP BREAK]'

In apps/extension/src/popup.ts:
  Listen for POMODORO_STATUS messages from background and update the display.
  pomodoro-btn click: send START_POMODORO to background.

In apps/extension/src/background.ts:
  Add Pomodoro state: { active: boolean, phase: 'focus'|'break', endsAt: number }

  START_POMODORO handler:
    Set pomodoroState = { active: true, phase: 'focus', endsAt: Date.now() + 25*60*1000 }
    Store to chrome.storage.session.
    Create chrome.alarms.create('pomodoroTick', { periodInMinutes: 1/60 }) — every second.

  pomodoroTick alarm handler:
    If phase = 'focus' and time elapsed:
      Switch to 'break', endsAt = Date.now() + 5*60*1000.
      chrome.notifications.create({ title: 'Pomodoro Complete!', message: 'Time for a 5 min break.' })
    If phase = 'break' and time elapsed:
      Switch to 'focus', endsAt = Date.now() + 25*60*1000.
      chrome.notifications.create({ title: 'Break Over', message: 'Back to focus. 25 minutes.' })

    Broadcast POMODORO_STATUS to popup every tick.

  CRITICAL behavior change during Pomodoro:
    In the SIGNAL_BATCH handler, if pomodoroState.phase === 'break':
      Still send signals but add a flag: isPomodoroBreak: true
    In apps/api/src/signals/autopilot-score.service.ts:
      If isPomodoroBreak is set on the batch, skip intervention check entirely —
      break time is explicitly permitted browsing. Still record the score."
```
**Commit:** `feat(extension,api): pomodoro mode with focus/break cycle and score pause`

---

### Task 4.2 — Passive mode toggle (no Intent Gate)

```
Prompt to AI:
"In apps/extension/src/popup.html, in viewIntent (the intent selection screen),
add a toggle at the bottom of the page:
  'PASSIVE MODE' toggle (checkbox styled as a neo-brutalist toggle switch)
  Label: 'Track silently — no intent gate'

In apps/extension/src/popup.ts:
  On toggle change: chrome.storage.local.set({ passiveMode: checked })
  Load passiveMode on init and reflect toggle state.
  If passiveMode is true, show a subtle banner on viewDashboard:
    'PASSIVE MODE — tracking silently'

In apps/extension/src/background.ts:
  In the START_SESSION handler and the tab tracking logic:
    const { passiveMode } = await chrome.storage.local.get(['passiveMode']);
    If passiveMode is true:
      Auto-start a session on every tab with intent = 'PASSIVE'
      Do NOT wait for START_SESSION message from popup
      Skip sending TRIGGER_PAUSE_OVERLAY and TRIGGER_REFLECTION_OVERLAY
      Only send chrome.notifications for NUDGE type (no page overlays)
      This gives Rize-style passive users the tracking without the friction.

In apps/api/src/signals/intervention-timing.service.ts:
  If session.declaredIntent === 'PASSIVE', only fire NUDGE interventions.
  Never fire PAUSE or REFLECTION in passive mode."
```
**Commit:** `feat(extension,api): passive mode for silent tracking without intent gate`

---

## Phase 5 — README Update + Submission
> Goal: Judges see exactly what changed, with proof.
> Time budget: **20 minutes**

---

### Task 5.1 — Update README for Stage 2

```
Prompt to AI:
"Update the existing README.md in the monorepo root.

Add a new section after the existing 'Features' section:

## Stage 2 Additions

| Feature | What It Does |
|---|---|
| Scroll Depth + Page Reset Tracking | Detects infinite scroll loops — the strongest doomscroll signal |
| Context-Aware Interventions | Nudges mention your exact intent + site: 'You said study. Reddit says otherwise.' |
| Mood × Drift Correlation | Post-session mood check. Charts your emotional state against drift score over time. |
| Per-Site Daily Budgets | Set a daily time limit per domain. Extension enforces it with a hard overlay. |
| Pomodoro Mode | 25/5 focus/break cycle. Scoring pauses during break — explicit rest time. |
| Passive Mode | Silent tracking without the Intent Gate — for Rize-style passive users. |

Update the 'Tech Stack' table to add:
  MoodEntry model (Postgres), ScatterChart (Recharts), chrome.alarms (Pomodoro timer)

Update the elevator pitch at the top to the Stage 2 version:
  > 'Rize shows you the damage after it's done. Autopilot Detector stops it while it's happening.
  >  Stage 2: we added mood correlation, time budgets, and Pomodoro mode.
  >  The algorithm has a thousand engineers. We built the kill switch.'

Add a Stage 2 Screenshots section with placeholders:
  ## Stage 2 Screenshots
  ![Mood Check Overlay](./assets/stage2-mood-overlay.png)
  ![Budget Exhausted](./assets/stage2-budget.png)
  ![Mood Correlation Chart](./assets/stage2-mood-chart.png)
  ![Pomodoro Mode](./assets/stage2-pomodoro.png)"
```
**Commit:** `docs: update README for stage 2 features and new screenshots`

---

## Time Budget Summary

| Phase | Tasks | Budget | What Judges See |
|---|---|---|---|
| 1 — Smarter Signals + Context Interventions | 1.1 → 1.4 | 45 min | Score engine is visibly more accurate, nudges are hyper-specific |
| 2 — Mood Correlation | 2.1 → 2.4 | 55 min | New chart in analytics, post-session emoji overlay |
| 3 — Time Budgets | 3.1 → 3.3 | 50 min | Budget settings in popup, hard enforcement overlay |
| 4 — Pomodoro + Passive | 4.1 → 4.2 | 30 min | Two toggles, notifications, passive tracking |
| 5 — README | 5.1 | 20 min | Stage 2 diff, screenshots, updated pitch |
| **Total** | **12 tasks** | **~3 hrs** | |

---

## Drop Order If Time Runs Short

1. Drop Task 4.2 (Passive Mode) — saves 15 min
2. Drop Task 4.1 (Pomodoro) — saves 15 min
3. Drop Task 3.3 (Budget overlay) — saves 15 min, keep budget settings UI
4. **Never drop Phase 2 (Mood)** — it's the most unique feature, nothing in the market has it

---

## Key Technical Decisions

| Decision | Choice | Why |
|---|---|---|
| Mood storage | MoodEntry model (Postgres) | Relational, queryable for correlation chart |
| Mood UI | Content script overlay (not popup) | Fires in context of the browser session that just ended |
| Budget tracking | chrome.storage.local + in-memory Map | Survives service worker restarts, resets at midnight |
| Pomodoro timer | chrome.alarms | Only timer API that survives MV3 service worker suspend |
| Context interventions | Pass domain + intent to Groq | No new infrastructure, huge quality improvement |
| Passive mode | `declaredIntent: 'PASSIVE'` flag | Reuses entire session pipeline, minimal code change |
| Scatter chart | Recharts ScatterChart | Already in the web app's dependencies |

---

## New Env Vars Required

None. All Stage 2 features use the existing environment — same Postgres, same Redis,
same Groq key, same extension permissions. No new `.env` entries needed.

---

## Commit Log (Full Stage 2)

```
feat(shared): add scrollDepthPercent and pageResetCount to signal types
feat(extension): track scroll depth and infinite scroll page resets
feat(api): integrate scroll depth and page reset rate into autopilot score
feat(api): context-aware intervention messages with domain and intent
feat(api): add moodRating to Session and MoodEntry model
feat(extension): post-session mood check overlay with emoji scale
feat(api,extension): wire mood rating from overlay through to MoodEntry DB
feat(web,api): mood x drift scatter chart in analytics dashboard
feat(extension): per-site daily time budget settings UI in popup
feat(extension): budget time tracking and midnight reset in background
feat(extension): budget exhausted full-screen overlay with override option
feat(extension,api): pomodoro mode with focus/break cycle and score pause
feat(extension,api): passive mode for silent tracking without intent gate
docs: update README for stage 2 features and new screenshots
```

---

*Stage 1 complete. 22/22 fixes applied. Stage 2 build starts here.*
