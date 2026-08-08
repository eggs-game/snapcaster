"""Train the card-quad detector that replaces the blind isolation sweep.

Predicts, from a 128px capture crop, where the clicked card is:

    cx, cy   card centre, crop-normalised
    h        card height, crop-normalised (width follows: aspect is fixed 63:88)
    cos2t    orientation, DOUBLED so that t and t+180 collapse to one target
    sin2t    — the recogniser already hashes four rotations, so the detector
             only has to find the rectangle, not which way up it is

Scored by IoU rather than by loss, because a previous sweep on this pipeline
established what IoU actually buys: above 0.8, 23 of 24 perturbed quads still
identified correctly; below 0.6, none of 8 did. So "% above IoU 0.8" is the
number that matters and MSE is only a means to it.

Two playmats are held out entirely. The previous attempt scored IoU 0.851 on
trained mats and 0.777 on unseen ones, and that gap — not the headline — is the
risk, because production meets mats no one trained on.

    python3 scripts/train_detector.py [epochs]
"""
import glob, json, math, os, struct, sys, time
import numpy as np
import cv2
import torch
import torch.nn as nn

DATA = os.environ.get("DETECTOR_DATA", "/tmp/detector")
OUT = os.environ.get("DETECTOR_OUT", "/tmp/detector/detector.pt")
SIZE = 128
ASPECT = 63 / 88.0
# Parsed inside main(), not at import: export_detector_js.py imports Detector
# from here and would otherwise try to int() its own arguments.
def _epochs():
    return int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 40
BATCH = 128
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def _read_batches(paths):
    """Unpack the length-prefixed JPEG batches the harvester wrote."""
    imgs = []
    for path in paths:
        blob = open(path, "rb").read()
        n = struct.unpack_from("<I", blob, 0)[0]
        lens = struct.unpack_from(f"<{n}I", blob, 4)
        off = 4 + 4 * n
        for L in lens:
            a = cv2.imdecode(np.frombuffer(blob[off:off + L], np.uint8), cv2.IMREAD_COLOR)
            imgs.append(cv2.cvtColor(a, cv2.COLOR_BGR2RGB))
            off += L
    return imgs


def load_split(split):
    """Load every chunk of a split and concatenate them.

    The harvester writes one chunk per run, scoped by seed base
    (`labels_train_s300.json` alongside `train_s300_*.bin`), because a
    throttled pane cannot hold one long unattended run open. Chunks must be
    paired image-to-label INDIVIDUALLY: a run interrupted mid-batch leaves its
    own images and labels slightly out of step, and truncating only the
    concatenated totals would silently shift every later chunk's labels onto
    the wrong images — a corpus that trains fine and means nothing.
    """
    chunks = sorted(glob.glob(os.path.join(DATA, f"labels_{split}_s*.json")))
    if not chunks:                                    # pre-chunking layout
        chunks = [os.path.join(DATA, f"labels_{split}.json")]

    imgs, labels = [], []
    for lpath in chunks:
        tag = os.path.basename(lpath)[len("labels_"):-len(".json")]
        part = sorted(glob.glob(os.path.join(DATA, f"{tag}_*.bin")))
        if not part:                                  # pre-chunking layout
            part = sorted(glob.glob(os.path.join(DATA, f"{split}_*.bin")))
        li = json.load(open(lpath))
        xi = _read_batches(part)
        k = min(len(xi), len(li))
        if k < max(len(xi), len(li)):
            print(f"  {tag}: {len(xi)} images / {len(li)} labels -> keeping {k}")
        imgs += xi[:k]
        labels += li[:k]

    print(f"  {split}: {len(imgs)} samples from {len(chunks)} chunk(s)")
    X = np.stack(imgs).astype(np.uint8)                       # N,H,W,3
    Y = np.array([[l["cx"], l["cy"], l["h"], l["c2"], l["s2"]] for l in labels], np.float32)
    meta = [{"mat": l["mat"], "rot": l["rot"], "occ": l["occ"]} for l in labels]
    return X, Y, meta


class Detector(nn.Module):
    """Deliberately small. It has to run in a *classic* Web Worker that cannot
    import an ML runtime, so inference is hand-written JS — four strided convs
    and two dense layers is about sixty lines there."""

    def __init__(self, width=32):
        super().__init__()
        w = width
        def block(i, o):
            return nn.Sequential(nn.Conv2d(i, o, 3, stride=2, padding=1),
                                 nn.BatchNorm2d(o), nn.ReLU(inplace=True))
        self.features = nn.Sequential(
            block(3, w),          # 64
            block(w, w * 2),      # 32
            block(w * 2, w * 4),  # 16
            block(w * 4, w * 4),  # 8
            nn.AdaptiveAvgPool2d(4),
        )
        self.head = nn.Sequential(
            nn.Flatten(start_dim=1), nn.Linear(w * 4 * 16, 128), nn.ReLU(inplace=True),
            nn.Linear(128, 5),
        )

    def forward(self, x):
        return self.head(self.features(x))


