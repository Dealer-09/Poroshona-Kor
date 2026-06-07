/**
 * Synthetic training-data generator (Phase 3 bootstrap).
 *
 * Simulates many synthetic "users", each running varied browsing sessions across
 * ALL five declared intents with realistic domains/titles (e.g. STUDY intent but
 * watching Twitch gameplay → drift climbs → doomscroll onset). Every per-tick
 * behavioural signal is fed through the REAL `AutopilotScoreService` so the
 * persisted `runningDrift` is byte-for-byte what production would have computed —
 * the data is faithful, not hand-faked. Onset labels are produced with the exact
 * same weak-supervision rule the API uses (`SessionsService.labelSessionEvents`).
 *
 * The output lands in the same Postgres the API writes to and `apps/ml/train.py`
 * reads from, so the LSTM trains on it with no further wiring.
 *
 * Synthetic users are tagged with the `@synthetic.autopilot.local` email domain
 * and a recognizable name prefix so the whole dataset is reversible via
 * `scripts/purge-synthetic.cjs` (or `--wipe` here).
 *
 *   cd apps/api
 *   npx ts-node scripts/seed-synthetic.ts --dry            # simulate + stats only
 *   npx ts-node scripts/seed-synthetic.ts --wipe --users 20
 */
import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AppIntent, BehavioralSignal } from '@autopilot/shared';
import { AutopilotScoreService } from '../src/signals/autopilot-score.service';
import type {
  ContentClassification,
  ContentType,
} from '../src/signals/content-classification.service';

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const getFlag = (name: string) => argv.includes(`--${name}`);
const getOpt = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const DRY = getFlag('dry');
const WIPE = getFlag('wipe');
const N_USERS = parseInt(getOpt('users', '20'), 10);
const SEED = parseInt(getOpt('seed', '20260607'), 10);
const SYNTHETIC_EMAIL_DOMAIN = 'synthetic.autopilot.local';

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------
let _s = SEED >>> 0;
function rand(): number {
  _s |= 0;
  _s = (_s + 0x6d2b79f5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a: number, b: number) => a + (b - a) * rand();
const ri = (a: number, b: number) => Math.floor(rr(a, b + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
function gauss(mean: number, sd: number): number {
  // Box–Muller
  const u = Math.max(1e-9, rand());
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
function weightedPick<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

// ---------------------------------------------------------------------------
// Persona library — realistic "links" the user surfs. Each persona is a
// (domain, title-pool, contentType, behaviourKind) bundle.
//   behaviourKind drives the per-tick signal distributions:
//     reading | video | feed | anxious
// ---------------------------------------------------------------------------
type Kind = 'reading' | 'video' | 'feed' | 'anxious';
interface Persona {
  domain: string;
  titles: string[];
  contentType: ContentType;
  kind: Kind;
}

const P = {
  // ---- on-task / educational ----
  docs: {
    domain: 'docs.python.org',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'collections — Container datatypes — Python 3.13 docs',
      'asyncio — Asynchronous I/O — Python docs',
      'typing — Support for type hints — Python docs',
    ],
  },
  mdn: {
    domain: 'developer.mozilla.org',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'Array.prototype.reduce() - JavaScript | MDN',
      'Using Promises - JavaScript | MDN',
      'CSS Grid Layout - CSS | MDN',
    ],
  },
  wiki: {
    domain: 'wikipedia.org',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'Dynamic programming - Wikipedia',
      'Photosynthesis - Wikipedia',
      'French Revolution - Wikipedia',
      'Backpropagation - Wikipedia',
    ],
  },
  so: {
    domain: 'stackoverflow.com',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'How to center a div - Stack Overflow',
      'What is the difference between let and var - Stack Overflow',
      'Why is my useEffect running twice - Stack Overflow',
    ],
  },
  github: {
    domain: 'github.com',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'facebook/react: The library for web and native UIs',
      'nestjs/nest: A progressive Node.js framework',
      'pytorch/pytorch: Tensors and dynamic neural networks',
    ],
  },
  lecture: {
    domain: 'youtube.com',
    contentType: 'lecture' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'MIT 6.006 Introduction to Algorithms - Lecture 1',
      'Stanford CS229: Machine Learning - Lecture 2',
      'Khan Academy: Derivatives explained',
      'Crash Course Biology #12: Photosynthesis',
    ],
  },
  coursera: {
    domain: 'coursera.org',
    contentType: 'lecture' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'Machine Learning by Andrew Ng — Week 3',
      'Algorithms, Part I — Princeton — Union-Find',
    ],
  },
  tutorial: {
    domain: 'youtube.com',
    contentType: 'tutorial' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'React Hooks Tutorial for Beginners — full course',
      'Build a REST API with NestJS — step by step',
      'Python for Data Science — freeCodeCamp 12hr',
      'Docker Crash Course — how to containerize an app',
    ],
  },
  leetcode: {
    domain: 'leetcode.com',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'Two Sum - LeetCode',
      'Longest Substring Without Repeating Characters - LeetCode',
      'LRU Cache - LeetCode',
    ],
  },
  // ---- work / productivity ----
  gdocs: {
    domain: 'docs.google.com',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: [
      'Q3 Planning - Google Docs',
      'Design Review Notes - Google Docs',
      'Sprint Retro - Google Sheets',
    ],
  },
  notion: {
    domain: 'notion.so',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: ['Product Roadmap - Notion', 'Engineering Wiki - Notion'],
  },
  linkedin: {
    domain: 'linkedin.com',
    contentType: 'social' as ContentType,
    kind: 'feed' as Kind,
    titles: ['Feed | LinkedIn', 'Jobs | LinkedIn'],
  },
  jira: {
    domain: 'atlassian.net',
    contentType: 'reading' as ContentType,
    kind: 'reading' as Kind,
    titles: ['APD-142 board - Jira', 'Backlog - Jira'],
  },
  // ---- entertainment (deliberate watching) ----
  netflix: {
    domain: 'netflix.com',
    contentType: 'entertainment' as ContentType,
    kind: 'video' as Kind,
    titles: ['Stranger Things S4:E5', 'The Witcher S2:E3', 'Breaking Bad S3:E7'],
  },
  ytShow: {
    domain: 'youtube.com',
    contentType: 'entertainment' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'Marvel Trailer Reaction!!',
      'Try Not To Laugh Challenge #88',
      'MrBeast: $1,000,000 Challenge',
      'Top 10 Movie Plot Twists',
    ],
  },
  hulu: {
    domain: 'hulu.com',
    contentType: 'entertainment' as ContentType,
    kind: 'video' as Kind,
    titles: ['Only Murders in the Building - S3', 'The Bear - S2:E4'],
  },
  // ---- gaming ----
  twitch: {
    domain: 'twitch.tv',
    contentType: 'gaming' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'xQc playing GTA RP — LIVE',
      'shroud - VALORANT Radiant ranked',
      'Pokimane Just Chatting',
      'summit1g - Elden Ring blind playthrough',
    ],
  },
  ytGaming: {
    domain: 'youtube.com',
    contentType: 'gaming' as ContentType,
    kind: 'video' as Kind,
    titles: [
      'Minecraft Hardcore Ep. 47 — almost died',
      'GTA 5 Funny Moments Compilation',
      'VALORANT Pro Highlights #12',
      'Elden Ring Malenia Boss Speedrun',
    ],
  },
  // ---- social / infinite feeds ----
  twitter: {
    domain: 'twitter.com',
    contentType: 'social' as ContentType,
    kind: 'feed' as Kind,
    titles: ['Home / X', 'For you / X', 'Trending / X'],
  },
  reddit: {
    domain: 'reddit.com',
    contentType: 'social' as ContentType,
    kind: 'feed' as Kind,
    titles: ['r/all - top posts today', 'r/AskReddit - hot', 'r/memes'],
  },
  tiktok: {
    domain: 'tiktok.com',
    contentType: 'social' as ContentType,
    kind: 'feed' as Kind,
    titles: ['For You - TikTok', '#fyp - TikTok'],
  },
  instagram: {
    domain: 'instagram.com',
    contentType: 'social' as ContentType,
    kind: 'feed' as Kind,
    titles: ['Instagram Reels', 'Instagram'],
  },
  ytShorts: {
    domain: 'youtube.com',
    contentType: 'entertainment' as ContentType,
    kind: 'feed' as Kind,
    titles: ['#Shorts - YouTube', 'YouTube Shorts feed'],
  },
} satisfies Record<string, Persona>;

