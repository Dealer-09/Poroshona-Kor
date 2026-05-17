import { Injectable } from '@nestjs/common';
import { BehavioralSignal, AutopilotScore } from '@autopilot/shared';

@Injectable()
export class AutopilotScoreService {
  private readonly MAX_SCROLL_VELOCITY = 5000;

  computeScore(signals: BehavioralSignal[]): AutopilotScore {
    if (!signals || signals.length === 0) {
      return this.getDefaultScore();
    }

    // 1. Avg scroll speed from last 20 signals (0-1 normalized)
    const last20 = signals.slice(-20);
    const avgScroll =
      last20.reduce((acc, s) => acc + s.scrollVelocity, 0) /
      (last20.length || 1);
    const scrollVelocityNormalized = Math.min(
      avgScroll / this.MAX_SCROLL_VELOCITY,
      1,
    );

    // 2. Time Window
    const firstTime = new Date(signals[0].timestamp).getTime();
    const lastTime = new Date(signals[signals.length - 1].timestamp).getTime();
    let timeWindowMinutes = (lastTime - firstTime) / 60000;
    if (timeWindowMinutes <= 0) timeWindowMinutes = 0.1; // fallback to avoid division by zero

    // 3. Tab Switch Rate
    const totalTabSwitches = signals.reduce(
      (acc, s) => acc + s.tabSwitchCount,
      0,
    );
    const tabSwitchRate = totalTabSwitches / timeWindowMinutes;

    // 4. Passive Ratio
    const totalPassive = signals.reduce((acc, s) => acc + s.passiveTime, 0);
    const totalActive = signals.reduce((acc, s) => acc + s.activeTime, 0);
    const passiveRatio =
      totalPassive + totalActive === 0
        ? 0
        : totalPassive / (totalPassive + totalActive);

    // 5. Cognitive Drift
    const cognitiveDrift = tabSwitchRate * 0.4 + passiveRatio * 0.6;

    // 6. Doomscroll Probability
    // Capping tab switch rate impact to prevent overflow
    const doomscrollProbability = Math.min(
      scrollVelocityNormalized * 0.3 +
        passiveRatio * 0.4 +
        (Math.min(tabSwitchRate, 10) / 10) * 0.3,
      1.0,
    );

    // 7. Score (0-100)
    const score = Math.round(doomscrollProbability * 100);

    return {
      score,
      focusFragmentation: tabSwitchRate,
      passiveRatio,
      cognitiveDrift,
      doomscrollProbability,
      timestamp: new Date().toISOString(),
    };
  }

  private getDefaultScore(): AutopilotScore {
    return {
      score: 0,
      focusFragmentation: 0,
      passiveRatio: 0,
      cognitiveDrift: 0,
      doomscrollProbability: 0,
      timestamp: new Date().toISOString(),
    };
  }
}