def augment(xb, yb):
    """Photometric jitter plus horizontal flip, on-device.

    The first run scored 75.2% above IoU 0.8 on unseen scenes but only 34.4% on
    unseen playmats — a 41-point gap, worse than the 25-point gap the previous
    attempt recorded. With only eight distinct backgrounds seen 12,000 times,
    the model was memorising mats rather than finding cards. These
    transformations change the background's appearance while leaving the card's
    geometry either untouched or exactly known, which is the cheapest available
    attack on that specific failure.
    """
    n = xb.shape[0]
    dev = xb.device
    r = lambda lo, hi: torch.empty(n, 1, 1, 1, device=dev).uniform_(lo, hi)

    xb = xb * r(0.65, 1.35)                                   # brightness
    mean = xb.mean(dim=(1, 2, 3), keepdim=True)
    xb = (xb - mean) * r(0.65, 1.4) + mean                    # contrast
    xb = xb * torch.empty(n, 3, 1, 1, device=dev).uniform_(0.85, 1.15)   # colour cast
    xb = xb + torch.randn_like(xb) * r(0.0, 0.05)             # sensor noise
    xb = xb.clamp_(0, 1)

    # Mirror half the batch. x -> 1-x, so cx -> 1-cx and the angle negates;
    # under the doubled representation cos2t is unchanged and sin2t flips sign.
    flip = torch.rand(n, device=dev) < 0.5
    if flip.any():
        xb[flip] = torch.flip(xb[flip], dims=[3])
        yb = yb.clone()
        yb[flip, 0] = 1.0 - yb[flip, 0]
        yb[flip, 4] = -yb[flip, 4]
    return xb, yb


def quad(p):
    """(cx,cy,h,c2,s2) -> 4 corners, for IoU. Works on numpy rows."""
    cx, cy, h, c2, s2 = p
    t = math.atan2(s2, c2) / 2.0
    w = h * ASPECT
    c, s = math.cos(t), math.sin(t)
    return np.array([[cx + dx * c - dy * s, cy + dx * s + dy * c]
                     for dx, dy in [(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)]],
                    np.float32)


def iou(a, b):
    """Polygon IoU via rasterisation — exact enough at this scale and far less
    code than a clipping routine, which is worth it for a metric."""
    S = 128
    ca = np.zeros((S, S), np.uint8); cb = np.zeros((S, S), np.uint8)
    cv2.fillPoly(ca, [np.int32(quad(a) * S)], 1)
    cv2.fillPoly(cb, [np.int32(quad(b) * S)], 1)
    inter = np.logical_and(ca, cb).sum()
    union = np.logical_or(ca, cb).sum()
    return float(inter / union) if union else 0.0


def evaluate(model, X, Y, meta, label):
    model.eval()
    preds = []
    with torch.no_grad():
        for i in range(0, len(X), 256):
            xb = torch.from_numpy(X[i:i + 256]).permute(0, 3, 1, 2).contiguous().float().div_(255).to(DEVICE)
            preds.append(model(xb).cpu().numpy())
    P = np.concatenate(preds)
    ious = np.array([iou(P[i], Y[i]) for i in range(len(Y))])
    print(f"  {label:22s} IoU mean {ious.mean():.3f} | "
          f">0.8 {(ious > 0.8).mean()*100:5.1f}% | >0.6 {(ious > 0.6).mean()*100:5.1f}%")
    by = {}
    for m, v in zip(meta, ious):
        by.setdefault(m["rot"], []).append(v)
    print("      by rotation: " + "  ".join(
        f"{k} {np.mean(v):.3f}({(np.array(v)>0.8).mean()*100:.0f}%)" for k, v in sorted(by.items())))
    return ious


def main():
    print(f"device {DEVICE}")
    X, Y, meta = load_split("train")
    print(f"train pool {X.shape}")
    # Hold out scenes as well as mats: unseen-scene error and unseen-mat error
    # are different failures and collapsing them hides the one that matters.
    rng = np.random.default_rng(20260803)
    idx = rng.permutation(len(X))
    cut = int(len(X) * 0.9)
    tr, va = idx[:cut], idx[cut:]
    Xtr, Ytr = X[tr], Y[tr]
    Xva, Yva, Mva = X[va], Y[va], [meta[i] for i in va]

    try:
        Xho, Yho, Mho = load_split("heldout")
        print(f"held-out mats {Xho.shape}")
    except Exception as e:
        Xho = None
        print(f"no held-out mat split ({e})")

    model = Detector().to(DEVICE)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"model {n_params/1e6:.2f}M params")
    EPOCHS = _epochs()
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(
        opt, max_lr=3e-3, total_steps=EPOCHS * max(1, len(Xtr) // BATCH))
    lossf = nn.SmoothL1Loss(beta=0.05)

    Xtr_t = torch.from_numpy(Xtr)
    Ytr_t = torch.from_numpy(Ytr)
    for ep in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(Xtr_t))
        tot = 0.0
        t0 = time.time()
        for i in range(0, len(perm) - BATCH + 1, BATCH):
            b = perm[i:i + BATCH]
            xb = Xtr_t[b].permute(0, 3, 1, 2).contiguous().float().div_(255).to(DEVICE)
            yb = Ytr_t[b].to(DEVICE)
            xb, yb = augment(xb, yb)
            opt.zero_grad(set_to_none=True)
            loss = lossf(model(xb), yb)
            loss.backward()
            opt.step()
            sched.step()
            tot += loss.item()
        if ep % 5 == 4 or ep == EPOCHS - 1:
            print(f"epoch {ep+1:3d}  loss {tot/max(1,len(perm)//BATCH):.5f}  ({time.time()-t0:.0f}s)")
            evaluate(model, Xva, Yva, Mva, "val (unseen scenes)")
            if Xho is not None:
                evaluate(model, Xho, Yho, Mho, "held-out MATS")

    torch.save({"state": model.state_dict(), "size": SIZE, "aspect": ASPECT}, OUT)
    print(f"\nsaved {OUT}")


if __name__ == "__main__":
    main()