// Per-intent persona menus. `good` = on-task (low drift), `bad` = off-task drift.
const INTENT_MENU: Record<
  AppIntent,
  { good: Persona[]; bad: Persona[] }
> = {
  [AppIntent.STUDY]: {
    good: [P.docs, P.mdn, P.wiki, P.so, P.github, P.lecture, P.coursera, P.leetcode],
    bad: [P.twitch, P.ytGaming, P.ytShow, P.netflix, P.reddit, P.twitter, P.tiktok, P.instagram, P.ytShorts],
  },
  [AppIntent.TUTORIAL]: {
    good: [P.tutorial, P.lecture, P.docs, P.mdn, P.so, P.github],
    bad: [P.ytGaming, P.twitch, P.ytShow, P.reddit, P.twitter, P.tiktok, P.ytShorts],
  },
  [AppIntent.ENTERTAINMENT]: {
    good: [P.netflix, P.ytShow, P.hulu, P.twitch],
    bad: [P.twitter, P.reddit, P.tiktok, P.instagram, P.ytShorts],
  },
  [AppIntent.PRODUCTIVITY]: {
    good: [P.github, P.gdocs, P.notion, P.jira, P.so, P.tutorial, P.leetcode],
    bad: [P.twitter, P.reddit, P.instagram, P.tiktok, P.netflix, P.twitch],
  },
  [AppIntent.PASSIVE]: {
    good: [P.netflix, P.ytShow, P.twitch, P.hulu],
    bad: [P.tiktok, P.reddit, P.twitter, P.instagram, P.ytShorts],
  },
};

