export interface BehavioralSignal {
  scrollVelocity: number;
  tabSwitchCount: number;
  clickRate: number;
  passiveTime: number;
  activeTime: number;
  timestamp: string;
  sessionId: string;
  userId: string;
  activeDomain: string;
  activeTabTitle: string;
}

export interface AutopilotScore {
  score: number;
  focusFragmentation: number;
  passiveRatio: number;
  cognitiveDrift: number;
  doomscrollProbability: number;
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
  PRODUCTIVITY = 'PRODUCTIVITY'
}
