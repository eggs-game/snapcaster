"""Download reference card images for the probe.

The 200 correct answers plus a pool of distractors, so retrieval is a real
ranking task rather than a yes/no on one pair. Scryfall asks for <=10 req/s;
build_index.py uses 9, so this does too.
"""
import concurrent.futures as cf
import json, os, random, sys, time, urllib.request

OUT = "/tmp/probe-refs"
CARDS = "/Users/zach/Cowork/snapcaster-web/.claude/worktrees/real-life2/public/carddata/cards.json"
META = "/tmp/probe-crops/meta.json"
N_DISTRACTORS = int(sys.argv[1]) if len(sys.argv) > 1 else 1800

os.makedirs(OUT, exist_ok=True)

def url_for(cid):
    return f"https://cards.scryfall.io/normal/front/{cid[0]}/{cid[1]}/{cid}.jpg"

class Limiter:
    def __init__(self, rps=9):
        self.gap = 1.0 / rps
        self.next = 0.0
    def wait(self):
        now = time.time()
        if now < self.next:
            time.sleep(self.next - now)
        self.next = max(now, self.next) + self.gap

lim = Limiter()

def grab(cid):
    path = os.path.join(OUT, f"{cid}.jpg")
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return True
    for attempt in range(3):
        try:
            lim.wait()
            req = urllib.request.Request(url_for(cid), headers={
                "User-Agent": "snapcast-probe/1.0", "Accept": "image/jpeg",
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if len(data) < 1000:
                continue
            with open(path, "wb") as f:
                f.write(data)
            return True
        except Exception:
            time.sleep(1 + attempt)
    return False

meta = json.load(open(META))
want = {m["id"] for m in meta}
print(f"{len(want)} correct-answer printings")

rows = json.load(open(CARDS))
fronts = [r[3] for r in rows if r[4] == 0]
rng = random.Random(20260803)
pool = set(want)
while len(pool) < len(want) + N_DISTRACTORS:
    pool.add(fronts[rng.randrange(len(fronts))])
pool = list(pool)
print(f"{len(pool)} total references to fetch (incl. {N_DISTRACTORS} distractors)")

ok = 0
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    for i, good in enumerate(ex.map(grab, pool)):
        ok += good
        if i % 200 == 0:
            print(f"  {i}/{len(pool)} … {ok} ok", flush=True)
print(f"done: {ok}/{len(pool)} downloaded")

missing = [c for c in want if not os.path.exists(os.path.join(OUT, f"{c}.jpg"))]
print(f"missing correct answers: {len(missing)}")
json.dump({"pool": pool, "missing": missing}, open("/tmp/probe-refs/pool.json", "w"))
