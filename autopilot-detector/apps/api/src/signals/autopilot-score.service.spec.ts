import { AutopilotScoreService } from './autopilot-score.service';
import { BehavioralSignal, AppIntent } from '@autopilot/shared';
import { ContentClassification } from './content-classification.service';

/**
 * Regression tests for the score-engine data-quality fixes (A1).
 * These features are persisted as ML training inputs, so their correctness is
 * load-bearing for the prediction model.
 */
describe('AutopilotScoreService', () => {
  const service = new AutopilotScoreService();

  function signal(overrides: Partial<BehavioralSignal> = {}): BehavioralSignal {
    return {
      scrollVelocity: 100,
      tabSwitchCount: 0,
      clickRate: 1,
      passiveTime: 8,
      activeTime: 2,
      timestamp: new Date().toISOString(),
      sessionId: 's1',
      ...overrides,
    };
  }

  it('returns the RAW passiveRatio as a sub-score even when intent forgives passive time', () => {
    // 80% passive. Under STUDY+lecture the OLD code mutated passiveRatio to 5% of
    // itself and returned that. The fix must return the true 0.8.
    const signals = [
      signal({ passiveTime: 8, activeTime: 2, timestamp: '2026-06-07T10:00:00.000Z' }),
      signal({ passiveTime: 8, activeTime: 2, timestamp: '2026-06-07T10:00:30.000Z' }),
    ];
    const classification: ContentClassification = {
      isRelevantToIntent: true,
      contentType: 'lecture',
      reason: 'test',
      confidence: 0.9,
      aiPowered: true,
    };
    const result = service.computeScore(signals, AppIntent.STUDY, classification);
    expect(result.passiveRatio).toBeCloseTo(0.8, 5);
  });

  it('derives cognitiveDrift from the RAW passiveRatio (not the intent-adjusted value)', () => {
    const signals = [
      signal({ passiveTime: 8, activeTime: 2, tabSwitchCount: 0, timestamp: '2026-06-07T10:00:00.000Z' }),
      signal({ passiveTime: 8, activeTime: 2, tabSwitchCount: 0, timestamp: '2026-06-07T10:00:30.000Z' }),
    ];
    const classification: ContentClassification = {
      isRelevantToIntent: true,
      contentType: 'lecture',
      reason: 'test',
      confidence: 0.9,
      aiPowered: true,
    };
    const result = service.computeScore(signals, AppIntent.STUDY, classification);
    // cognitiveDrift = focusFragmentation*0.4 + passiveRatio*0.6.
    // focusFragmentation here is 0 (no tab switches), so it must equal 0.8*0.6.
    expect(result.cognitiveDrift).toBeCloseTo(0.8 * 0.6, 5);
  });

  it('does not inflate pageResetRate for a single isolated reset', () => {
    // All same timestamp → degenerate window. OLD code divided by 0.1 min → ×10
    // so 1 reset reported as 10/min and tripped the >2 doomscroll threshold.
    // The fix floors the rate window so a SINGLE reset cannot exceed 2/min.
    const ts = '2026-06-07T10:00:00.000Z';
    const signals = [
      signal({ pageResetCount: 0, timestamp: ts }),
      signal({ pageResetCount: 1, timestamp: ts }),
    ];
    const result = service.computeScore(signals, AppIntent.PASSIVE);
    expect(result.pageResetRate!).toBeLessThanOrEqual(2);
  });

  it('still registers a genuine cluster of page resets as a high rate', () => {
    // 10 resets over ~1 minute should read as a clear doomscroll signal (>2/min).
    const signals = [
      signal({ pageResetCount: 0, timestamp: '2026-06-07T10:00:00.000Z' }),
      signal({ pageResetCount: 10, timestamp: '2026-06-07T10:01:00.000Z' }),
    ];
    const result = service.computeScore(signals, AppIntent.PASSIVE);
    expect(result.pageResetRate!).toBeGreaterThan(2);
  });

  it('clamps score to [0,100] and never emits NaN on empty signals', () => {
    const empty = service.computeScore([], AppIntent.STUDY);
    expect(empty.score).toBe(0);
    expect(Number.isNaN(empty.score)).toBe(false);

    const heavy = service.computeScore(
      [
        signal({ scrollVelocity: 99999, passiveTime: 100, activeTime: 0, tabSwitchCount: 0, timestamp: '2026-06-07T10:00:00.000Z' }),
        signal({ scrollVelocity: 99999, passiveTime: 100, activeTime: 0, tabSwitchCount: 50, timestamp: '2026-06-07T10:01:00.000Z' }),
      ],
      AppIntent.STUDY,
      { isRelevantToIntent: false, contentType: 'social', reason: 't', confidence: 0.9, aiPowered: true },
    );
    expect(heavy.score).toBeGreaterThanOrEqual(0);
    expect(heavy.score).toBeLessThanOrEqual(100);
  });
});
