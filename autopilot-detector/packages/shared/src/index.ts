export interface BehavioralSignal {
  scrollVelocity: number;
  tabSwitchCount: number;
  clickRate: number;
  passiveTime: number;
  activeTime: number;
  timestamp: string;
  sessionId: string;
  userId?: string;           // Derived from JWT server-side, not sent by extension
  activeDomain?: string;     // Best-effort metadata from content script
  activeTabTitle?: string;   // Best-effort metadata from content script
  // Stage 2: Infinite scroll detection signals
  scrollDepthPercent?: number; // 0–100, how far down the page the user scrolled
  pageResetCount?: number;     // how many times scrollY reset to near 0, indicating infinite scroll refresh
  // Stage 2: Pomodoro break flag
  isPomodoroBreak?: boolean;   // true when in a Pomodoro break — skip interventions
}

export interface AutopilotScore {
  score: number;
  focusFragmentation: number;
  passiveRatio: number;
  cognitiveDrift: number;
  doomscrollProbability: number;
  timestamp: string;
  sessionId?: string;       // set when emitted over the socket so clients can filter by session
  // Stage 2: Infinite scroll aggregate metrics
  scrollDepthAvg?: number;  // average scroll depth across signals in this batch (0–100)
  pageResetRate?: number;   // resets per minute, signals infinite scroll looping
}

// Stage 3: Forward-looking onset prediction (the "warning system").
// Unlike AutopilotScore which describes the CURRENT state, this is a probability
// that doomscroll/autopilot onset will occur within `horizonMinutes`.
export interface OnsetPrediction {
  sessionId: string;
  probability: number;       // 0–1 likelihood of onset within the horizon
  horizonMinutes: number;    // prediction horizon (currently 5)
  source: 'heuristic' | 'lstm';
  timestamp: string;
}

export interface InterventionEvent {
  type: InterventionType;
  trigger: string;
  message: string;
  sessionId: string;
  timestamp: string;
}

export enum InterventionType {
  NUDGE = 'NUDGE',
  PAUSE = 'PAUSE',
  REFLECTION = 'REFLECTION',
  SLEEP_MODE = 'SLEEP_MODE'
}

export enum AppIntent {
  STUDY = 'STUDY',
  TUTORIAL = 'TUTORIAL',
  ENTERTAINMENT = 'ENTERTAINMENT',
  PRODUCTIVITY = 'PRODUCTIVITY',
  PASSIVE = 'PASSIVE'
}
