# Synthetic training data (Phase 3 bootstrap)

Tooling to bootstrap the onset-prediction LSTM with realistic synthetic data
until enough real sessions accumulate. Everything here writes to the same
Postgres the API uses and `apps/ml/train.py` reads from.

## What it generates

`seed-synthetic.ts` simulates many synthetic "users", each running varied
browsing sessions across **all five intents** (STUDY, TUTORIAL, ENTERTAINMENT,
PRODUCTIVITY, PASSIVE) with realistic domains/titles — e.g. a STUDY session that
drifts onto Twitch gameplay, a TUTORIAL that rabbit-holes into YouTube, a PASSIVE
TikTok doomscroll. Each per-tick behavioural signal is fed through the **real**
`AutopilotScoreService`, so the persisted `runningDrift` is exactly what
production would have computed — the data is faithful, not hand-faked. Onset
labels use the identical weak-supervision rule as
`SessionsService.labelSessionEvents` (mood ≤ 3 + sustained drift ≥ 60 within 5 min).

Synthetic users are tagged with the `@synthetic.autopilot.local` email domain so
the whole dataset is isolated and reversible.

## Usage

```bash
cd apps/api

# Simulate + print distribution stats only (no DB writes):
npx ts-node scripts/seed-synthetic.ts --dry

# Generate and insert (wipes any previous synthetic users first):
npx ts-node scripts/seed-synthetic.ts --wipe --users 20

# Remove all synthetic data:
node scripts/purge-synthetic.cjs
```

Flags: `--users N` (default 20), `--seed S` (deterministic), `--wipe`, `--dry`.
Bulk inserts use `DIRECT_URL` (non-pooled) for reliability.

## Retraining the model after seeding

```bash
cd apps/ml
pip install -r requirements.txt          # torch / numpy / psycopg / onnx
# point at the SAME db (use DIRECT_URL — the pooled URL's ?pgbouncer=true is
# rejected by libpq):
export DATABASE_URL="$(grep '^DIRECT_URL=' ../api/.env | cut -d= -f2- | tr -d '\"')"
python train.py --epochs 40 --out model.onnx
```

## Serving

`apps/api/.env` is configured to serve the trained model:

```
PREDICTION_SOURCE=lstm
ONNX_MODEL_PATH=<abs path>/apps/ml/model.onnx
```

The API loads it lazily via `onnxruntime-node` and **falls back to the heuristic
automatically** if the model is missing or errors. Set `PREDICTION_SOURCE`
(unset / anything but `lstm`) to force the heuristic baseline.
