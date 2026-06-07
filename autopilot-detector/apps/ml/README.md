# Onset Prediction (Phase 3 — behavioral sequence model)

This directory trains the **doomscroll-onset predictor**: a small LSTM over
per-timestep browser-behavior sequences that outputs the probability the user is
about to tip into autopilot within the next ~5 minutes. It turns Poroshona Kor
from a reactive *mirror* into a forward-looking *warning system*.

It is **not** part of the TypeScript build. It's a standalone Python tool that
reads from the same Postgres the API writes to, and emits an ONNX model the API
serves at runtime.

## The pipeline (how the pieces connect)

```
Chrome extension ──signals──▶ API gateway ──persists──▶ SessionEvent (Postgres)
                                                              │
                          mood rating ──labels──▶ onsetLabel  │
                                                              ▼
                                              train.py (this dir): LSTM → model.onnx
                                                              │
                                          PREDICTION_SOURCE=lstm
                                                              ▼
                          API PredictionService ──onnxruntime-node──▶ prediction:risk
```

- **Data collection** is already live: every persisted signal becomes a
  `SessionEvent` row (see `apps/api/prisma/schema.prisma`). The Redis buffer is
  hot working memory; `SessionEvent` is the durable training sequence.
- **Labels** are weak supervision from the post-session mood check. When a user
  rates a session, `SessionsService.labelSessionEvents` walks the event sequence
  and sets `onsetLabel = true` on timesteps that sit in the 5-minute run-up to a
  sustained high-drift period in a poorly-rated session. Good sessions are all
  negatives.
- **Serving** requires no API code change: `PredictionService.predictOnset`
  already has an `lstm` branch that loads `ONNX_MODEL_PATH` via `onnxruntime-node`
  and falls back to the heuristic if the model is missing or errors.

## Feature contract (KEEP IN SYNC)

The per-timestep feature vector and its **order** are defined in four places that
must match exactly:

1. `apps/ml/train.py` → `FEATURE_ORDER`
2. `apps/api/src/prediction/prediction.service.ts` → `FEATURE_ORDER`
3. The columns persisted into `SessionEvent`
4. The ONNX model's input tensor layout

Current order:

```
scrollVelocity, tabSwitchCount, clickRate, passiveTime, activeTime,
scrollDepthPercent, pageResetCount, secondsSinceIntent, hourOfDay, runningDrift
```

`runningDrift` is the **corrected** drift score (0–100) — note the score engine
was fixed so sub-scores are no longer mutated; the model learns from clean
features. If you add/remove/reorder a feature, update all four and retrain.

## Usage

```bash
pip install -r requirements.txt

# Point at the SAME database the API uses (the schema's DATABASE_URL).
export DATABASE_URL="postgresql://user:pass@host:5432/postgres"

python train.py --epochs 30 --out model.onnx
```

`train.py` refuses to train on fewer than `--min-sessions` labeled sessions
(default 20) — until then there simply isn't enough data, and the API keeps
serving the heuristic baseline. That's expected: the dataset grows as people use
the extension.

To serve a trained model, set in the API env:

```
PREDICTION_SOURCE=lstm
ONNX_MODEL_PATH=/absolute/path/to/model.onnx
```

and `npm i onnxruntime-node` in `apps/api`.

## Research framing

This is the basis for an HCI contribution: *early-onset detection of problematic
browsing via behavioral sequence modeling*. The heuristic in
`PredictionService` is the baseline; the LSTM here is the learned model; the
mood check is the label source; `SessionEvent` is the corpus. Report the LSTM's
AUC/precision-recall against the heuristic on held-out sessions.
