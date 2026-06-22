"""
Onset-prediction LSTM trainer (Phase 3).

Reads the per-timestep SessionEvent sequences + weak onset labels that the API
collects (apps/api/prisma/schema.prisma → model SessionEvent), trains a small
LSTM to predict doomscroll-onset within the next ~5 minutes, and exports the
model to ONNX so the NestJS API can serve it via onnxruntime-node with NO code
change (PredictionService, source='lstm').

⚠️  This is scaffolding. It will only produce a useful model once enough labeled
    sessions have accumulated (the SessionEvent table starts empty). Until then
    the API falls back to the transparent heuristic baseline.

FEATURE CONTRACT
----------------
FEATURE_ORDER below MUST stay byte-for-byte aligned with:
  - apps/api/src/prediction/prediction.service.ts  → FEATURE_ORDER
  - the columns persisted in SessionEvent
  - the input tensor layout the API feeds at inference time
If you change features, change all of them together.

USAGE
-----
  pip install -r requirements.txt
  # DATABASE_URL must point at the same Postgres the API writes to
  export DATABASE_URL=postgresql://...
  python train.py --epochs 30 --out model.onnx
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Tuple

# Canonical feature order — see FEATURE CONTRACT above.
FEATURE_ORDER = [
    "scrollVelocity",
    "tabSwitchCount",
    "clickRate",
    "passiveTime",
    "activeTime",
    "scrollDepthPercent",
    "pageResetCount",
    "secondsSinceIntent",
    "hourOfDay",
    "runningDrift",
]
N_FEATURES = len(FEATURE_ORDER)


def load_sequences(database_url: str) -> Tuple[List[List[List[float]]], List[List[int]]]:
    """
    Returns (sequences, labels):
      sequences[i] = list of timesteps for session i; each timestep is a
                     length-N_FEATURES float vector in FEATURE_ORDER.
      labels[i]    = list of 0/1 onset labels aligned per timestep.
    Only sessions that have at least one labeled event are returned.
    """
    import psycopg

    cols = ", ".join(f'"{c}"' for c in FEATURE_ORDER)
    query = f"""
        SELECT "sessionId", {cols}, "onsetLabel"
        FROM "SessionEvent"
        WHERE "onsetLabel" IS NOT NULL
        ORDER BY "sessionId", "timestamp" ASC
    """

    sequences: List[List[List[float]]] = []
    labels: List[List[int]] = []
    cur_session = None
    cur_seq: List[List[float]] = []
    cur_lab: List[int] = []

    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            for row in cur:
                session_id = row[0]
                feats = [float(x) if x is not None else 0.0 for x in row[1 : 1 + N_FEATURES]]
                label = 1 if row[1 + N_FEATURES] else 0
                if session_id != cur_session:
                    if cur_seq:
                        sequences.append(cur_seq)
                        labels.append(cur_lab)
                    cur_session = session_id
                    cur_seq, cur_lab = [], []
                cur_seq.append(feats)
                cur_lab.append(label)
            if cur_seq:
                sequences.append(cur_seq)
                labels.append(cur_lab)

    return sequences, labels


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--layers", type=int, default=1)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--out", type=str, default="model.onnx")
    parser.add_argument(
        "--min-sessions",
        type=int,
        default=20,
        help="Refuse to train on fewer than this many labeled sessions.",
    )
    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: set DATABASE_URL to the API's Postgres.", file=sys.stderr)
        return 2

    import numpy as np
    import torch
    import torch.nn as nn
    from torch.nn.utils.rnn import pad_sequence

    print("Loading labeled SessionEvent sequences...")
    sequences, labels = load_sequences(database_url)
    print(f"  {len(sequences)} labeled sessions found.")
    if len(sequences) < args.min_sessions:
        print(
            f"Not enough data to train (have {len(sequences)}, need "
            f">= {args.min_sessions}). The API will keep using the heuristic "
            f"baseline until more sessions are collected. Exiting.",
            file=sys.stderr,
        )
        return 1

    # Per-feature standardization (fit on all timesteps). Stored into the model
    # as a buffer so inference uses the same scaling without a side file.
    all_steps = np.array([t for seq in sequences for t in seq], dtype=np.float32)
    mean = all_steps.mean(axis=0)
    std = all_steps.std(axis=0)
    std[std == 0] = 1.0

    def to_tensor(seq: List[List[float]]) -> torch.Tensor:
        # Feed RAW features — the model normalizes internally (see forward), so the
        # exact same scaling path is exercised at train and inference time.
        return torch.from_numpy(np.array(seq, dtype=np.float32))

    X = [to_tensor(s) for s in sequences]
    # Sequence-level label = did onset happen anywhere in the session (any step).
    # (The per-step labels remain available for a finer per-timestep variant.)
    y = torch.tensor([1.0 if any(l) else 0.0 for l in labels], dtype=torch.float32)
    lengths = torch.tensor([len(s) for s in sequences])
    X_pad = pad_sequence(X, batch_first=True)  # [N, T, F]

    class OnsetLSTM(nn.Module):
        def __init__(self, n_features, hidden, layers, mean, std):
            super().__init__()
            self.register_buffer("mean", torch.tensor(mean))
            self.register_buffer("std", torch.tensor(std))
            self.lstm = nn.LSTM(
                n_features, hidden, num_layers=layers, batch_first=True
            )
            self.head = nn.Sequential(nn.Linear(hidden, 1), nn.Sigmoid())

        def forward(self, x):
            # x: [batch, timesteps, features] in RAW feature units. Normalize here
            # using the stored buffers so the SAME scaling applies whether the
            # caller is the trainer or the API at inference (which feeds raw
            # features). This makes the normalization part of the exported ONNX
            # graph — without it, train/serve skew silently degrades the model.
            x = (x - self.mean) / self.std
            out, _ = self.lstm(x)
            last = out[:, -1, :]  # last timestep's hidden state
            return self.head(last).squeeze(-1)

    model = OnsetLSTM(N_FEATURES, args.hidden, args.layers, mean, std)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    loss_fn = nn.BCELoss()

    print("Training...")
    model.train()
    for epoch in range(args.epochs):
        opt.zero_grad()
        pred = model(X_pad)
        loss = loss_fn(pred, y)
        loss.backward()
        opt.step()
        if (epoch + 1) % 5 == 0 or epoch == 0:
            acc = ((pred > 0.5).float() == y).float().mean().item()
            print(f"  epoch {epoch + 1:>3}: loss={loss.item():.4f} acc={acc:.3f}")

    # Export to ONNX with a dynamic timesteps axis. Input/output names MUST match
    # what PredictionService reads (it uses session.inputNames[0]/outputNames[0],
    # so names are flexible, but we set them explicitly for clarity).
    model.eval()
    dummy = torch.zeros(1, 1, N_FEATURES)
    torch.onnx.export(
        model,
        dummy,
        args.out,
        input_names=["features"],
        output_names=["onset_probability"],
        dynamic_axes={"features": {1: "timesteps"}},
        opset_version=17,
    )
    print(f"[ok] Exported ONNX model to {args.out}")
    print(
        "Set PREDICTION_SOURCE=lstm and ONNX_MODEL_PATH=<path> in the API env to serve it."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
