"""Second pass: is the embedding arm's poor showing an artefact of my setup?

Two things could have handicapped it unfairly in probe.py:
  1. cards were squashed from 63:88 into a square, destroying aspect
  2. only DINOv2's CLS token was used, which is a semantic summary; patch-token
     means keep more spatial/structural detail, which is what tells two card
     printings apart

Tests aspect-preserving letterbox, mean-pooled patch tokens, and a second model
family (CLIP), against the same hash baseline on the same 200 perfect crops.
"""
import json, os, time
import numpy as np, torch, timm
from PIL import Image

CROPS, REFS = "/tmp/probe-crops", "/tmp/probe-refs"
REPO = "/Users/zach/Cowork/snapcaster-web/.claude/worktrees/real-life2"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

meta = json.load(open(f"{CROPS}/meta.json"))
pool = json.load(open(f"{REFS}/pool.json"))["pool"]
rows = json.load(open(f"{REPO}/public/carddata/cards.json"))
row_of = {r[3]: i for i, r in enumerate(rows) if r[4] == 0}
pool = [c for c in pool if c in row_of and os.path.exists(f"{REFS}/{c}.jpg")]
pidx = {c: i for i, c in enumerate(pool)}
meta = [m for m in meta if m["id"] in pidx]
print(f"{len(meta)} queries, {len(pool)} pool\n")

def letterbox(im, size):
    """Preserve aspect: fit inside a square canvas, pad with mid-grey."""
    w, h = im.size
    s = size / max(w, h)
    im = im.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BICUBIC)
    canvas = Image.new("RGB", (size, size), (128, 128, 128))
    canvas.paste(im, ((size - im.size[0]) // 2, (size - im.size[1]) // 2))
    return canvas

def run(model_name, pooling, keep_aspect):
    model = timm.create_model(model_name, pretrained=True, num_classes=0).eval().to(DEVICE)
    cfg = timm.data.resolve_data_config({}, model=model)
    size = cfg["input_size"][1]
    MEAN = torch.tensor(cfg["mean"]).view(3,1,1); STD = torch.tensor(cfg["std"]).view(3,1,1)

    def prep(paths):
        out = []
        for p in paths:
            im = Image.open(p).convert("RGB")
            im = letterbox(im, size) if keep_aspect else im.resize((size,size), Image.BICUBIC)
            t = torch.from_numpy(np.asarray(im)).permute(2,0,1).float()/255.0
            out.append((t-MEAN)/STD)
        return torch.stack(out)

    @torch.no_grad()
    def emb(paths, bs=16):
        vs = []
        for i in range(0, len(paths), bs):
            x = prep(paths[i:i+bs]).to(DEVICE)
            if pooling == "patch":
                f = model.forward_features(x)          # B, tokens, dim
                f = f[:, model.num_prefix_tokens:].mean(dim=1)
            else:
                f = model(x)
            vs.append(torch.nn.functional.normalize(f, dim=1).cpu())
        return torch.cat(vs)

    rv = emb([f"{REFS}/{c}.jpg" for c in pool])
    qv = emb([f"{CROPS}/{m['perfect']}" for m in meta])
    sims = qv @ rv.T
    ranks = []
    for i, m in enumerate(meta):
        t = pidx[m["id"]]
        ranks.append(int((torch.argsort(sims[i], descending=True) == t).nonzero()[0][0]) + 1)
    ranks = np.array(ranks)
    print(f"{model_name:42s} pool={pooling:5s} aspect={'keep' if keep_aspect else 'squash'}"
          f"  ->  top1 {(ranks==1).mean()*100:5.1f}%   top5 {(ranks<=5).mean()*100:5.1f}%"
          f"   median rank {int(np.median(ranks))}")
    del model
    return ranks

print("hash baseline on the same inputs: top1 74.0%, top5 82.0%  (from probe.py)\n")
for name, pooling, aspect in [
    ("vit_small_patch14_dinov2.lvd142m", "cls",   True),
    ("vit_small_patch14_dinov2.lvd142m", "patch", True),
    ("vit_base_patch32_clip_224.laion2b", "cls",  True),
]:
    try:
        run(name, pooling, aspect)
    except Exception as e:
        print(f"{name} {pooling}: FAILED {e}")
