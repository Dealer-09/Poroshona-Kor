import { PredictionService, PredictionFeature } from './prediction.service';
import { ConfigService } from '@nestjs/config';

describe('PredictionService (heuristic)', () => {
  const service = new PredictionService({
    get: () => undefined,
  } as unknown as ConfigService);

  function feat(runningDrift: number, passive = 5, active = 5): PredictionFeature {
    return {
      scrollVelocity: 200,
      tabSwitchCount: 0,
      clickRate: 1,
      passiveTime: passive,
      activeTime: active,
      scrollDepthPercent: 30,
      pageResetCount: 0,
      secondsSinceIntent: 60,
      hourOfDay: 14,
      runningDrift,
    };
  }

  it('returns ~0 for an empty window and a 5-min horizon', async () => {
    const r = await service.predictOnset([]);
    expect(r.probability).toBe(0);
    expect(r.horizonMinutes).toBe(5);
    expect(r.source).toBe('heuristic');
  });

  it('predicts HIGHER risk for a rising drift trajectory than a flat-low one', async () => {
    const flatLow = [feat(5), feat(6), feat(5), feat(7), feat(6)];
    const rising = [feat(10), feat(25), feat(40), feat(55), feat(70)];

    const low = await service.predictOnset(flatLow);
    const high = await service.predictOnset(rising);

    // The whole point of the predictor: a steep upward trend is anticipatory risk
    // even though neither window's LAST value alone tells the full story.
    expect(high.probability).toBeGreaterThan(low.probability);
    expect(high.probability).toBeGreaterThan(0.5);
    expect(low.probability).toBeLessThan(0.3);
  });

  it('fires early — a rising trend reaches notable risk before drift maxes out', async () => {
    // Drift only in the 30s–50s range (below the reactive >60 intervention gate)
    // but climbing fast. The predictor should already flag meaningful risk.
    const climbing = [feat(20), feat(30), feat(40), feat(50)];
    const r = await service.predictOnset(climbing);
    expect(r.probability).toBeGreaterThan(0.3);
  });

  it('always returns a probability within [0,1]', async () => {
    const extreme = [feat(0), feat(100), feat(100), feat(100)];
    const r = await service.predictOnset(extreme);
    expect(r.probability).toBeGreaterThanOrEqual(0);
    expect(r.probability).toBeLessThanOrEqual(1);
  });
});
