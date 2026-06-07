"""
Head-to-head: trained LSTM vs. the heuristic baseline, on HELD-OUT sessions.

Answers the question train.py's accuracy number cannot: does the learned model
actually beat `PredictionService.predictHeuristic` ("the math")? Stratified
train/test split, LSTM trained on train-only, both scored on the same test set.
Reports threshold-independent ROC-AUC + PR-AUC, plus accuracy/precision/recall/F1.

  cd apps/ml
  export DATABASE_URL="$(grep '^DIRECT_URL=' ../api/.env | cut -d= -f2- | tr -d '\"')"
  python evaluate.py
"""
from __future__ import annotations
import math, os, sys
from typing import List, Tuple

FEATURE_ORDER = [
    "scrollVelocity", "tabSwitchCount", "clickRate", "passiveTime", "activeTime",
    "scrollDepthPercent", "pageResetCount", "secondsSinceIntent", "hourOfDay", "runningDrift",
]
N = len(FEATURE_ORDER)
F = {name: i for i, name in enumerate(FEATURE_ORDER)}
SEED = 42
TEST_FRAC = 0.2


def load(database_url):
    import psycopg
    cols = ", ".join(f'"{c}"' for c in FEATURE_ORDER)
    q = f'SELECT "sessionId", {cols}, "onsetLabel" FROM "SessionEvent" WHERE "onsetLabel" IS NOT NULL ORDER BY "sessionId", "timestamp" ASC'
    seqs, labs, cur, cs, cl = [], [], None, [], []
    with psycopg.connect(database_url) as conn, conn.cursor() as c:
        c.execute(q)
        for row in c:
            sid = row[0]
            feats = [float(x) if x is not None else 0.0 for x in row[1:1 + N]]
            lab = 1 if row[1 + N] else 0
            if sid != cur:
                if cs:
                    seqs.append(cs); labs.append(cl)
                cur, cs, cl = sid, [], []
            cs.append(feats); cl.append(lab)
        if cs:
            seqs.append(cs); labs.append(cl)
    # sequence-level label = onset anywhere (same as train.py)
    y = [1 if any(l) else 0 for l in labs]
    return seqs, y


# ---- heuristic port (must match prediction.service.ts predictHeuristic) ----
def clamp01(x): return max(0.0, min(1.0, x))
def sigmoid(z): return 1.0 / (1.0 + math.exp(-z))

def slope(ys):
    n = len(ys)
    if n < 2: return 0.0
    mx = (n - 1) / 2; my = sum(ys) / n
    num = sum((i - mx) * (ys[i] - my) for i in range(n))
    den = sum((i - mx) ** 2 for i in range(n))
    return 0.0 if den == 0 else num / den

def heuristic(seq):
    last = seq[-1]
    drift = [s[F["runningDrift"]] for s in seq]
    pr = []
    for s in seq:
        tot = s[F["passiveTime"]] + s[F["activeTime"]]
        pr.append(0.0 if tot == 0 else s[F["passiveTime"]] / tot)
    z = (-2.6
         + 6.0 * clamp01(slope(drift) / 8)
         + 2.5 * clamp01(last[F["runningDrift"]] / 100)
         + 2.0 * clamp01(slope(pr) * 4)
         + 1.5 * pr[-1]
         + 2.0 * clamp01(slope([s[F["pageResetCount"]] for s in seq]))
         + 1.0 * clamp01(last[F["scrollDepthPercent"]] / 100))
    return sigmoid(z)


# ---- metrics (no sklearn dependency) ----
def roc_auc(y, p):
    pairs = sorted(zip(p, y))
    ranks = [0.0] * len(pairs); i = 0
    while i < len(pairs):
        j = i
        while j + 1 < len(pairs) and pairs[j + 1][0] == pairs[i][0]:
            j += 1
        r = (i + j) / 2 + 1
        for k in range(i, j + 1): ranks[k] = r
        i = j + 1
    npos = sum(y); nneg = len(y) - npos
    if npos == 0 or nneg == 0: return float("nan")
    sum_pos = sum(ranks[k] for k in range(len(pairs)) if pairs[k][1] == 1)
    return (sum_pos - npos * (npos + 1) / 2) / (npos * nneg)

def pr_auc(y, p):
    order = sorted(range(len(p)), key=lambda k: -p[k])
    tp = fp = 0; fn = sum(y); prev_r = 0.0; area = 0.0; last_prec = 1.0
    for k in order:
        if y[k] == 1: tp += 1; fn -= 1
        else: fp += 1
        prec = tp / (tp + fp); rec = tp / (tp + fn) if (tp + fn) else 0.0
        area += (rec - prev_r) * prec; prev_r = rec; last_prec = prec
    return area

