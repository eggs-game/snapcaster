import assert from "node:assert/strict";
import { normalizeRecognitionHint, rememberRecognitionHint, rememberedRecognitionHint, nearbyRecognitionHints, removeRecognitionHintsForOwner, RECOGNITION_HINT_LIMIT } from "../src/recognitionHints.js";
import { RecognitionHintImages, rememberedHintCard } from "../src/recognitionHintImages.js";
const now=1800000000000;
const id=n=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,"0")}`;
const hint=(n=1,extra={})=>normalizeRecognitionHint({ownerId:"board-one",nx:.4,ny:.6,at:now,card:{name:`Card ${n}`,scryfall_id:id(n),face:0},...extra},now);
const a=hint(),b=hint(2,{nx:.425}),replacement=hint(2,{at:now+1});
assert.equal(rememberedRecognitionHint([a],"board-one",.4,.6,now)?.card.name,a.card.name);
assert.equal(rememberedRecognitionHint([a],"another-board",.4,.6,now),null);
assert.equal(rememberedRecognitionHint([a],"board-one",.5,.6,now),null);
assert.equal(nearbyRecognitionHints([a],"board-one",.5,.6,now).length,1,"wider verifier candidates cannot create an instant preview");
assert.equal(rememberedRecognitionHint([a,b],"board-one",.413,.6,now),null,"adjacent identities require actual verification");
assert.equal(rememberedRecognitionHint([replacement,a],"board-one",.4,.6,now+1)?.card.name,replacement.card.name,"older delayed messages cannot override a newly verified replacement");
assert.equal(rememberedRecognitionHint([a],"board-one",.4,.6,now+4*60*60*1000),null);
assert.equal(removeRecognitionHintsForOwner([a,hint(3,{ownerId:"board-two"})],"board-one").length,1);
let metadata=[];
for(let i=1;i<=RECOGNITION_HINT_LIMIT+10;i++)metadata=rememberRecognitionHint(metadata,hint(i),now);
assert.equal(metadata.length,256);assert.equal(metadata[0].card.scryfall_id,id(11));
const images=[];
class Image {
  constructor(){images.push(this);}
  async decode(){}
}
const cache=new RecognitionHintImages({Image,limit:2});
const card=rememberedHintCard(a);assert.equal(card.confidence,undefined);
assert.equal(card.identified_by,undefined,"remembering a reference cannot carry old recognition confidence");
assert.equal(rememberedHintCard({card:{name:"Unsafe",scryfall_id:"../../bad"}}),null);
cache.warm(card);assert.equal(cache.preview(card),"");
await images[0].onload();assert.ok(cache.preview(card).includes("/small/front/"));
cache.warm(card);assert.equal(images.length,1,"repeat warmups reuse decoded references");
cache.warm(rememberedHintCard(hint(2)));cache.warm(rememberedHintCard(hint(3)));
assert.equal(cache.entries.size,2);assert.equal(cache.preview(card),"");
await images[0].onload();assert.equal(cache.entries.size,2,"late evicted load cannot restore its entry");
cache.warm({...card,image:"https://attacker.example/card.jpg"});assert.equal(images.length,3,"arbitrary shared image URLs are not fetched");
const back=rememberedHintCard(hint(4,{card:{name:"Back",scryfall_id:id(4),face:1}}));
assert.ok(back.image.includes("/normal/back/"));cache.warm(back);images.at(-1).onerror();assert.equal(cache.entries.size,1);
cache.clear();await images[1].onload();assert.equal(cache.entries.size,0,"unmount/source reset prevents late cache adoption");
assert.equal(new RecognitionHintImages({Image,limit:1000}).limit,32,"decoded-image memory stays independently bounded");
console.log("Remembered room cards: tight unique positions, replacement/expiry/owner guards, bounded256 metadata, safe decoded32-image LRU and no confidence promotion pass");
