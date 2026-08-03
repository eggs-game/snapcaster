"""Would a two-stage scan preserve the answer, and how much work would it save?

`rank` is ~70% of Real life's wall clock: 10-11 seed crops each scanning all
110,592 printings across 8 rotation/contrast variants. The obvious saving is to
scan a short PREFIX of every hash first, keep the best K, and score only those
in full.

Whether that is safe is an empirical question, not a matter of opinion, and it
is answerable from data already on disk. Two things are measured, against the
REAL 110,592-row index rather than a sample:

  result equivalence — does stage 1's top-K still contain the printing the full
                       scan would have answered? This is what decides whether
                       the optimisation changes any result.
  true-card recall   — does it still contain the correct card? Weaker, but it is
                       the number that matters for accuracy.

Run against the crops written by scripts/harvest_crops.html:
    python3 scripts/probe_prefilter.py
"""
import json, os, sys, time
import numpy as np
import cv2

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CROPS = os.environ.get("PROBE_CROPS", "/tmp/probe-crops")
HASH_SIZE, VEC = 16, 64
PREFIXES = [8, 16, 24, 32]
KS = [500, 1000, 2000, 4000, 8000, 16000]

def phash_bits(g):
    d = cv2.dct(cv2.resize(g, (64, 64), interpolation=cv2.INTER_AREA).astype(np.float32))
    low = d[:HASH_SIZE, :HASH_SIZE]
    return (low > np.median(low)).flatten()

def dhash_bits(g):
    i = cv2.resize(g, (HASH_SIZE + 1, HASH_SIZE), interpolation=cv2.INTER_AREA)
    return (i[:, 1:] > i[:, :-1]).flatten()

def compute_hashes_gray(g):
    return np.concatenate([np.packbits(phash_bits(g)),
                           np.packbits(dhash_bits(g))]).astype(np.uint8)

def contrast_stretch(g):
    s = np.sort(g.flatten())
    lo, hi = s[int(len(s) * 0.02)], s[int(len(s) * 0.98)]
    return np.clip((g.astype(np.float32) - lo) / max(1.0, float(hi - lo)) * 255.0, 0, 255)

def query_variants(g):
    out = []
    for base in (g.astype(np.float32), contrast_stretch(g)):
        img = base
        for _ in range(4):
            out.append(compute_hashes_gray(img))
            img = np.rot90(img, k=-1).copy()
    return np.stack(out)

POPC = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)

def min_dist(variants, index, upto=VEC):
    """Min hamming over the 8 variants, using only the first `upto` bytes."""
    idx = index[:, :upto]
    best = None
    for v in variants:
        d = POPC[np.bitwise_xor(idx, v[:upto][None, :])].sum(axis=1, dtype=np.int32)
        best = d if best is None else np.minimum(best, d)
    return best

def main():
    index = np.fromfile(f"{REPO}/public/carddata/hashes.bin", dtype=np.uint8).reshape(-1, VEC)
    rows = json.load(open(f"{REPO}/public/carddata/cards.json"))
    row_of = {r[3]: i for i, r in enumerate(rows) if r[4] == 0}
    meta = json.load(open(os.path.join(CROPS, "meta.json")))
    n = len(index)
    print(f"index {index.shape}, {len(meta)} queries\n")

    which = sys.argv[1] if len(sys.argv) > 1 else "perfect"
    equiv = {(p, k): 0 for p in PREFIXES for k in KS}
    recall = {(p, k): 0 for p in PREFIXES for k in KS}
    truth_n = 0
    t_full = t_pre = 0.0

    for qi, m in enumerate(meta):
        g = cv2.cvtColor(cv2.imread(os.path.join(CROPS, m[which])), cv2.COLOR_BGR2GRAY)
        qv = query_variants(g)

        t0 = time.time()
        d_full = min_dist(qv, index)
        t_full += time.time() - t0
        top1_full = int(np.argmin(d_full))

        true_row = row_of.get(m["id"])
        has_truth = true_row is not None
        truth_n += has_truth

        for p in PREFIXES:
            t0 = time.time()
            d_pre = min_dist(qv, index, upto=p)
            t_pre += time.time() - t0
            order = np.argsort(d_pre, kind="stable")
            for k in KS:
                keep = order[:k]
                if top1_full in keep:
                    equiv[(p, k)] += 1
                if has_truth and true_row in keep:
                    recall[(p, k)] += 1
        if (qi + 1) % 25 == 0:
            print(f"  {qi+1}/{len(meta)}", flush=True)

    q = len(meta)
    print(f"\n=== {which} crops · {q} queries · index {n} ===")
    print("\nresult equivalence — stage-1 top-K contains the full scan's answer")
    print("prefix |" + "".join(f"{k:>9}" for k in KS))
    for p in PREFIXES:
        print(f"{p:>4}B  |" + "".join(f"{equiv[(p,k)]/q*100:>8.1f}%" for k in KS))
    print(f"\ntrue-card recall — stage-1 top-K contains the correct card (n={truth_n})")
    print("prefix |" + "".join(f"{k:>9}" for k in KS))
    for p in PREFIXES:
        print(f"{p:>4}B  |" + "".join(f"{recall[(p,k)]/max(1,truth_n)*100:>8.1f}%" for k in KS))

    # Cost model. Stage 1 scans `p` of 64 bytes over the whole index; stage 2
    # scans all 64 over K survivors. Speedup is relative to the full scan.
    print("\nprojected rank speedup (work ratio vs the full 64-byte scan)")
    print("prefix |" + "".join(f"{k:>9}" for k in KS))
    for p in PREFIXES:
        cells = []
        for k in KS:
            ratio = (p / VEC) + (k / n)
            cells.append(f"{1/ratio:>8.1f}x")
        print(f"{p:>4}B  |" + "".join(cells))
    print(f"\nmeasured: full scan {t_full/q*1000:.0f}ms/query in numpy "
          f"(production JS is ~{4257/11:.0f}ms per seed, 10-11 seeds)")

if __name__ == "__main__":
    main()