def at_threshold(y, p, t):
    tp = sum(1 for i in range(len(y)) if p[i] >= t and y[i] == 1)
    fp = sum(1 for i in range(len(y)) if p[i] >= t and y[i] == 0)
    fn = sum(1 for i in range(len(y)) if p[i] < t and y[i] == 1)
    tn = sum(1 for i in range(len(y)) if p[i] < t and y[i] == 0)
    acc = (tp + tn) / len(y)
    prec = tp / (tp + fp) if (tp + fp) else 0.0
    rec = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
    return acc, prec, rec, f1

def best_f1(y, p):
    best = (0.5, 0.0)
    for t in [i / 100 for i in range(1, 100)]:
        _, _, _, f1 = at_threshold(y, p, t)
        if f1 > best[1]: best = (t, f1)
    return best


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: set DATABASE_URL (use DIRECT_URL).", file=sys.stderr); return 2
    import numpy as np, torch, torch.nn as nn
    from torch.nn.utils.rnn import pad_sequence

    seqs, y = load(url)
    print(f"{len(seqs)} labeled sessions | positives={sum(y)} ({100*sum(y)/len(y):.1f}%)")

    rng = np.random.default_rng(SEED)
    pos = [i for i in range(len(y)) if y[i] == 1]; neg = [i for i in range(len(y)) if y[i] == 0]
    rng.shuffle(pos); rng.shuffle(neg)
    def split(idx): k = int(round(len(idx) * TEST_FRAC)); return idx[k:], idx[:k]
    tr_p, te_p = split(pos); tr_n, te_n = split(neg)
    train_idx = tr_p + tr_n; test_idx = te_p + te_n
    print(f"train={len(train_idx)} (pos={len(tr_p)})  test={len(test_idx)} (pos={len(te_p)})")

    all_steps = np.array([t for i in train_idx for t in seqs[i]], dtype=np.float32)
    mean = all_steps.mean(axis=0); std = all_steps.std(axis=0); std[std == 0] = 1.0
    def norm(s): return torch.from_numpy((np.array(s, dtype=np.float32) - mean) / std)

    torch.manual_seed(SEED)
    Xtr = [norm(seqs[i]) for i in train_idx]
    ytr = torch.tensor([float(y[i]) for i in train_idx])
    Xtr_pad = pad_sequence(Xtr, batch_first=True)

    class OnsetLSTM(nn.Module):
        def __init__(self):
            super().__init__()
            self.lstm = nn.LSTM(N, 64, batch_first=True)
            self.head = nn.Sequential(nn.Linear(64, 1), nn.Sigmoid())
        def forward(self, x):
            out, _ = self.lstm(x); return self.head(out[:, -1, :]).squeeze(-1)

    model = OnsetLSTM(); opt = torch.optim.Adam(model.parameters(), lr=1e-3); loss_fn = nn.BCELoss()
    model.train()
    for ep in range(80):
        opt.zero_grad(); loss = loss_fn(model(Xtr_pad), ytr); loss.backward(); opt.step()

    model.eval()
    with torch.no_grad():
        lstm_p = [float(model(norm(seqs[i]).unsqueeze(0))[0]) for i in test_idx]
    heur_p = [heuristic(seqs[i]) for i in test_idx]
    yte = [y[i] for i in test_idx]

    print("\n================  HELD-OUT TEST (sequence-level)  ================")
    print(f"test positives: {sum(yte)}/{len(yte)} ({100*sum(yte)/len(yte):.1f}%)  "
          f"— a no-skill model scores AUC 0.50, accuracy {max(sum(yte),len(yte)-sum(yte))/len(yte):.2f}")
    print(f"\n{'model':<12}{'ROC-AUC':>9}{'PR-AUC':>9}{'acc@.5':>9}{'prec@.5':>9}{'rec@.5':>9}{'F1@.5':>8}{'bestF1':>8}")
    for name, p in [("HEURISTIC", heur_p), ("LSTM", lstm_p)]:
        acc, prec, rec, f1 = at_threshold(yte, p, 0.5)
        bt, bf = best_f1(yte, p)
        print(f"{name:<12}{roc_auc(yte,p):>9.3f}{pr_auc(yte,p):>9.3f}{acc:>9.3f}{prec:>9.3f}{rec:>9.3f}{f1:>8.3f}{bf:>8.3f}")

    a_h, a_l = roc_auc(yte, heur_p), roc_auc(yte, lstm_p)
    print("\nVERDICT:")
    if a_l > a_h + 0.02:
        print(f"  LSTM beats the heuristic on AUC ({a_l:.3f} vs {a_h:.3f}).")
    elif a_h > a_l + 0.02:
        print(f"  Heuristic beats the LSTM on AUC ({a_h:.3f} vs {a_l:.3f}). The math wins.")
    else:
        print(f"  Roughly tied on AUC ({a_l:.3f} LSTM vs {a_h:.3f} heuristic) — no clear win.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
