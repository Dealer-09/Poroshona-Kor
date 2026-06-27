import { Injectable } from '@nestjs/common';
import { BehavioralSignal, AutopilotScore, AppIntent } from '@autopilot/shared';
import { ContentClassification } from './content-classification.service';

@Injectable()
export class AutopilotScoreService {
  private readonly MAX_SCROLL_VELOCITY = 5000;
  // The extension emits ~2 signals per batch roughly every 4s, i.e. one signal
  // every ~2s. Used to estimate the time window when timestamps are degenerate.
  private readonly APPROX_SECONDS_PER_SIGNAL = 2;
  // Minimum window (minutes) for rate-per-minute extrapolation, so short bursts
  // don't blow up into fake doomscroll signals.
  private readonly RESET_RATE_MIN_WINDOW = 0.5;

  computeScore(
    signals: BehavioralSignal[],
    intent?: AppIntent,
    classification?: ContentClassification,
  ): AutopilotScore {
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

    // 2. Time Window (true elapsed time across the signal window)
    const firstTime = new Date(signals[0].timestamp).getTime();
    const lastTime = new Date(signals[signals.length - 1].timestamp).getTime();
    let timeWindowMinutes = (lastTime - firstTime) / 60000;
    // When the window is degenerate (single timestamp / clock skew), estimate it
    // from the number of signals (~APPROX_SECONDS_PER_SIGNAL apart) instead of an
    // arbitrary tiny constant.
    if (timeWindowMinutes <= 0) {
      timeWindowMinutes =
        (signals.length * this.APPROX_SECONDS_PER_SIGNAL) / 60;
    }

    // Stage 2: Scroll depth + page reset aggregates
    const scrollDepthAvg =
      signals.reduce((acc, s) => acc + (s.scrollDepthPercent ?? 0), 0) /
      (signals.length || 1);
    const totalPageResets = signals.reduce(
      (acc, s) => acc + (s.pageResetCount ?? 0),
      0,
    );
    // resets per minute. Floor the rate-computation window at RESET_RATE_MIN_WINDOW
    // so a single isolated reset in a sub-minute batch can't extrapolate into a
    // fake doomscroll spike (the OLD code divided by 0.1 → ×10). The doomscroll
    // branch treats >2 resets/min as significant, so this floor means you need a
    // genuine cluster of resets, not one, to register.
    const rateWindowMinutes = Math.max(
      timeWindowMinutes,
      this.RESET_RATE_MIN_WINDOW,
    );
    const pageResetRate = totalPageResets / rateWindowMinutes;

    // 3. Focus Fragmentation (Tab Switch Rate)
    // tabSwitchCount is an absolute counter from the extension.
    // Switches in this window is (last - first)
    const switchesInWindow = Math.max(
      0,
      signals[signals.length - 1].tabSwitchCount - signals[0].tabSwitchCount,
    );
    const tabSwitchRatePerMin = switchesInWindow / timeWindowMinutes;
    // Normalize to 0-1 (assume 10 switches per min is 100% fragmented)
    const focusFragmentation = Math.min(tabSwitchRatePerMin / 10, 1.0);

    // 4. Passive Ratio
    const totalPassive = signals.reduce((acc, s) => acc + s.passiveTime, 0);
    const totalActive = signals.reduce((acc, s) => acc + s.activeTime, 0);
    let passiveRatio =
      totalPassive + totalActive === 0
        ? 0
        : totalPassive / (totalPassive + totalActive);

    // Find the most frequent activeDomain in the signals window
    const domainCounts: Record<string, number> = {};
    for (const sig of signals) {
      const domain = sig.activeDomain || 'unknown';
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }
    const dominantDomain = Object.entries(domainCounts)
      .reduce((a, b) => (b[1] > a[1] ? b : a), ['unknown', 0])[0]
      .toLowerCase();

    const isSocial =
      dominantDomain.includes('twitter.com') ||
      dominantDomain.includes('x.com') ||
      dominantDomain.includes('facebook.com') ||
      dominantDomain.includes('instagram.com') ||
      dominantDomain.includes('reddit.com') ||
      dominantDomain.includes('tiktok.com');

    const isEntertainment =
      dominantDomain.includes('youtube.com') ||
      dominantDomain.includes('netflix.com') ||
      dominantDomain.includes('twitch.tv') ||
      dominantDomain.includes('disneyplus.com') ||
      dominantDomain.includes('hulu.com');

    const isStudyDomain =
      dominantDomain.includes('wikipedia.org') ||
      dominantDomain.includes('github.com') ||
      dominantDomain.includes('stackoverflow.com') ||
      dominantDomain.includes('docs.') ||
      dominantDomain.includes('medium.com') ||
      dominantDomain.includes('dev.to') ||
      dominantDomain.includes('coursera.org') ||
      dominantDomain.includes('edx.org') ||
      dominantDomain.includes('khanacademy.org');

    let doomscrollProbability = 0;

    // NOTE: `passiveRatio` (computed above) is the RAW passive ratio and is
    // returned as a sub-score / persisted as an ML feature — it must NEVER be
    // mutated. The intent-penalty matrix below "forgives" passive time only for
    // the purpose of computing `doomscrollProbability`, so it works on a LOCAL
    // `adjustedPassive` copy. cognitiveDrift is likewise derived from the raw
    // passiveRatio further down.

    // Apply Contextual Intent Penalty Matrix
    if (intent === AppIntent.STUDY) {
      const contentType = classification?.contentType;
      const isRelevant = classification?.isRelevantToIntent ?? false;

      if (contentType === 'lecture' || contentType === 'tutorial') {
        // Watching a relevant educational video — passive time is fully forgiven.
        // But fast scroll (e.g. skipping through comments) still counts.
        const adjustedPassive = passiveRatio * 0.05;
        doomscrollProbability =
          adjustedPassive * 0.3 +
          focusFragmentation * 0.4 +
          scrollVelocityNormalized * 0.5;
      } else if (contentType === 'reading') {
        // Reading domain (Wikipedia, docs, GitHub). Slow scroll = engaged = good.
        // Zero scroll over a long passive window = possibly zoned out = mild penalty.
        const isZonedOut =
          scrollVelocityNormalized < 0.02 && passiveRatio > 0.8;
        if (isZonedOut) {
          // User is staring at a page without reading — mild increase
          doomscrollProbability =
            passiveRatio * 0.4 + focusFragmentation * 0.3 + 0.1; // flat bump for idle staring
        } else {
          // Actively reading / slow-scrolling — fully forgiven
          const adjustedPassive = passiveRatio * 0.2;
          doomscrollProbability =
            adjustedPassive * 0.3 +
            focusFragmentation * 0.3 +
            scrollVelocityNormalized * 0.2;
        }
      } else if (contentType === 'gaming' || contentType === 'entertainment') {
        // Explicitly off-task content during STUDY — heavy penalty
        doomscrollProbability =
          passiveRatio * 0.75 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
        doomscrollProbability = doomscrollProbability * 1.6 + 0.25;
      } else if (contentType === 'social') {
        // Social feed during study — heavy penalty
        doomscrollProbability =
          passiveRatio * 0.75 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
        doomscrollProbability = doomscrollProbability * 1.5 + 0.2;
      } else {
        // Unknown content type — fall back to domain-based rules
        const adjustedPassive = isStudyDomain ? passiveRatio * 0.4 : passiveRatio;
        doomscrollProbability =
          adjustedPassive * 0.75 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
        // If domain looks like entertainment but classification unknown, still penalize
        if ((isSocial || isEntertainment) && !isRelevant) {
          doomscrollProbability = doomscrollProbability * 1.5 + 0.2;
        }
      }
    } else if (intent === AppIntent.TUTORIAL) {
      const contentType = classification?.contentType;
      const isRelevant = classification?.isRelevantToIntent ?? false;

      if (contentType === 'tutorial' || contentType === 'lecture') {
        // Watching a relevant tutorial/lecture video — fully forgiven
        const adjustedPassive = passiveRatio * 0.15;
        doomscrollProbability =
          adjustedPassive * 0.3 +
          focusFragmentation * 0.3 +
          scrollVelocityNormalized * 0.3;
      } else if (contentType === 'gaming' || contentType === 'entertainment') {
        // Off-task entertainment during TUTORIAL — heavy penalty!
        doomscrollProbability =
          passiveRatio * 0.75 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
        doomscrollProbability = doomscrollProbability * 1.6 + 0.25;
      } else if (contentType === 'social') {
        // Social media feed during tutorial — heavy penalty
        doomscrollProbability =
          passiveRatio * 0.75 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
        doomscrollProbability = doomscrollProbability * 1.5 + 0.2;
      } else {
        // Unknown content type — fall back to domain checks
        if (isSocial) {
          doomscrollProbability =
            (passiveRatio * 0.75 +
              focusFragmentation * 0.25 +
              scrollVelocityNormalized * 0.3) *
              1.3 +
            0.15;
        } else if (isEntertainment && !isRelevant) {
          // General entertainment video (not classified as tutorial)
          doomscrollProbability =
            (passiveRatio * 0.75 +
              focusFragmentation * 0.25 +
              scrollVelocityNormalized * 0.3) *
              1.5 +
            0.2;
        } else {
          // If it is a generic educational domain or unknown, let it pass
          doomscrollProbability =
            passiveRatio * 0.75 +
            focusFragmentation * 0.25 +
            scrollVelocityNormalized * 0.3;
        }
      }
    } else if (intent === AppIntent.ENTERTAINMENT) {
      // Staring passively is fine for entertainment
      const adjustedPassive = passiveRatio * 0.1;

      // But catch the high-anxiety doomscroll / task-switch loop
      if (scrollVelocityNormalized > 0.4 && focusFragmentation > 0.3) {
        doomscrollProbability =
          (focusFragmentation * 0.6 + scrollVelocityNormalized * 0.6) * 1.4;
      } else {
        doomscrollProbability =
          adjustedPassive * 0.5 +
          focusFragmentation * 0.25 +
          scrollVelocityNormalized * 0.3;
      }
    } else if (intent === AppIntent.PRODUCTIVITY) {
      // Productivity allows a mix of tools: GitHub, LinkedIn, Docs, Tutorials (YouTube)
      const isProductiveDomain =
        isStudyDomain ||
        dominantDomain.includes('linkedin.com') ||
        dominantDomain.includes('youtube.com');

      doomscrollProbability =
        passiveRatio * 0.6 +
        focusFragmentation * 0.2 +
        scrollVelocityNormalized * 0.3;

      if (!isProductiveDomain && (isSocial || isEntertainment)) {
        // Off-task during Productivity intent
        doomscrollProbability = doomscrollProbability * 1.4 + 0.15;
      } else if (isProductiveDomain) {
        // High focus on productivity tasks is good, reduce score
        doomscrollProbability = doomscrollProbability * 0.7;
      }
    } else {
      // Default fallback (no intent or unknown)
      // Stage 2: weight page resets heavily — they are the strongest doomscroll signal
      doomscrollProbability =
        scrollVelocityNormalized * 0.25 +
        passiveRatio * 0.30 +
        focusFragmentation * 0.20 +
        (pageResetRate > 2 ? 0.25 : (pageResetRate / 2) * 0.25); // caps at 0.25
    }

    // Keep within bounds [0, 1]
    doomscrollProbability = Math.max(0, Math.min(doomscrollProbability, 1.0));

    // 5. Cognitive Drift (0-1) — derived from the RAW passiveRatio (not the
    // intent-adjusted local used for doomscrollProbability above), so it remains
    // a faithful, intent-independent measure suitable as an ML feature.
    const cognitiveDrift = focusFragmentation * 0.4 + passiveRatio * 0.6;

    // 6. Score (0-100).
    // NOTE: the headline score is currently exactly doomscrollProbability * 100.
    // focusFragmentation / passiveRatio / cognitiveDrift are reported as
    // independent sub-scores/features but do NOT (yet) blend into `score`.
    // Downstream ML treats `score` (== runningDrift) and the sub-scores as
    // separate features accordingly.
    const score = Math.round(doomscrollProbability * 100);

    return {
      score,
      focusFragmentation,
      passiveRatio,
      cognitiveDrift,
      doomscrollProbability,
      timestamp: new Date().toISOString(),
      // Stage 2: include infinite scroll metrics in the returned score
      scrollDepthAvg: Math.round(scrollDepthAvg),
      pageResetRate: Math.round(pageResetRate * 100) / 100,
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
      scrollDepthAvg: 0,
      pageResetRate: 0,
    };
  }
}
