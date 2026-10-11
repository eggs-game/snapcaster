// Research harness: extract production helpers rather than rewrite their math.
import {readFile} from 'node:fs/promises';
export const workerSource=await readFile(new URL('../src/recognition/recognizer.js',import.meta.url),'utf8');
export function declaration(name){
 const start=workerSource.indexOf('function '+name+'(');if(start<0)throw new Error(name);
 const brace=workerSource.indexOf('{',start);let depth=0;
 for(let i=brace;i<workerSource.length;i++){
  if(workerSource[i]==='{')depth++;
  if(workerSource[i]==='}'&&--depth===0)return workerSource.slice(start,i+1);
 }
 throw new Error('Unclosed '+name);
}
const hashBlock=workerSource.slice(workerSource.indexOf('const POPCOUNT ='),workerSource.indexOf('const ART_Y_SHIFTS ='));
export const descriptorSource='const HASH_SIZE=16,VEC_BYTES=64;'+hashBlock+declaration('whiteBalance')+declaration('colorSignature')+`
return function(image){
 const balanced=whiteBalance(image),gray=toGray(balanced),artVariants=[];
 let oriented=gray;
 for(let r=0;r<4;r++){artVariants.push(Array.from(artPHash(oriented)));oriented=rotate90(oriented);}
 return {variants:queryVariants(gray).map(v=>Array.from(v)),artVariants,color:Array.from(colorSignature(balanced))};
};`;