const CATEGORY_LABEL: Record<ContentType, string> = {
  lecture: 'education',
  tutorial: 'education',
  reading: 'reading',
  entertainment: 'entertainment',
  gaming: 'gaming',
  social: 'social',
  unknown: 'general',
};

// ---------------------------------------------------------------------------
// Per-tick behaviour model. Given a behaviour kind + intensity x∈[0,1] (0 calm,
// 1 full doomscroll), draw one BehavioralSignal's raw fields. These are the
// human actions; the scoring engine turns them into drift.
// ---------------------------------------------------------------------------
interface Tick {
  scrollVelocity: number;
  clickRate: number;
  passiveTime: number;
  activeTime: number;
  scrollDepthPercent: number;
  pageResetInc: number; // per-tick reset count (engine sums these)
  switchProb: number; // probability of a tab switch this tick
}
function behaviour(kind: Kind, x: number, depth: number, noise: number): Tick {
  const n = (sd: number) => gauss(0, sd) * noise;
  switch (kind) {
    case 'reading':
      return {
        scrollVelocity: clamp(220 + 380 * x + n(120), 40, 1300),
        clickRate: clamp(0.55 - 0.15 * x + n(0.15), 0.1, 1.2),
        passiveTime: clamp(0.55 + 0.35 * x + n(0.2), 0.2, 1.9),
        activeTime: clamp(1.45 - 0.45 * x + n(0.3), 0.2, 2.0),
        scrollDepthPercent: clamp(depth + n(4), 8, 95),
        pageResetInc: 0,
        switchProb: 0.012 + 0.05 * x,
      };
    case 'video':
      return {
        scrollVelocity: clamp(60 + 140 * x + n(60), 0, 600),
        clickRate: clamp(0.2 + 0.1 * x + n(0.1), 0.02, 0.7),
        passiveTime: clamp(1.5 + 0.35 * x + n(0.2), 0.5, 2.0),
        activeTime: clamp(0.5 - 0.2 * x + n(0.2), 0.1, 1.6),
        scrollDepthPercent: clamp(10 + 25 * x + n(5), 3, 55),
        pageResetInc: x > 0.7 && chance(0.08) ? 1 : 0,
        switchProb: 0.01 + 0.06 * x,
      };
    case 'feed':
      return {
        scrollVelocity: clamp(900 + 3600 * x + n(600), 200, 7200),
        clickRate: clamp(0.4 - 0.22 * x + n(0.12), 0.04, 1.0),
        passiveTime: clamp(0.85 + 0.65 * x + n(0.3), 0.3, 2.0),
        activeTime: clamp(1.15 - 0.55 * x + n(0.3), 0.1, 2.0),
        scrollDepthPercent: clamp(40 + 65 * x + n(8), 20, 120),
        pageResetInc: chance(0.25 + 0.55 * x) ? ri(1, x > 0.7 ? 3 : 2) : 0,
        switchProb: 0.06 + 0.22 * x,
      };
    case 'anxious':
      return {
        scrollVelocity: clamp(1400 + 3200 * x + n(700), 300, 7200),
        clickRate: clamp(0.5 - 0.2 * x + n(0.15), 0.05, 1.2),
        passiveTime: clamp(0.7 + 0.35 * x + n(0.25), 0.3, 1.8),
        activeTime: clamp(1.1 - 0.35 * x + n(0.3), 0.1, 2.0),
        scrollDepthPercent: clamp(35 + 55 * x + n(8), 20, 115),
        pageResetInc: chance(0.15 + 0.35 * x) ? ri(1, 2) : 0,
        switchProb: 0.18 + 0.42 * x,
      };
  }
}

