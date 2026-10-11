#!/usr/bin/env python3
"""Add stronger production descriptor controls to a completed paired probe.

Uses the production art/color preprocessing exported from frozen PNGs. This
applies the v3 scoring formula generously to the whole shared gallery without
the runtime's gray-distance cutoff; it is still NOT an end-to-end pipeline.
"""
import argparse,json,os
from pathlib import Path
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
os.environ.setdefault('VECLIB_MAXIMUM_THREADS','1')
import numpy as np
from probe_ai_lookup import ranks
ROOT=Path(__file__).resolve().parent.parent

def main():
 p=argparse.ArgumentParser();p.add_argument('--data',default='.cache/ai-lookup/crops');p.add_argument('--output',default='.cache/ai-lookup/realLife-results.json');a=p.parse_args()
 manifest=json.loads((ROOT/a.data/'manifest.json').read_text());target=ROOT/a.output;result=json.loads(target.read_text())
 rows=json.loads((ROOT/'public/carddata/cards.json').read_text());by_key={r[3]+('_back' if r[4] else ''):i for i,r in enumerate(rows)}
 ids=np.array(json.loads((ROOT/'.cache/ai-lookup/gallery-ids.json').read_text()));indices=[by_key[k] for k in ids];names=np.array([rows[i][0] for i in indices])
 hashes=np.ascontiguousarray(np.fromfile(ROOT/'public/carddata/hashes.bin',np.uint8).reshape(-1,64)[indices]).view(np.uint64)
 art=np.ascontiguousarray(np.fromfile(ROOT/'public/carddata/arthashes.bin',np.uint8).reshape(-1,32)[indices]).view(np.uint64)
 color=np.fromfile(ROOT/'public/carddata/colors.bin',np.uint8).reshape(-1,13)[indices].astype(np.float64)/255
 assert len(ids)==result['galleryRows'] and manifest['n']==result['n']
 def distances(reference,variants):
  best=np.full(len(ids),65535,np.uint16)
  for v in np.array(variants,np.uint8).view(np.uint64):
   np.minimum(best,np.bitwise_count(reference^v).sum(axis=1,dtype=np.uint16),out=best)
  return best.astype(np.float64)
 def ranked(scores,name):
  r=ranks(scores,names,name);r['printing']=str(ids[r.pop('row')]);return r
 for frozen,row in zip(manifest['records'],result['records']):
  assert frozen['i']==row['i'] and frozen['name']==row['name']
  combined=[];art_only=[]
  for crop in frozen['crops']:
   gray_dist=distances(hashes,crop['variants']);art_dist=distances(art,crop['artVariants'])
   similarity=np.minimum(color,np.array(crop['color'],np.float64)).sum(axis=1)
   score=-(gray_dist+1.8*art_dist+(1-np.minimum(1,similarity))*150)
   row['crops'][crop['kind']]['artHash']=ranked(-art_dist,row['name'])
   row['crops'][crop['kind']]['combinedHash']=ranked(score,row['name'])
   if crop['kind'].startswith('ai-'):combined.append(score);art_only.append(-art_dist)
  if combined:
   row['learnedCombined']['combinedHash']=ranked(np.max(combined,axis=0),row['name'])
   row['learnedCombined']['artHash']=ranked(np.max(art_only,axis=0),row['name'])
 for kind,summary in result['summary'].items():
  subset=[r['learnedCombined'] if kind=='learnedCombined' else r['crops'][kind] for r in result['records'] if (kind=='learnedCombined' and 'learnedCombined' in r) or kind in r['crops']]
  for arm in ['artHash','combinedHash']:
   rr=[r[arm]['rank'] for r in subset];summary[arm]={'n':len(rr),**{f'top{k}':sum(x is not None and x<=k for x in rr) for k in [1,5,12,36]}}
 result['hashPreprocessing']=manifest['hashPreprocessing'];result['additionalControls']='Production artPHash (four rotations, no shifts for AI crops) and gray+1.8*art+(1-color intersection)*150; full shared gallery without runtime cutoff; no ORB/OCR or acceptance gates'
 result['detectorCoverage']={'captures':manifest['n'],'withProposal':sum('learnedCombined' in r for r in result['records'])}
 target.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result['summary'],indent=2))

if __name__=='__main__':main()
