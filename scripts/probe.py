"""Does a learned descriptor separate cards where the perceptual hash does not?

The claim under test is that Snapcast's accuracy ceiling and its 4.3s ranking
stage share one cause: a 512-bit pHash+dHash that puts a correct degraded card
at ~205 and an unrelated one at ~220, out of 512. If that is right, a generic
pretrained embedding — with no Magic-specific training at all — should separate
the same images far better.

Controlled: both descriptors see the SAME query images and rank the SAME
reference pool. The queries are perfect crops (counter-rotated, exact card
bounds) so localization is removed and only the descriptor is under test — the
pipeline's own perfect-crop control already showed most misses survive correct
framing.

The hash arm mirrors production exactly: scripts/build_index.py's compute_hashes
for references, and hash.js's queryVariants (raw + contrast-stretched x 4
rotations, min distance) for queries.
"""
import json, os, sys, time
import numpy as np
import cv2
import torch
from PIL import Image

CROPS = "/tmp/probe-crops"
REFS = "/tmp/probe-refs"
HASH_SIZE = 16   # matches build_index.py / hash.js: 2 * 16*16 bits = 64 bytes
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# ---------- production hash (mirrors scripts/build_index.py) ----------

def phash_bits(gray):
    img = cv2.resize(gray, (64, 64), interpolation=cv2.INTER_AREA)
    dct = cv2.dct(img.astype(np.float32))
    low = dct[:HASH_SIZE, :HASH_SIZE]
    return (low > np.median(low)).flatten()

def dhash_bits(gray):
    img = cv2.resize(gray, (HASH_SIZE + 1, HASH_SIZE), interpolation=cv2.INTER_AREA)
    return (img[:, 1:] > img[:, :-1]).flatten()

def compute_hashes_gray(gray):
    return np.concatenate([np.packbits(phash_bits(gray)),
                           np.packbits(dhash_bits(gray))]).astype(np.uint8)

def contrast_stretch(gray):
    s = np.sort(gray.flatten())
    lo = s[int(len(s) * 0.02)]
    hi = s[int(len(s) * 0.98)]
    rng = max(1.0, float(hi - lo))
    return np.clip((gray.astype(np.float32) - lo) / rng * 255.0, 0, 255)

def query_variants(gray):
    """raw + contrast-stretched, x4 rotations — hash.js queryVariants."""
    out = []
    for base in (gray.astype(np.float32), contrast_stretch(gray)):
        img = base
        for _ in range(4):
            out.append(compute_hashes_gray(img))
            img = np.rot90(img, k=-1).copy()   # clockwise, matching rotate90
    return np.stack(out)

POPC = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)

def hamming_min(variants, ref_hashes):
    """Min hamming distance over the 8 variants, for every reference."""
    best = None
    for v in variants:
        d = POPC[np.bitwise_xor(ref_hashes, v[None, :])].sum(axis=1)
        best = d if best is None else np.minimum(best, d)
    return best

# ---------- inputs ----------

meta = json.load(open(os.path.join(CROPS, "meta.json")))
pool_info = json.load(open(os.path.join(REFS, "pool.json")))
pool = [c for c in pool_info["pool"] if os.path.exists(os.path.join(REFS, f"{c}.jpg"))]
pool_idx = {c: i for i, c in enumerate(pool)}
meta = [m for m in meta if m["id"] in pool_idx]
print(f"queries: {len(meta)}   reference pool: {len(pool)}")

# ---------- hash arm ----------

# Reference hashes come from the SHIPPED index rather than being recomputed.
# Recomputing them from the downloaded "normal" images landed a median of 9 bits
# out of 512 away from the real entries, because build_index.py hashes the
# "small" image. That is small against the ~205-vs-220 signal under test, but
# there is no reason to accept any drift when the exact bytes are on disk.
print("\nloading reference hashes from the shipped index…")
t0 = time.time()
REPO = "/Users/zach/Cowork/snapcaster-web/.claude/worktrees/real-life2"
rows = json.load(open(f"{REPO}/public/carddata/cards.json"))
index_all = np.fromfile(f"{REPO}/public/carddata/hashes.bin", dtype=np.uint8).reshape(-1, 64)
row_of = {r[3]: i for i, r in enumerate(rows) if r[4] == 0}
pool = [c for c in pool if c in row_of]
pool_idx = {c: i for i, c in enumerate(pool)}
meta = [m for m in meta if m["id"] in pool_idx]
ref_hashes = np.stack([index_all[row_of[c]] for c in pool])
print(f"  {ref_hashes.shape} from hashes.bin in {time.time()-t0:.1f}s; "
      f"queries now {len(meta)}, pool {len(pool)}")

