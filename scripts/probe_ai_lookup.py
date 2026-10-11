#!/usr/bin/env python3
"""Research-only, paired full-gallery descriptor probe; no runtime changes.

Both arms rank the identical gallery intersection on exact exported PNG pixels.
Hash queries are emitted by production hash.js, not a Python approximation.
Milo uses the pinned compatible official gallery and reference preprocessing.
Top-k recall is retrieval evidence, NOT verified end-to-end accuracy.
"""
import argparse, hashlib, json, os, time
from pathlib import Path
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ.setdefault('VECLIB_MAXIMUM_THREADS', '1')
import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
MEAN=np.array([.485,.456,.406],np.float32)
STD=np.array([.229,.224,.225],np.float32)

def preprocess(image):
    if image.width>image.height:
        image=image.transpose(Image.Transpose.ROTATE_90)
    image=image.convert('RGB').resize((448,448),Image.Resampling.BILINEAR)
    x=(np.array(image,dtype=np.float32)/255-MEAN)/STD
    return np.ascontiguousarray(x.transpose(2,0,1)[None])

def ranks(scores,names,expected):
    order=np.argsort(-scores,kind='stable')
    truth=np.flatnonzero(names[order]==expected)
    rank=int(truth[0]+1) if len(truth) else None
    best=int(order[0]);rival=next((int(i) for i in order if names[i]!=names[best]),None)
    return {'rank':rank,'got':str(names[best]),'score':float(scores[best]),
            'margin':float(scores[best]-scores[rival]) if rival is not None else None,
            'top5':[str(names[i]) for i in order[:5]],'row':best}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--data',default='.cache/ai-lookup/crops')
    parser.add_argument('--assets',default='.cache/ai-lookup')
    parser.add_argument('--output',default='.cache/ai-lookup/realLife-results.json')
    args=parser.parse_args();data=ROOT/args.data;assets=ROOT/args.assets
    manifest=json.loads((data/'manifest.json').read_text())
    rows=json.loads((ROOT/'public/carddata/cards.json').read_text())
    by_key={r[3]+('_back' if r[4] else ''):i for i,r in enumerate(rows)}
    with np.load(assets/'milo1-scryfall-mtg-2026-07-09.npz',allow_pickle=False) as archive:
        ids=archive['card_ids'];vectors=archive['embeddings']
    selected=np.array([i for i,k in enumerate(ids) if k in by_key])
    vectors=np.ascontiguousarray(vectors[selected]);ids=ids[selected]
    assert len(set(ids))==len(ids),'Duplicate gallery keys'
    id_set=set(ids)
    assert np.isfinite(vectors).all()
    norms=np.linalg.norm(vectors,axis=1);assert np.max(np.abs(norms-1))<.002
    names=np.array([rows[by_key[k]][0] for k in ids])
    hashes=np.fromfile(ROOT/'public/carddata/hashes.bin',np.uint8).reshape(-1,64)
    hashes=np.ascontiguousarray(hashes[[by_key[k] for k in ids]]).view(np.uint64)
    # A deployable 128-byte descriptor can be tested without adopting it. Row
    # renormalization keeps this cosine comparison fair after int8 rounding.
    quant=np.rint(vectors*127).clip(-127,127).astype(np.int8)
    quant_vectors=quant.astype(np.float32)
    quant_norms=np.linalg.norm(quant_vectors,axis=1,keepdims=True)
    quant_vectors/=quant_norms
    (assets/'gallery-int8.bin').write_bytes(quant.tobytes())
    (assets/'gallery-norms.bin').write_bytes(quant_norms.astype(np.float32).tobytes())
    (assets/'gallery-ids.json').write_text(json.dumps(ids.tolist()))
    options=ort.SessionOptions();options.intra_op_num_threads=1;options.inter_op_num_threads=1
    session=ort.InferenceSession(str(assets/'model.onnx'),options,providers=['CPUExecutionProvider'])
    input_name=session.get_inputs()[0].name
    session.run(None,{input_name:np.zeros((1,3,448,448),np.float32)})
    output={'suite':manifest['suite'],'n':manifest['n'],'comparison':'same PNG pixels, same full gallery intersection; production JS query hashes; name-level recall',
            'galleryRows':len(ids),'localRows':len(rows),'missingLocalRows':len(rows)-len(ids),
            'missingNames':sorted(set(r[0] for r in rows)-set(names)),
            'modelRevision':json.loads((assets/'model.json').read_text())['sha'],
            'modelSha256':hashlib.sha256((assets/'model.onnx').read_bytes()).hexdigest(),
            'gallerySha256':hashlib.sha256((assets/'milo1-scryfall-mtg-2026-07-09.npz').read_bytes()).hexdigest(),
            'inference':'ONNX Runtime CPU, one inference thread; portrait + 180-degree rotation',
            'records':[]}
    timings={'embed':[],'search':[],'hash':[]};query_vectors=[];query_keys=[]
    for record in manifest['records']:
        row={k:record.get(k) for k in ['i','name','id','rotation','layout','coverage','occ']}
        row['printingCovered']=record['id'] in id_set
        row['identityCovered']=bool(np.any(names==record['name']))
        row['crops']={};ai_model=[];ai_hash=[];ai_quant=[]
        for crop in record['crops']:
            with Image.open(data/crop['file']) as image:
                embeddings=[];t=time.perf_counter()
                for angle in [0,180]:
                    oriented=image if not angle else image.transpose(Image.Transpose.ROTATE_180)
                    embedding=session.run(None,{input_name:preprocess(oriented)})[0][0]
                    assert np.isfinite(embedding).all() and abs(np.linalg.norm(embedding)-1)<.002
                    embeddings.append(embedding);query_vectors.append(embedding);query_keys.append([record['i'],crop['kind'],angle])
                embed_ms=(time.perf_counter()-t)*1000
            t=time.perf_counter();sim=np.max(vectors@np.stack(embeddings).T,axis=1)
            search_ms=(time.perf_counter()-t)*1000
            quant_sim=np.max(quant_vectors@np.stack(embeddings).T,axis=1)
            variants=np.array(crop['variants'],np.uint8).view(np.uint64)
            t=time.perf_counter();dist=np.full(len(ids),65535,np.uint16)
            for variant in variants:
                d=np.bitwise_count(np.bitwise_xor(hashes,variant)).sum(axis=1,dtype=np.uint16)
                np.minimum(dist,d,out=dist)
            hash_ms=(time.perf_counter()-t)*1000
            row['crops'][crop['kind']]={'milo':ranks(sim,names,record['name']),
                'miloInt8':ranks(quant_sim,names,record['name']),
                'hash':ranks(-dist.astype(np.float32),names,record['name']),
                'embedMs':round(embed_ms,2),'searchMs':round(search_ms,2),'hashMs':round(hash_ms,2)}
            for arm in ['milo','miloInt8','hash']:
                result=row['crops'][crop['kind']][arm];result['printing']=str(ids[result.pop('row')])
            timings['embed'].append(embed_ms);timings['search'].append(search_ms);timings['hash'].append(hash_ms)
            if crop['kind'].startswith('ai-'):
                ai_model.append(sim);ai_hash.append(-dist.astype(np.float32));ai_quant.append(quant_sim)
        if ai_model:
            row['learnedCombined']={arm:ranks(np.max(scores,axis=0),names,record['name']) for arm,scores in [('milo',ai_model),('hash',ai_hash),('miloInt8',ai_quant)]}
            for result in row['learnedCombined'].values():result['printing']=str(ids[result.pop('row')])
        output['records'].append(row)
        if len(output['records'])%10==0:print(f"{manifest['suite']}: scored {len(output['records'])}/{manifest['n']}",flush=True)
    summary={}
    for kind in ['capture','perfect','learnedCombined']:
        subset=[r['learnedCombined'] if kind=='learnedCombined' else r['crops'][kind] for r in output['records'] if (kind=='learnedCombined' and 'learnedCombined' in r) or kind in r['crops']]
        if not subset:continue
        summary[kind]={}
        for arm in ['hash','milo','miloInt8']:
            rr=[r[arm]['rank'] for r in subset]
            summary[kind][arm]={'n':len(rr),'top1':sum(x==1 for x in rr),'top5':sum(x is not None and x<=5 for x in rr),'top12':sum(x is not None and x<=12 for x in rr),'top36':sum(x is not None and x<=36 for x in rr)}
    output['summary']=summary
    output['detectorCoverage']={'captures':manifest['n'],'withProposal':sum('learnedCombined' in r for r in output['records'])}
    output['hashPreprocessing']=manifest.get('hashPreprocessing','UNSPECIFIED: do not interpret as production preprocessing')
    output['timing']={k:{'medianMs':round(float(np.median(v)),2),'p90Ms':round(float(np.percentile(v,90)),2)} for k,v in timings.items()}
    output['identityCovered']=sum(r['identityCovered'] for r in output['records'])
    output['printingCovered']=sum(r['printingCovered'] for r in output['records'])
    np.savez_compressed(assets/(manifest['suite']+'-query-vectors.npz'),embeddings=np.stack(query_vectors),keys=np.array(query_keys,dtype=str))
    target=ROOT/args.output;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(output,indent=2)+'\n')
    print(json.dumps({'summary':summary,'timing':output['timing'],'identityCovered':output['identityCovered'],'printingCovered':output['printingCovered']},indent=2))

if __name__=='__main__':main()