// ---------------------------------------------------------------------------
// Session plan — a sequence of segments (persona + intensity ramp). One segment
// = focused or doom; two/three segments = realistic drift / recovery arcs.
// ---------------------------------------------------------------------------
interface Segment {
  persona: Persona;
  ticks: number;
  x0: number;
  x1: number;
  kindOverride?: Kind;
}
interface SessionPlan {
  intent: AppIntent;
  segments: Segment[];
  mood: number;
  startedAt: Date;
  dt: number; // seconds per tick
  appOpened: string;
}

interface UserProfile {
  name: string;
  badRate: number; // fraction of sessions that drift off-task
  intentWeights: [AppIntent, number][];
  noise: number; // per-user signal noise multiplier
  hours: number[]; // typical active hours
  dt: number;
  sessions: number;
}

const PROFILE_TEMPLATES: Omit<UserProfile, 'name' | 'sessions'>[] = [
  {
    // Disciplined student — mostly focused study/tutorial
    badRate: 0.25,
    intentWeights: [
      [AppIntent.STUDY, 5],
      [AppIntent.TUTORIAL, 4],
      [AppIntent.PRODUCTIVITY, 2],
      [AppIntent.ENTERTAINMENT, 1],
      [AppIntent.PASSIVE, 1],
    ],
    noise: 0.9,
    hours: [9, 10, 11, 14, 15, 16, 20],
    dt: 4,
  },
  {
    // Chronic doomscroller — drifts constantly
    badRate: 0.7,
    intentWeights: [
      [AppIntent.STUDY, 3],
      [AppIntent.PASSIVE, 3],
      [AppIntent.ENTERTAINMENT, 3],
      [AppIntent.TUTORIAL, 2],
      [AppIntent.PRODUCTIVITY, 1],
    ],
    noise: 1.2,
    hours: [13, 22, 23, 0, 1, 2],
    dt: 3.6,
  },
  {
    // Gamer who keeps opening study sessions then going to Twitch
    badRate: 0.6,
    intentWeights: [
      [AppIntent.STUDY, 4],
      [AppIntent.TUTORIAL, 3],
      [AppIntent.ENTERTAINMENT, 2],
      [AppIntent.PASSIVE, 1],
      [AppIntent.PRODUCTIVITY, 1],
    ],
    noise: 1.1,
    hours: [16, 17, 18, 21, 22, 23],
    dt: 4.2,
  },
  {
    // Knowledge worker — productivity heavy, occasional social drift
    badRate: 0.35,
    intentWeights: [
      [AppIntent.PRODUCTIVITY, 5],
      [AppIntent.TUTORIAL, 2],
      [AppIntent.STUDY, 2],
      [AppIntent.PASSIVE, 1],
      [AppIntent.ENTERTAINMENT, 1],
    ],
    noise: 0.95,
    hours: [9, 10, 11, 13, 14, 15, 16, 17],
    dt: 4.1,
  },
  {
    // Casual chiller — mostly passive/entertainment, content
    badRate: 0.4,
    intentWeights: [
      [AppIntent.PASSIVE, 4],
      [AppIntent.ENTERTAINMENT, 4],
      [AppIntent.STUDY, 1],
      [AppIntent.TUTORIAL, 1],
      [AppIntent.PRODUCTIVITY, 1],
    ],
    noise: 1.0,
    hours: [19, 20, 21, 22, 23],
    dt: 4.3,
  },
  {
    // Tutorial binger — long youtube tutorial sessions, sometimes rabbit-holes
    badRate: 0.45,
    intentWeights: [
      [AppIntent.TUTORIAL, 6],
      [AppIntent.STUDY, 2],
      [AppIntent.PRODUCTIVITY, 1],
      [AppIntent.ENTERTAINMENT, 1],
      [AppIntent.PASSIVE, 1],
    ],
    noise: 1.05,
    hours: [10, 11, 14, 19, 20, 21],
    dt: 3.9,
  },
];

