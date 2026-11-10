'use strict';
const fs=require('node:fs'),path=require('node:path');
const projectionRoot=fs.existsSync(path.join(__dirname,'projection'))?path.join(__dirname,'projection'):path.resolve(__dirname,'../..');
const E=require(path.join(projectionRoot,'paddock-historical-evidence.js'));
const PROJECTION_VERSION=2; // Native omission semantics; no public intake permission.
function car(raw,{raceClasses=[],databaseId}={}){
 const data={name:String(raw.name||[raw.brand,raw.manufacturer,raw.model].filter(Boolean).join(' ')||raw.id),maker:raw.brand||'',marque:raw.manufacturer||'',model:raw.model||'',reference:raw.reference||'',scale:String(raw.scale||''),technical:{}};
 const text=value=>value===undefined||value===null?'':String(value).trim();
 for(const k of ['number','livery'])if(raw[k]!==undefined)data[k]=text(raw[k]);
 data.technical.motor=text(raw.motor);data.technical.rearTyres=text(raw.tyres);
 const teeth=text(raw.gearing).match(/^(\d+)\s*[/:]\s*(\d+)$/);
 if(teeth&&teeth.slice(1).every(n=>Number.isSafeInteger(Number(n))&&Number(n)>0&&Number(n)<=1000)){
  data.technical.pinion=String(Number(teeth[1]));data.technical.gear=String(Number(teeth[2]));
 }
 const grams=text(raw.weight).match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams?)?$/i);
 if(grams&&Number(grams[1].replace(',','.'))<=100000)data.technical.weight=grams[1].replace(',','.');
 // Unsupported values remain intact in rawOriginal; never guess units or ratios.
 if(Array.isArray(raw.extraPictures)&&raw.extraPictures.length)data.photos=raw.extraPictures.map((image,i)=>({id:'timing-photo-'+require('node:crypto').createHash('sha256').update(raw.id+'|'+i).digest('hex'),name:'Timing photo '+(i+1),data:image}));
 if(typeof raw.picture==='string')data.picture=raw.picture;
 const cls=raceClasses.find(c=>c.id===raw.raceClass);if(cls)data.raceClass=cls.name;
 return {originalId:raw.id,data,rawOriginal:structuredClone(raw),...(raw.paddock?.databaseId===databaseId&&raw.paddock?.carId?{existingCarId:raw.paddock.carId}:{})};
}
function session(raw,laps,{databaseId,carIds={}}={}){
 const rawOriginal=structuredClone({session:raw,laps}),result={originalId:raw.id,sessionId:raw.id,rawOriginal};
 // Local adoption preserves every source field. Projection is additional,
 // never an excuse to discard token sessions, invalid or orphaned evidence.
 try{
  if(raw.sessionType==='tokens')throw Error('Time-token evidence retained; rich race projection is not yet supported.');
  if(laps.length>50000)throw Error('History exceeds the current 50,000-lap projection limit.');
  const bundle=E.nativeBundle(rawOriginal,databaseId,carIds);
  if(Buffer.byteLength(JSON.stringify(bundle))>8*1024*1024)throw Error('History exceeds the current 8 MiB projection limit.');
  return {...result,bundle,projectionStatus:'projected'};
 }catch(error){return {...result,bundle:null,projectionStatus:'raw-only',projectionReason:String(error.message).slice(0,1000)};}
}
module.exports={car,session,PROJECTION_VERSION};
