import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as hints from "../src/recognitionHints.js";
import { RecognitionHintImages, rememberedHintCard } from "../src/recognitionHintImages.js";
const source=readFileSync(new URL("../src/Game.jsx",import.meta.url),"utf8");
const handler=source.slice(source.indexOf("  const identify = useCallback("),source.indexOf("  // Clicking an opponent's commander name"));
const clear=source.slice(source.indexOf("      onRecognitionHintsCleared: (ownerId) => {")+"      onRecognitionHintsCleared: (ownerId) => {".length,source.indexOf("      onChat: (message) => {")).replace(/\},\s*$/,"");
const a={name:"Remembered",scryfall_id:"00000000-0000-4000-8000-000000000001",face:0,distance:100,identified_by:"art-match"};
const b={...a,name:"Replacement",scryfall_id:"00000000-0000-4000-8000-000000000002"};
let current=null,lookups=[],camera,verify,miss=false;
const announcements=[],calls=[];
const context=vm.createContext({Blob,URL,Date,performance,...hints,rememberedHintCard,
  useCallback:fn=>fn,setTimeout(){},setFlash(){},openCardPanel(){},
  setCurrent:value=>{current=typeof value==="function"?value(current):value;},setLookups:fn=>{lookups=fn(lookups);},
  clickToNormalized:(_v,nx,ny)=>({nx,ny}),canPrepareRecognitionCapture:()=>false,
  captureLocalFrame:()=>new Promise(resolve=>{camera=()=>resolve({blob:new Blob(["frame"]),url:"https://fixture.invalid/frame",px:.5,py:.5});}),
  identifyCard:(_blob,_point,options)=>{calls.push(options);if(miss)options.onHintMiss();return new Promise(resolve=>{verify=card=>resolve({matches:[card],stage_ms:{}});});},
  persistRecognitionTiming(){},
  connRef:{current:{localStream:{getVideoTracks:()=>[]},announceRecognitionHint:hint=>announcements.push(hint)}},
  myId:"self",session:{name:"Scanner"},rosterRef:{current:[]},
  activeRecognitionRef:{current:null},latestRecognitionRequestRef:{current:0},recognitionPreparationRef:{current:null},
  recognitionHintsRef:{current:[hints.normalizeRecognitionHint({ownerId:"self",nx:.4,ny:.6,at:Date.now()-500,card:a})]},
  recognitionSourceGenerationsRef:{current:new Map()},recognitionGameEpochRef:{current:0},
  recognitionHintImagesRef:{current:new RecognitionHintImages()},captureObjectUrlsRef:{current:[]},
});
vm.runInContext(handler.replace("const identify =","globalThis.identify =")+`\n globalThis.clearOwner=ownerId=>{${clear}};`,context);
const video={getBoundingClientRect:()=>({left:0,top:0})};
let job=context.identify("self",video,.4,.6);
assert.equal(current.rememberedCard.card.name,a.name,"known card is exposed synchronously before a camera reply");
assert.equal(current.matches,undefined);assert.equal(announcements.length,0);assert.equal(lookups.length,0,"provisional cards cannot enter history/chat/hints");
miss=true;camera();await new Promise(setImmediate);
assert.equal(current.rememberedCard,null,"actual Game hint-miss callback removes old artwork before held fallback finishes");
assert.equal(current.loading,true);verify(b);await job;
assert.equal(current.matches[0].name,b.name);assert.equal(current.rememberedCard,undefined);assert.equal(announcements.at(-1).card.name,b.name);
assert.equal(lookups.length,1);
miss=false;job=context.identify("self",video,.4,.6);assert.equal(current.rememberedCard.card.name,b.name);
camera();await new Promise(setImmediate);const announceCount=announcements.length;
context.clearOwner("self");assert.equal(current,null);assert.equal(context.recognitionHintsRef.current.length,0);
verify(a);await job;assert.equal(announcements.length,announceCount,"old captured pixels cannot repopulate a changed camera's remembered positions");assert.equal(current,null);
context.recognitionHintsRef.current=[hints.normalizeRecognitionHint({ownerId:"self",nx:.4,ny:.6,at:Date.now(),card:b})];
job=context.identify("self",video,.4,.6);camera();await new Promise(setImmediate);
context.recognitionGameEpochRef.current++;context.latestRecognitionRequestRef.current++;verify(a);await job;
assert.equal(announcements.length,announceCount,"old room results cannot become hints in a new game epoch");
console.log("Actual Game: synchronous remembered display, provisional isolation, hint-miss replacement, camera generation and room-epoch stale-result guards pass");