function makeUsers(n: number): UserProfile[] {
  const users: UserProfile[] = [];
  for (let i = 0; i < n; i++) {
    const t = PROFILE_TEMPLATES[i % PROFILE_TEMPLATES.length];
    users.push({
      ...t,
      // jitter each clone so two "disciplined students" aren't identical
      badRate: clamp(t.badRate + rr(-0.08, 0.08), 0.05, 0.9),
      noise: clamp(t.noise + rr(-0.1, 0.1), 0.6, 1.4),
      dt: t.dt + rr(-0.3, 0.3),
      name: `${t.intentWeights[0][0]}-persona ${i + 1}`,
      sessions: ri(8, 16),
    });
  }
  return users;
}

function planSession(u: UserProfile): SessionPlan {
  const intent = weightedPick(u.intentWeights);
  const menu = INTENT_MENU[intent];
  const bad = chance(u.badRate);
  const N = ri(40, 110);
  const hour = pick(u.hours);
  const daysAgo = ri(0, 30);
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(hour, ri(0, 59), ri(0, 59), 0);

  const dt = u.dt + rr(-0.2, 0.2);
  const appOpened = chance(0.8)
    ? 'Chrome Browser'
    : (bad ? menu.good[0] : menu.good[0]).domain;

  let segments: Segment[];
  let mood: number;

  if (!bad) {
    // On-task: single calm segment (low intensity). Entertainment/passive video
    // is *meant* to be passive, so it stays low-drift by design.
    const persona = pick(menu.good);
    segments = [{ persona, ticks: N, x0: rr(0.04, 0.12), x1: rr(0.1, 0.22) }];
    mood = chance(0.6) ? 5 : 4;
  } else {
    const arc = weightedPick<'drift' | 'doom' | 'recover' | 'restless'>(
      intent === AppIntent.ENTERTAINMENT
        ? [
            ['restless', 5],
            ['doom', 3],
            ['drift', 2],
          ]
        : [
            ['drift', 5],
            ['doom', 3],
            ['recover', 2],
          ],
    );
    const onTask = pick(menu.good);
    const offTask = pick(menu.bad);
    if (arc === 'doom') {
      segments = [
        { persona: offTask, ticks: N, x0: rr(0.65, 0.8), x1: rr(0.85, 0.98) },
      ];
      mood = chance(0.6) ? 1 : 2;
    } else if (arc === 'drift') {
      const s1 = Math.round(N * rr(0.35, 0.5));
      segments = [
        { persona: onTask, ticks: s1, x0: rr(0.05, 0.12), x1: rr(0.15, 0.25) },
        {
          persona: offTask,
          ticks: N - s1,
          x0: rr(0.3, 0.45),
          x1: rr(0.85, 0.98),
        },
      ];
      mood = pick([1, 2, 2, 3]);
    } else if (arc === 'recover') {
      const s1 = Math.round(N * 0.3);
      const s2 = Math.round(N * 0.4);
      segments = [
        { persona: onTask, ticks: s1, x0: 0.06, x1: 0.2 },
        { persona: offTask, ticks: s2, x0: 0.4, x1: rr(0.85, 0.95) },
        { persona: onTask, ticks: N - s1 - s2, x0: 0.45, x1: 0.15 },
      ];
      mood = pick([3, 3, 4]); // caught themselves — borderline
    } else {
      // restless — anxious doomscroll during entertainment
      segments = [
        {
          persona: offTask,
          ticks: N,
          x0: rr(0.5, 0.65),
          x1: rr(0.85, 0.97),
          kindOverride: 'anxious',
        },
      ];
      mood = pick([2, 2, 3]);
    }
  }

  return { intent, segments, mood, startedAt: start, dt, appOpened };
}

