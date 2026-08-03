"""Can local-feature retrieval beat the perceptual hash as the RETRIEVAL stage?

ORB art verification is the pipeline's most precise pathway (97.4% on the
production baseline) but it only ever re-ranks the hash's top 24, so when the
hash fails to surface a card — 30 of 45 misses — the best descriptor never
votes. This asks whether local features can do the surfacing themselves.

Method is the classical instance-retrieval stack, which predates deep learning
and is built for exactly this problem: find THIS image in a large database
despite viewpoint, lighting and partial occlusion.

  descriptors -> vocabulary (k-means) -> VLAD aggregation -> power+L2 norm -> PCA

Controlled the same way as scripts/probe.py: identical query images (the
production baseline's own perfect crops) and an identical reference pool, so the
only thing that changes is the descriptor. The hash arm's number to beat on
these exact inputs is 74.0% top-1.

    python3 scripts/probe_vlad.py [n_clusters] [pca_dims]
"""
import json, os, sys, time
import numpy as np
import cv2

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CROPS = os.environ.get("PROBE_CROPS", "/tmp/probe-crops")
REFS = os.environ.get("PROBE_REFS", "/tmp/probe-refs")
CARD_W, CARD_H = 244, 340          # same normalisation build_index.py uses
K = int(sys.argv[1]) if len(sys.argv) > 1 else 64
PCA_DIM = int(sys.argv[2]) if len(sys.argv) > 2 else 256

# Every Magic card shares a frame, a mana row, a type line and a text box. Those
# generate most of the keypoints and are identical across cards, so a global
# aggregate can be dominated by furniture rather than by the art that actually
# distinguishes one printing from another. PROBE_ART=1 restricts to the art
# window (the same region recognizer.js uses for its art hash) to test that.
ART = (0.08, 0.92, 0.10, 0.56)
ART_ONLY = os.environ.get("PROBE_ART") == "1"

def load_gray(path):
    img = cv2.imread(path)
    if img is None:
        return None
    img = cv2.resize(img, (CARD_W, CARD_H), interpolation=cv2.INTER_AREA)
    if ART_ONLY:
        x0, x1, y0, y1 = ART
        img = img[int(CARD_H * y0):int(CARD_H * y1), int(CARD_W * x0):int(CARD_W * x1)]
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

sift = cv2.SIFT_create(nfeatures=400)

def describe(gray):
    _, des = sift.detectAndCompute(gray, None)
    if des is None or len(des) == 0:
        return np.zeros((0, 128), np.float32)
    # RootSIFT: L1-normalise then square-root. A standard, free accuracy gain —
    # it makes Euclidean distance behave like the Hellinger kernel.
    des = des / np.maximum(des.sum(axis=1, keepdims=True), 1e-7)
    return np.sqrt(des).astype(np.float32)

def vlad(des, centers):
    """Aggregate descriptors into one fixed-length vector of residual sums."""
    if len(des) == 0:
        return np.zeros(centers.shape[0] * centers.shape[1], np.float32)
    d2 = ((des[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    assign = d2.argmin(axis=1)
    V = np.zeros_like(centers)
    for k in range(centers.shape[0]):
        m = assign == k
        if m.any():
            V[k] = (des[m] - centers[k]).sum(axis=0)
    V = V.flatten()
    V = np.sign(V) * np.sqrt(np.abs(V))          # power law
    n = np.linalg.norm(V)
    return (V / n if n > 0 else V).astype(np.float32)

def main():
    meta = json.load(open(os.path.join(CROPS, "meta.json")))
    pool = json.load(open(os.path.join(REFS, "pool.json")))["pool"]
    pool = [c for c in pool if os.path.exists(os.path.join(REFS, f"{c}.jpg"))]
    pidx = {c: i for i, c in enumerate(pool)}
    meta = [m for m in meta if m["id"] in pidx]
    print(f"{len(meta)} queries, {len(pool)} references, k={K}, pca={PCA_DIM}\n")

    t0 = time.time()
    print("describing references…")
    ref_des = []
    for i, c in enumerate(pool):
        ref_des.append(describe(load_gray(os.path.join(REFS, f"{c}.jpg"))))
        if (i + 1) % 500 == 0:
            print(f"  {i+1}/{len(pool)}", flush=True)
    print(f"  {sum(len(d) for d in ref_des)} descriptors in {time.time()-t0:.0f}s")

    print("\ndescribing queries…")
    q_des = [describe(load_gray(os.path.join(CROPS, m["perfect"]))) for m in meta]
    print(f"  {sum(len(d) for d in q_des)} descriptors")

    # Vocabulary from a sample of reference descriptors.
    print(f"\nbuilding vocabulary (k={K})…")
    t0 = time.time()
    alld = np.vstack([d for d in ref_des if len(d)])
    rng = np.random.default_rng(20260803)
    sample = alld[rng.choice(len(alld), min(200_000, len(alld)), replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01)
    _, _, centers = cv2.kmeans(sample, K, None, crit, 3, cv2.KMEANS_PP_CENTERS)
    print(f"  {centers.shape} in {time.time()-t0:.0f}s")

    print("\nVLAD-encoding…")
    t0 = time.time()
    R = np.stack([vlad(d, centers) for d in ref_des])
    Q = np.stack([vlad(d, centers) for d in q_des])
    print(f"  refs {R.shape}, queries {Q.shape} in {time.time()-t0:.0f}s")

    def report(label, Rm, Qm):
        sims = Qm @ Rm.T
        ranks = []
        for i, m in enumerate(meta):
            t = pidx[m["id"]]
            order = np.argsort(-sims[i], kind="stable")
            ranks.append(int(np.where(order == t)[0][0]) + 1)
        ranks = np.array(ranks)
        print(f"  {label:34s} top1 {(ranks==1).mean()*100:5.1f}%   "
              f"top5 {(ranks<=5).mean()*100:5.1f}%   median rank {int(np.median(ranks))}")
        return ranks

    print(f"\n=== vs hash baseline on identical inputs: top1 74.0%, top5 82.0% ===")
    report(f"VLAD-SIFT ({R.shape[1]}-dim, raw)", R, Q)

    # PCA + whitening, the standard finish: decorrelates the VLAD dimensions and
    # is what makes the vector small enough to ship.
    mu = R.mean(axis=0, keepdims=True)
    Rc = R - mu
    U, S, Vt = np.linalg.svd(Rc, full_matrices=False)
    dim = min(PCA_DIM, Vt.shape[0])
    P = Vt[:dim].T / np.maximum(S[:dim] / np.sqrt(len(R)), 1e-8)
    def project(X):
        Y = (X - mu) @ P
        n = np.linalg.norm(Y, axis=1, keepdims=True)
        return Y / np.maximum(n, 1e-9)
    report(f"VLAD-SIFT (PCA-whitened {dim}-dim)", project(R), project(Q))

    mb = len(pool) and (110592 * dim) / 1e6
    print(f"\n  index cost at 110,592 printings: {mb:.0f} MB as int8 "
          f"({dim} dims), vs 7.1 MB for hashes.bin")

if __name__ == "__main__":
    main()
