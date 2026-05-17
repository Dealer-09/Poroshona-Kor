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

    // 3. Focus Fragmentation (Tab Switch Rate)
    // tabSwitchCount is an absolute counter from the extension.
    // Switches in this window is (last - first)
    const switchesInWindow = Math.max(0, signals[signals.length - 1].tabSwitchCount - signals[0].tabSwitchCount);
    const tabSwitchRatePerMin = switchesInWindow / timeWindowMinutes;
    // Normalize to 0-1 (assume 10 switches per min is 100% fragmented)
    const focusFragmentation = Math.min(tabSwitchRatePerMin / 10, 1.0);

    // 4. Passive Ratio
    const totalPassive = signals.reduce((acc, s) => acc + s.passiveTime, 0);
    const totalActive = signals.reduce((acc, s) => acc + s.activeTime, 0);
    const passiveRatio =
      totalPassive + totalActive === 0
        ? 0
        : totalPassive / (totalPassive + totalActive);

    // 5. Cognitive Drift (0-1)
    const cognitiveDrift = focusFragmentation * 0.4 + passiveRatio * 0.6;

    // 6. Doomscroll Probability & Overall Score
    // Watching YouTube = passiveRatio is ~1.0, so score hits ~75+ easily.
    // Doomscrolling = fast scroll + high passive ratio, hits 90+
    const doomscrollProbability = Math.min(
      (passiveRatio * 0.75) + (focusFragmentation * 0.25) + (scrollVelocityNormalized * 0.3),
      1.0,
    );

    // 7. Score (0-100)
    const score = Math.round(doomscrollProbability * 100);

    return {
      score,
      focusFragmentation,
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