// ---------------------------------------------------------------------------
// Classification consistent with ContentClassificationService.buildResult.
// ---------------------------------------------------------------------------
function classifyFor(
  contentType: ContentType,
  intent: AppIntent,
): ContentClassification {
  const studyRelevant: ContentType[] = ['lecture', 'tutorial', 'reading'];
  const isRelevantToIntent =
    (intent === AppIntent.STUDY || intent === AppIntent.TUTORIAL) &&
    studyRelevant.includes(contentType);
  return {
    contentType,
    isRelevantToIntent,
    confidence: 0.85,
    reason: 'synthetic-keyword',
    aiPowered: false,
  };
}

// ---------------------------------------------------------------------------
// Simulate one session → events[] + scores[]. Mirrors the gateway exactly:
//   - one SessionEvent per tick, stamped with the LAST computed drift (one-cycle
//     lag, just like persistSessionEvents reading session:lastScore from Redis)
//   - recompute the score every 6 ticks over the trailing ≤100-signal buffer
// ---------------------------------------------------------------------------
const score = new AutopilotScoreService();

interface EventRow {
  id: string;
  sessionId: string;
  timestamp: Date;
  tsMs: number;
  scrollVelocity: number;
  tabSwitchCount: number;
  clickRate: number;
  passiveTime: number;
  activeTime: number;
  scrollDepthPercent: number;
  pageResetCount: number;
  activeDomain: string;
  contentType: string;
  secondsSinceIntent: number;
  hourOfDay: number;
  runningDrift: number;
  isPomodoroBreak: boolean;
  onsetLabel: boolean;
}
interface ScoreRow {
  id: string;
  sessionId: string;
  score: number;
  focusFragmentation: number;
  passiveRatio: number;
  cognitiveDrift: number;
  doomscrollProbability: number;
  timestamp: Date;
}

