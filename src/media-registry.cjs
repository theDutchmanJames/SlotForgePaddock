'use strict';
// Only URLs issued to this window can access originals. Paths/hashes are not
// accepted from a renderer request. Leases preserve open editors and viewers.
const {randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),lazy=require('./lazy-assets.cjs');
const childContext=(object,key,literal)=>{const patch=key==='value'&&Array.isArray(object.path),field=patch?object.path.at(-1):key;return [field,literal||field==='custom'||field==='choices'||patch&&object.path.some(k=>k==='custom'||k==='choices')];};
const photoContext=(key,literal)=>!literal&&(key===undefined||key==='picture'||key==='data');
class RendererMedia {
 constructor(options={}){this.clock=options.clock||Date.now;this.grace=options.grace??60000;this.folder=options.folder;this.clear();}
 clear(){if(this.byUrl)for(const e of this.byUrl.values())if(e.staged)try{fs.unlinkSync(e.staged);}catch{}if(this.retired)for(const file of this.retired.keys())try{fs.unlinkSync(file);}catch{}this.retired=new Map();this.byHash=new Map();this.byUrl=new Map();this.lease=null;this.stagedBytes=0;}
 removeStage(entry){if(!entry.staged)return;try{fs.unlinkSync(entry.staged);this.stagedBytes-=entry.meta.encodedBytes;}catch(error){if(error.code==='ENOENT')this.stagedBytes-=entry.meta.encodedBytes;else this.retired.set(entry.staged,entry.meta.encodedBytes);}delete entry.staged;}
 leaseOpen(open){if(open&&!this.lease)this.lease=new Set(this.byUrl.keys());if(!open)this.lease=null;}
 register(value){const source=typeof value==='string'?null:value,meta=source?.meta||lazy.metadata(value);let url=this.byHash.get(meta.hash),entry=url&&this.byUrl.get(url);
  if(!entry){url='paddock-media://image/'+randomUUID();entry={meta,source,value:source?null:value,touched:this.clock()};
   if(!source&&this.folder){if(this.stagedBytes+meta.encodedBytes>200*1024*1024)throw Error('Temporary photographs exceed 200 MiB. Save or close the open editor before adding more.');fs.mkdirSync(this.folder,{recursive:true});entry.staged=path.join(this.folder,randomUUID()+'.media');fs.writeFileSync(entry.staged,value,{encoding:'utf8',flag:'wx'});entry.value=null;this.stagedBytes+=meta.encodedBytes;}
   this.byHash.set(meta.hash,url);this.byUrl.set(url,entry);
  }else if(source){entry.source=source;entry.value=null;this.removeStage(entry);}
  entry.touched=this.clock();this.lease?.add(url);return url;
 }
 project(value,key,literal=false){
  if(photoContext(key,literal)&&typeof value==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(value))return this.register(value);
  if(Array.isArray(value))return value.map(v=>this.project(v,key,literal));
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).map(k=>{const context=childContext(value,k,literal),a=lazy.property(value,k);return [k,a?.meta.photo&&photoContext(...context)?this.register(a):this.project(value[k],...context)];}));
  return value;
 }
 original(entry){const value=entry.source?entry.source.read():entry.staged?fs.readFileSync(entry.staged,'utf8'):entry.value;if(lazy.digest(value)!==entry.meta.hash)throw Error('Photograph integrity check failed.');return value;}
 expand(value,key,literal=false){
  if(photoContext(key,literal)&&typeof value==='string'&&value.startsWith('paddock-media:')){const e=this.byUrl.get(value);if(!e)throw Error('This photograph reference expired. Reopen the page and try again.');return this.original(e);}
  if(Array.isArray(value))return value.map(v=>this.expand(v,key,literal));
  if(value&&typeof value==='object'){const out={};for(const k of Object.keys(value)){const context=childContext(value,k,literal),v=value[k],e=photoContext(...context)&&typeof v==='string'&&this.byUrl.get(v);if(e?.source)lazy.attach(out,k,e.source);else Object.defineProperty(out,k,{enumerable:true,writable:true,configurable:true,value:this.expand(v,...context)});}return out;}
  return value;
 }
 lookup(url){let p;try{p=new URL(url);}catch{return null;}if(p.protocol!=='paddock-media:'||p.host!=='image'||p.username||p.password||p.port||p.hash||p.search&&p.search!=='?thumbnail=1')return null;const entry=this.byUrl.get(p.protocol+'//'+p.host+p.pathname);return entry?{entry,thumbnail:!!p.search}:null;}
 response(url){const found=this.lookup(url);if(!found)return null;found.entry.touched=this.clock();const data=this.original(found.entry),comma=data.indexOf(',');return {mime:found.entry.meta.mime,bytes:Buffer.from(data.slice(comma+1),'base64'),thumbnail:found.thumbnail};}
 async responseAsync(url){const found=this.lookup(url);if(!found)return null;const e=found.entry;e.touched=this.clock();if(!e.source&&!e.staged)return this.response(url);
  if(!this.reader){const {Writer}=require('./sqlite-writer.cjs'),{Worker}=require('node:worker_threads');this.reader=new Writer(()=>new Worker(path.join(__dirname,'media-reader.cjs')));}
  const value=await this.reader.write(e.staged||e.source.file,{hash:e.meta.hash,staged:!!e.staged},null);return {...value,thumbnail:found.thumbnail};
 }
 retain(roots){const live=new Set();const visit=(value,key,literal=false)=>{const deferred=require('./deferred-store.cjs').state(value);if(deferred){const entries=[...this.byUrl].filter(([,e])=>e.source?.file===deferred.file),hashes=new Set(deferred.liveHashes(entries.map(([,e])=>e.meta.hash)));for(const [url,e]of entries)if(hashes.has(e.meta.hash))live.add(url);return;}if(photoContext(key,literal)&&typeof value==='string'&&value.startsWith('data:image/')){const u=this.byHash.get(lazy.digest(value));if(u)live.add(u);return;}if(Array.isArray(value)){for(const v of value)visit(v,key,literal);return;}if(value&&typeof value==='object')for(const k of Object.keys(value)){const context=childContext(value,k,literal),a=lazy.property(value,k);if(a){const u=this.byHash.get(a.meta.hash);if(u&&photoContext(...context))live.add(u);}else visit(value[k],...context);}};for(const root of roots)visit(root);
  for(const [url,e]of this.byUrl)if(!live.has(url)&&!this.lease?.has(url)&&this.clock()-e.touched>=this.grace){this.removeStage(e);this.byUrl.delete(url);this.byHash.delete(e.meta.hash);}
  for(const [file,bytes]of this.retired)try{fs.unlinkSync(file);this.stagedBytes-=bytes;this.retired.delete(file);}catch(error){if(error.code==='ENOENT'){this.stagedBytes-=bytes;this.retired.delete(file);}}
 }
 stats(){return {entries:this.byUrl.size,leased:this.lease?.size||0,stagedBytes:this.stagedBytes};}
}
module.exports={RendererMedia};
