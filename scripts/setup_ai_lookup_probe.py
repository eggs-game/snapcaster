#!/usr/bin/env python3
"""Download pinned research assets into ignored cache; never runtime/public assets."""
import argparse,hashlib,json
from pathlib import Path
import requests

REVISION='9bcc5e809e936b8c5630d1e7101aae1de1e76621'
FILES={
 'model.onnx':('model.onnx','bd13d8d60383c69da04dce261f32e93fdaeaa8fd618fbc991e7385f71b3d45df'),
 'catalogs/milo1-scryfall-mtg-2026-07-09.npz':('milo1-scryfall-mtg-2026-07-09.npz','c5cb0dc150eb9f5b183396dd25aecaa9efc5ce3d001dd8bef282fcc73ee778be'),
}
parser=argparse.ArgumentParser();parser.add_argument('--output',default='.cache/ai-lookup');args=parser.parse_args()
out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
for remote,(local,expected) in FILES.items():
 target=out/local
 if not target.exists():
  response=requests.get(f'https://huggingface.co/HanClinto/milo/resolve/{REVISION}/{remote}',timeout=120);response.raise_for_status()
  assert hashlib.sha256(response.content).hexdigest()==expected,'Downloaded asset checksum differs'
  target.write_bytes(response.content)
 assert hashlib.sha256(target.read_bytes()).hexdigest()==expected,'Cached asset checksum differs'
 print(local,'checksum verified',target.stat().st_size)
(out/'model.json').write_text(json.dumps({'sha':REVISION,'source':f'https://huggingface.co/HanClinto/milo/tree/{REVISION}','license':'AGPL-3.0'}))