function simulate(
  plan: SessionPlan,
  sessionId: string,
  noise: number,
): { events: EventRow[]; scores: ScoreRow[]; lastPersona: Persona } {
  const events: EventRow[] = [];
  const scores: ScoreRow[] = [];
  const buffer: BehavioralSignal[] = [];
  let lastScore = 0;
  let tabSwitch = ri(0, 2);
  let depth = rr(8, 20);
  const startMs = plan.startedAt.getTime();

  // flatten segments into a per-tick (persona, intensity) schedule
  const schedule: { persona: Persona; x: number; kind: Kind }[] = [];
  for (const seg of plan.segments) {
    for (let t = 0; t < seg.ticks; t++) {
      const frac = seg.ticks <= 1 ? 1 : t / (seg.ticks - 1);
      const x = clamp(seg.x0 + (seg.x1 - seg.x0) * frac + gauss(0, 0.05), 0, 1);
      schedule.push({
        persona: seg.persona,
        x,
        kind: seg.kindOverride ?? seg.persona.kind,
      });
    }
  }

  let lastPersona = schedule[0].persona;
  for (let i = 0; i < schedule.length; i++) {
    const { persona, x, kind } = schedule[i];
    lastPersona = persona;
    const ts = new Date(startMs + i * plan.dt * 1000);
    // depth drifts upward within a feed/reading run, resets on persona change
    if (i > 0 && schedule[i - 1].persona.domain !== persona.domain)
      depth = rr(8, 25);
    depth = clamp(depth + rr(0.4, 2.4) * (kind === 'feed' ? 1.6 : 1), 5, 119);

    const b = behaviour(kind, x, depth, noise);
    if (chance(b.switchProb)) tabSwitch += 1;
    const title = pick(persona.titles);

    const signal: BehavioralSignal = {
      scrollVelocity: b.scrollVelocity,
      tabSwitchCount: tabSwitch,
      clickRate: b.clickRate,
      passiveTime: b.passiveTime,
      activeTime: b.activeTime,
      timestamp: ts.toISOString(),
      sessionId,
      activeDomain: persona.domain,
      activeTabTitle: title,
      scrollDepthPercent: b.scrollDepthPercent,
      pageResetCount: b.pageResetInc,
      isPomodoroBreak: false,
    };
    buffer.push(signal);
    if (buffer.length > 100) buffer.shift();

    // Stamp the event with the drift computed at the PREVIOUS cycle (the lag).
    events.push({
      id: randomUUID(),
      sessionId,
      timestamp: ts,
      tsMs: ts.getTime(),
      scrollVelocity: b.scrollVelocity,
      tabSwitchCount: tabSwitch,
      clickRate: b.clickRate,
      passiveTime: b.passiveTime,
      activeTime: b.activeTime,
      scrollDepthPercent: b.scrollDepthPercent,
      pageResetCount: b.pageResetInc,
      activeDomain: persona.domain,
      contentType: persona.contentType,
      secondsSinceIntent: Math.max(0, Math.round((ts.getTime() - startMs) / 1000)),
      hourOfDay: ts.getHours(),
      runningDrift: lastScore,
      isPomodoroBreak: false,
      onsetLabel: false, // filled by labeler
    });

    // Recompute every 6 ticks (≈ gateway's batchCount % 6 === 0), AFTER persisting.
    if ((i + 1) % 6 === 0) {
      const classification = classifyFor(persona.contentType, plan.intent);
      const s = score.computeScore(buffer, plan.intent, classification);
      lastScore = s.score;
      scores.push({
        id: randomUUID(),
        sessionId,
        score: s.score,
        focusFragmentation: s.focusFragmentation,
        passiveRatio: s.passiveRatio,
        cognitiveDrift: s.cognitiveDrift,
        doomscrollProbability: s.doomscrollProbability,
        timestamp: ts,
      });
    }
  }

  return { events, scores, lastPersona };
}

