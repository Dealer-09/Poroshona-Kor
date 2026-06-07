import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * One per-timestep feature vector. THIS IS THE MODEL INPUT CONTRACT.
 *
 * The order/columns here MUST match:
 *   - the columns persisted in `SessionEvent` (apps/api/prisma/schema.prisma)
 *   - the feature order used by the Python trainer (apps/ml/train.py FEATURE_ORDER)
 *   - the input tensor layout of the exported ONNX model
 *
 * If you add/remove/reorder a feature, update all four places together.
 */
export interface PredictionFeature {
  scrollVelocity: number;
  tabSwitchCount: number;
  clickRate: number;
  passiveTime: number;
  activeTime: number;
  scrollDepthPercent: number;
  pageResetCount: number;
  secondsSinceIntent: number;
  hourOfDay: number;
  runningDrift: number; // 0–100
}

/** Canonical feature order — shared with the trainer/ONNX model. */
export const FEATURE_ORDER: (keyof PredictionFeature)[] = [
  'scrollVelocity',
  'tabSwitchCount',
  'clickRate',
  'passiveTime',
  'activeTime',
  'scrollDepthPercent',
  'pageResetCount',
  'secondsSinceIntent',
  'hourOfDay',
  'runningDrift',
];

export interface OnsetPredictionResult {
  probability: number; // 0–1
  horizonMinutes: number; // currently always 5
  source: 'heuristic' | 'lstm';
}

const HORIZON_MINUTES = 5;

/**
 * Forward-looking doomscroll-onset predictor.
 *
 * The product goal is to warn the user in the ~5-minute window BEFORE autopilot
 * locks in — i.e. predict onset, not merely report the current drift score.
 *
 * Two interchangeable backends behind one `predictOnset` method:
 *   - 'heuristic' (default): a transparent, online trajectory model. It keys off
 *     the RATE OF CHANGE of drift plus dwell/reset/passive trends, so it can fire
 *     while the absolute score is still moderate — genuinely anticipatory, and a
 *     legitimate baseline for the LSTM to beat.
 *   - 'lstm': a trained sequence model exported to ONNX and run via
 *     onnxruntime-node. Enabled with PREDICTION_SOURCE=lstm once a model exists
 *     and training data has accumulated. Falls back to the heuristic if the model
 *     file is missing or inference fails — so callers never change.
 */