def hash_rank(fnkey):
    ranks, d_true, d_best_wrong = [], [], []
    for m in meta:
        g = cv2.cvtColor(cv2.imread(os.path.join(CROPS, m[fnkey])), cv2.COLOR_BGR2GRAY)
        d = hamming_min(query_variants(g), ref_hashes)
        t = pool_idx[m["id"]]
        order = np.argsort(d, kind="stable")
        ranks.append(int(np.where(order == t)[0][0]) + 1)
        d_true.append(int(d[t]))
        w = d.copy(); w[t] = 10 ** 6
        d_best_wrong.append(int(w.min()))
    return np.array(ranks), np.array(d_true), np.array(d_best_wrong)

# ---------- embedding arm ----------

# Weights come through timm rather than torch.hub: the facebookresearch/dinov2
# repo now uses `float | None` annotations, which Python 3.9 cannot parse. timm
# hosts the same lvd142m weights, as safetensors, which also has no pickle
# code-execution path.
MODEL_NAME = os.environ.get("PROBE_MODEL", "vit_small_patch14_dinov2.lvd142m")
print(f"\nloading {MODEL_NAME} …")
import timm
model = timm.create_model(MODEL_NAME, pretrained=True, num_classes=0)
model.eval().to(DEVICE)
cfg = timm.data.resolve_data_config({}, model=model)
IMG_SIZE = cfg["input_size"][1]
MEAN = torch.tensor(cfg["mean"]).view(3, 1, 1)
STD = torch.tensor(cfg["std"]).view(3, 1, 1)
print(f"  input {IMG_SIZE}px, mean {cfg['mean']}, std {cfg['std']}")

def load_batch(paths, size=None):
    size = size or IMG_SIZE
    out = []
    for p in paths:
        im = Image.open(p).convert("RGB").resize((size, size), Image.BICUBIC)
        t = torch.from_numpy(np.asarray(im)).permute(2, 0, 1).float() / 255.0
        out.append((t - MEAN) / STD)
    return torch.stack(out)

@torch.no_grad()
def embed(paths, bs=32):
    vecs = []
    for i in range(0, len(paths), bs):
        x = load_batch(paths[i:i + bs]).to(DEVICE)
        v = model(x)
        vecs.append(torch.nn.functional.normalize(v, dim=1).cpu())
    return torch.cat(vecs)

print("embedding references…")
t0 = time.time()
ref_vecs = embed([os.path.join(REFS, f"{c}.jpg") for c in pool])
print(f"  {ref_vecs.shape} in {time.time()-t0:.1f}s")

def embed_rank(fnkey):
    t0 = time.time()
    qv = embed([os.path.join(CROPS, m[fnkey]) for m in meta])
    sims = qv @ ref_vecs.T                       # cosine, both L2-normalised
    ranks, s_true, s_best_wrong = [], [], []
    for i, m in enumerate(meta):
        t = pool_idx[m["id"]]
        s = sims[i]
        order = torch.argsort(s, descending=True)
        ranks.append(int((order == t).nonzero()[0][0]) + 1)
        s_true.append(float(s[t]))
        w = s.clone(); w[t] = -2
        s_best_wrong.append(float(w.max()))
    return (np.array(ranks), np.array(s_true), np.array(s_best_wrong),
            time.time() - t0, qv.shape[1])

# ---------- report ----------

def summarize(label, ranks, sep, higher_is_better):
    n = len(ranks)
    print(f"\n{label}")
    print(f"  top-1        {(ranks==1).sum()}/{n}  ({(ranks==1).mean()*100:.1f}%)")
    print(f"  top-5        {(ranks<=5).sum()}/{n}  ({(ranks<=5).mean()*100:.1f}%)")
    print(f"  median rank  {int(np.median(ranks))}")
    good = sep > 0 if higher_is_better else sep > 0
    print(f"  correct beats best wrong: {good.sum()}/{n} ({good.mean()*100:.1f}%)")
    print(f"  margin  median {np.median(sep):+.4g}   mean {sep.mean():+.4g}")

for key, title in (("perfect", "PERFECT CROP (descriptor test)"),
                   ("file", "CAPTURE CROP (descriptor + localization)")):
    print("\n" + "=" * 68)
    print(title + f"  —  pool of {len(pool)}")
    print("=" * 68)

    r, dt, dw = hash_rank(key)
    # For the hash, lower distance is better, so the margin is wrong-minus-true.
    summarize("pHash+dHash (production, 8 variants)", r, (dw - dt).astype(float), False)
    print(f"  distance: correct median {np.median(dt):.0f}, "
          f"best-wrong median {np.median(dw):.0f}")

    er, st, sw, secs, dim = embed_rank(key)
    summarize(f"{MODEL_NAME} ({dim}-dim, no Magic-specific training)", er, st - sw, True)
    print(f"  cosine: correct median {np.median(st):.3f}, "
          f"best-wrong median {np.median(sw):.3f}")
    print(f"  embedding {len(meta)} queries took {secs:.1f}s on {DEVICE}")