// ---------------------------------------------------------------------------
// Weak-supervision labeler — identical rule to SessionsService.labelSessionEvents.
// ---------------------------------------------------------------------------
function labelEvents(events: EventRow[], moodRating: number): number {
  const THRESH = 60;
  const HORIZON = 5 * 60 * 1000;
  const SUSTAIN = 2;
  const bad = moodRating <= 3;
  let pos = 0;
  for (let i = 0; i < events.length; i++) {
    let onset = false;
    if (bad) {
      const horizonEnd = events[i].tsMs + HORIZON;
      let consec = 0;
      for (let j = i + 1; j < events.length; j++) {
        if (events[j].tsMs > horizonEnd) break;
        if (events[j].runningDrift >= THRESH) {
          consec++;
          if (consec >= SUSTAIN) {
            onset = true;
            break;
          }
        } else consec = 0;
      }
    }
    events[i].onsetLabel = onset;
    if (onset) pos++;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const users = makeUsers(N_USERS);

  // accumulate everything in memory, then bulk insert
  const userRows: any[] = [];
  const sessionRows: any[] = [];
  let eventRows: EventRow[] = [];
  let scoreRows: ScoreRow[] = [];
  const moodRows: any[] = [];

  // stats
  const intentCount: Record<string, number> = {};
  let totalEvents = 0;
  let posEvents = 0;
  let posSessions = 0;
  let driftSum = 0;

  for (let ui = 0; ui < users.length; ui++) {
    const u = users[ui];
    const userId = randomUUID();
    const email = `synthetic.user${ui + 1}@${SYNTHETIC_EMAIL_DOMAIN}`;
    userRows.push({
      id: userId,
      email,
      password: 'synthetic-no-login',
      createdAt: new Date(),
    });

    for (let si = 0; si < u.sessions; si++) {
      const plan = planSession(u);
      const sessionId = randomUUID();
      const { events, scores, lastPersona } = simulate(plan, sessionId, u.noise);
      const pos = labelEvents(events, plan.mood);

      const endedAt = events.length
        ? new Date(events[events.length - 1].tsMs + plan.dt * 1000)
        : plan.startedAt;
      const avgScore =
        scores.length > 0
          ? scores.reduce((a, s) => a + s.score, 0) / scores.length
          : 0;

      sessionRows.push({
        id: sessionId,
        userId,
        startedAt: plan.startedAt,
        endedAt,
        appOpened: plan.appOpened,
        declaredIntent: plan.intent,
        pageTitle: pick(lastPersona.titles),
        pageCategory: CATEGORY_LABEL[lastPersona.contentType],
        moodRating: plan.mood,
      });
      moodRows.push({
        userId,
        sessionId,
        moodRating: plan.mood,
        avgScore,
        createdAt: endedAt,
      });

      eventRows.push(...events);
      scoreRows.push(...scores);

      intentCount[plan.intent] = (intentCount[plan.intent] || 0) + 1;
      totalEvents += events.length;
      posEvents += pos;
      if (pos > 0) posSessions++;
      driftSum += scores.reduce((a, s) => a + s.score, 0);
    }
  }

  const totalSessions = sessionRows.length;
  console.log('\n──────── synthetic dataset summary ────────');
  console.log(`users:           ${userRows.length}`);
  console.log(`sessions:        ${totalSessions}`);
  console.log(`session events:  ${totalEvents}`);
  console.log(`autopilot scores:${scoreRows.length}`);
  console.log(
    `intent mix:      ${Object.entries(intentCount)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  console.log(
    `positive events: ${posEvents}/${totalEvents} (${(
      (100 * posEvents) /
      Math.max(1, totalEvents)
    ).toFixed(1)}%)`,
  );
  console.log(
    `positive sessions (onset somewhere): ${posSessions}/${totalSessions} (${(
      (100 * posSessions) /
      Math.max(1, totalSessions)
    ).toFixed(1)}%)`,
  );
  console.log(
    `avg score over computed batches: ${(
      driftSum / Math.max(1, scoreRows.length)
    ).toFixed(1)}`,
  );

  if (DRY) {
    console.log('\n[--dry] no database writes performed.');
    return;
  }

  // ---- DB writes (DIRECT_URL for safe bulk inserts) ----
  const pool = new Pool({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    if (WIPE) {
      console.log('\n[--wipe] removing previous synthetic users…');
      const old = await prisma.user.findMany({
        where: { email: { endsWith: `@${SYNTHETIC_EMAIL_DOMAIN}` } },
        select: { id: true },
      });
      const ids = old.map((o) => o.id);
      if (ids.length) {
        await prisma.moodEntry.deleteMany({ where: { userId: { in: ids } } });
        await prisma.session.deleteMany({ where: { userId: { in: ids } } });
        await prisma.user.deleteMany({ where: { id: { in: ids } } });
        console.log(`  removed ${ids.length} synthetic users + cascaded data.`);
      } else {
        console.log('  none found.');
      }
    }

    const chunk = async (
      label: string,
      model: { createMany: (a: any) => Promise<any> },
      rows: any[],
      size = 1000,
    ) => {
      process.stdout.write(`inserting ${rows.length} ${label} `);
      for (let i = 0; i < rows.length; i += size) {
        await model.createMany({ data: rows.slice(i, i + size) });
        process.stdout.write('.');
      }
      process.stdout.write(' done\n');
    };

    await chunk('users', prisma.user, userRows);
    await chunk('sessions', prisma.session, sessionRows);
    // strip helper field tsMs before insert
    const eventInsert = eventRows.map(({ tsMs, ...r }) => r);
    await chunk('session events', prisma.sessionEvent, eventInsert);
    await chunk('autopilot scores', prisma.autopilotScore, scoreRows);
    await chunk('mood entries', prisma.moodEntry, moodRows);

    console.log('\n✅ synthetic data inserted.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