@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);
  private readonly source: 'heuristic' | 'lstm';
  // Lazily-loaded ONNX session (only when source === 'lstm').
  private onnxSession: unknown | null = null;
  private onnxLoadAttempted = false;

  constructor(private readonly configService: ConfigService) {
    this.source =
      this.configService.get<string>('PREDICTION_SOURCE') === 'lstm'
        ? 'lstm'
        : 'heuristic';
    this.logger.log(`PredictionService initialized (source=${this.source})`);
  }

  /**
   * @param window recent per-timestep features, OLDEST-FIRST.
   */
  async predictOnset(
    window: PredictionFeature[],
  ): Promise<OnsetPredictionResult> {
    if (this.source === 'lstm') {
      const lstm = await this.tryPredictLstm(window);
      if (lstm !== null) {
        return {
          probability: lstm,
          horizonMinutes: HORIZON_MINUTES,
          source: 'lstm',
        };
      }
      // fall through to heuristic on any failure
    }
    return {
      probability: this.predictHeuristic(window),
      horizonMinutes: HORIZON_MINUTES,
      source: 'heuristic',
    };
  }

  // ---------------------------------------------------------------------------
  // Heuristic baseline — trajectory / rate-of-change model
  // ---------------------------------------------------------------------------

  private predictHeuristic(window: PredictionFeature[]): number {
    if (window.length === 0) return 0;

    const last = window[window.length - 1];

    // 1. Drift TRAJECTORY: slope of runningDrift across the window (per step).
    //    A rising drift trend is the single strongest leading indicator.
    const driftSlope = this.slope(window.map((w) => w.runningDrift));

    // 2. Current drift level (normalized 0–1) — a high floor raises baseline risk.
    const driftLevel = clamp01(last.runningDrift / 100);

    // 3. Passive-ratio trend: are we tipping from active into passive consumption?
    const passiveRatios = window.map((w) => {
      const total = w.passiveTime + w.activeTime;
      return total === 0 ? 0 : w.passiveTime / total;
    });
    const passiveNow = passiveRatios[passiveRatios.length - 1];
    const passiveSlope = this.slope(passiveRatios);

    // 4. Page-reset acceleration: infinite-feed refreshes ramping up = doomscroll.
    const resetSlope = this.slope(window.map((w) => w.pageResetCount));

    // 5. Scroll-depth saturation: stuck deep in a feed and not climbing back out.
    const depthNow = clamp01(last.scrollDepthPercent / 100);

    // Weighted logistic over leading indicators. Weights chosen so that a clear
    // upward drift+passive trend pushes probability high BEFORE the absolute
    // score would trip the reactive >50 threshold.
    const z =
      -2.6 + // bias: default to "unlikely"; calm sessions sit clearly low
      6.0 * clamp01(driftSlope / 8) + // +8 drift/step over the window ≈ strong
      2.5 * driftLevel +
      2.0 * clamp01(passiveSlope * 4) +
      1.5 * passiveNow +
      2.0 * clamp01(resetSlope) +
      1.0 * depthNow;

    return sigmoid(z);
  }

  /** Least-squares slope of a series against its index (0..n-1). */
  private slope(ys: number[]): number {
    const n = ys.length;
    if (n < 2) return 0;
    const meanX = (n - 1) / 2;
    const meanY = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - meanX) * (ys[i] - meanY);
      den += (i - meanX) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  // ---------------------------------------------------------------------------
  // LSTM backend (Phase 3) — ONNX via onnxruntime-node
  // ---------------------------------------------------------------------------

  /**
   * Returns a probability in [0,1], or null if the model is unavailable / errored
   * (caller then falls back to the heuristic). Kept dependency-light: onnxruntime
   * is require()d lazily so the package is only needed when PREDICTION_SOURCE=lstm.
   */
  private async tryPredictLstm(
    window: PredictionFeature[],
  ): Promise<number | null> {
    try {
      const ort = await this.loadOnnx();
      if (!ort || !this.onnxSession) return null;

      // Build [1, timesteps, features] float tensor in the canonical order.
      const timesteps = window.length;
      const featCount = FEATURE_ORDER.length;
      const data = new Float32Array(timesteps * featCount);
      for (let t = 0; t < timesteps; t++) {
        for (let f = 0; f < featCount; f++) {
          data[t * featCount + f] = Number(window[t][FEATURE_ORDER[f]]) || 0;
        }
      }
      const tensor = new ort.Tensor('float32', data, [1, timesteps, featCount]);
      const session = this.onnxSession as {
        inputNames: string[];
        outputNames: string[];
        run: (feeds: Record<string, unknown>) => Promise<
          Record<string, { data: Float32Array }>
        >;
      };
      const feeds = { [session.inputNames[0]]: tensor };
      const results = await session.run(feeds);
      const out = results[session.outputNames[0]];
      const value = out?.data?.[0];
      if (typeof value !== 'number' || Number.isNaN(value)) return null;
      return clamp01(value);
    } catch (e) {
      this.logger.warn(
        `LSTM inference failed, falling back to heuristic: ${
          (e as Error).message
        }`,
      );
      return null;
    }
  }

  private async loadOnnx(): Promise<{
    Tensor: new (
      type: string,
      data: Float32Array,
      dims: number[],
    ) => unknown;
  } | null> {
    if (this.onnxLoadAttempted) {
      return this.onnxSession
        ? // already loaded; return the cached runtime via the session's constructor
          ((globalThis as Record<string, unknown>).__ort as never)
        : null;
    }
    this.onnxLoadAttempted = true;
    const modelPath =
      this.configService.get<string>('ONNX_MODEL_PATH') ||
      'apps/ml/model.onnx';
    try {
      // Lazy, optional dependency — only loaded in LSTM mode.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ort = require('onnxruntime-node');
      (globalThis as Record<string, unknown>).__ort = ort;
      this.onnxSession = await ort.InferenceSession.create(modelPath);
      this.logger.log(`Loaded ONNX model from ${modelPath}`);
      return ort;
    } catch (e) {
      this.logger.warn(
        `Could not load ONNX model (${modelPath}); using heuristic. ${
          (e as Error).message
        }`,
      );
      this.onnxSession = null;
      return null;
    }
  }
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}
