'use strict';
// Disposable, shared derivatives. Never modifies the collection or its revision.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),Q=require('./sqlite-query.cjs'),lazy=require('./lazy-assets.cjs');
const FORMAT='png-512-v1',MAX_BYTES=2*1024*1024,LEASE_MS=60000;
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function valid(data){
 if(typeof data!=='string'||data.length>MAX_BYTES*1.4||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data))return false;
 const b=Buffer.from(data.slice(22),'base64');return b.length<=MAX_BYTES&&b.length>=33&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&b.toString('ascii',12,16)==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(16)<=512&&b.readUInt32BE(20)>0&&b.readUInt32BE(20)<=512;
}
function cache(root,fn){
 const folder=path.join(root,'thumbnails',FORMAT);fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const db=new DatabaseSync(path.join(folder,'cache.sqlite'),{timeout:5000});
 try{db.exec('CREATE TABLE IF NOT EXISTS thumbnails (key TEXT PRIMARY KEY,data TEXT,digest TEXT,lease TEXT,expires INTEGER NOT NULL DEFAULT 0);');return fn(db);}finally{db.close();}
}
function read(store,root,input){
 if(!input||typeof input.carId!=='string'||!/^[\w-]{1,100}$/.test(input.carId))throw Error('Choose a car for its thumbnail.');
 if(input.expectedHash!==undefined&&!/^[a-f0-9]{64}$/.test(input.expectedHash))throw Error('Invalid expected photograph hash.');
 return Q.read(store,input.token,r=>{
  const car=r.one('cars',input.carId);if(!car)throw Object.assign(Error('Car no longer exists.'),{code:'CAR_NOT_FOUND'});
  const asset=lazy.property(car,'picture'),source=asset?null:car.picture;if(!asset&&!source)return {data:null};
  const key=asset?.meta.hash||digest(source);
  // Immutable media URLs must never receive a newer photograph's derivative.
  if(input.expectedHash&&input.expectedHash!==key)return {data:null};
  const result=cache(root,db=>{
   db.exec('BEGIN IMMEDIATE');try{
    const row=db.prepare('SELECT * FROM thumbnails WHERE key=?').get(key);
    if(row?.data&&digest(row.data)===row.digest&&valid(row.data)){db.exec('COMMIT');return {key,data:row.data};}
    if(row?.lease&&row.expires>Date.now()){db.exec('COMMIT');return {key,pending:true};}
    const lease=crypto.randomUUID();db.prepare('INSERT INTO thumbnails(key,lease,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET data=NULL,digest=NULL,lease=excluded.lease,expires=excluded.expires').run(key,lease,Date.now()+LEASE_MS);
    db.exec('COMMIT');return {key,lease};
   }catch(e){db.exec('ROLLBACK');throw e;}
  });
  if(!result.lease)return result;
  try{return {...result,source:asset?asset.read():source};}catch(e){storeResult(root,{...result,data:null});throw e;}
 }).value;
}
function storeResult(root,input){
 if(!input||!/^[a-f0-9]{64}$/.test(input.key)||typeof input.lease!=='string'||!/^[a-f0-9-]{36}$/.test(input.lease)||input.data!==null&&!valid(input.data))throw Error('Invalid shared thumbnail result.');
 return cache(root,db=>({stored:db.prepare('UPDATE thumbnails SET data=?,digest=?,lease=NULL,expires=0 WHERE key=? AND lease=?').run(input.data,input.data?digest(input.data):null,input.key,input.lease).changes===1}));
}
module.exports={read,storeResult,valid,FORMAT};
