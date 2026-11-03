'use strict';
const fs=require('node:fs'),path=require('node:path');
const METADATA_LIMIT=200*1024*1024,RESERVE=16*1024*1024;
function freeBytes(folder){const s=fs.statfsSync(folder);return s.bavail*s.bsize;}
function requireSpace(folder,bytes){
 if(!Number.isFinite(bytes)||bytes<0||freeBytes(folder)<bytes+RESERVE)throw Error('Not enough free disk space to save safely. Free space on the database drive and retry; this change has not been saved.');
}
// This is a conservative preflight, not a promise that another process cannot
// consume space afterwards. SQLite's transaction still handles write failures.
// Budget submitted metadata (including broad compatibility drafts) and only
// assets that actually need writing. Existing originals are not charged again.
function prepareWrite(file,db,packed){
 let bytes=Buffer.byteLength(packed.manifest)*4+packed.records.reduce((n,r)=>n+Buffer.byteLength(r.json)*8,0);
 const exists=db.prepare('SELECT 1 FROM assets WHERE hash=?');
 for(const [hash,value]of packed.assets)if(packed.refreshAssets||!exists.get(hash))bytes+=Buffer.byteLength(value)*2;
 const sources=new Map();try{
  for(const [hash,source]of packed.externalAssets||[])if(packed.refreshAssets||!exists.get(hash)){
   let input=sources.get(source);if(!input){input=new (require('node:sqlite').DatabaseSync)(source,{readOnly:true,timeout:5000});sources.set(source,input);input.exec('PRAGMA trusted_schema=OFF;');}
   const row=input.prepare('SELECT length(value) size FROM assets WHERE hash=?').get(hash);if(!row)throw Error('Attachment unavailable.');bytes+=row.size*2;
  }
 }finally{for(const db of sources.values())db.close();}
 requireSpace(path.dirname(file),bytes);
}
function usage(file,db,logicalBytes,metadataBytes){
 const fileBytes=fs.statSync(file).size;
 const media=db.prepare('SELECT count(*) count,coalesce(sum(length(value)),0) bytes FROM assets WHERE hash IN (SELECT hash FROM asset_refs)').get();
 const retained=db.prepare('SELECT coalesce(sum(length(value)),0) bytes FROM assets WHERE hash NOT IN (SELECT hash FROM asset_refs)').get().bytes;
 let available=null;try{available=freeBytes(path.dirname(file));}catch{/* A usage display must not prevent opening Settings. */}
 return {fileBytes,mediaBytes:media.bytes,mediaCount:media.count,retainedMediaBytes:retained,freeBytes:available,logicalBytes,logicalLimit:null,metadataBytes,metadataLimit:METADATA_LIMIT};
}
function checkCollectionSize(size){if(!Number.isSafeInteger(size)||size<0||size>METADATA_LIMIT)throw Object.assign(Error('Database metadata exceeds the 200 MiB working limit. Photos and documents are stored separately and do not count toward this limit.'),{code:'COLLECTION_LIMIT'});}
module.exports={checkCollectionSize,METADATA_LIMIT,RESERVE,requireSpace,prepareWrite,usage};
