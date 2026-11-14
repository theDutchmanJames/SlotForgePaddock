'use strict';
// Optional public projections. No internal record envelopes, private fields or
// Dealership synchronization credentials cross this interface.
const Q=require('./sqlite-query.cjs'),T=require('./timing-integration.cjs'),lazy=require('./lazy-assets.cjs');
const BASE='/v1/scalable',PAGE=50,LAPS=250,CHUNK=256*1024,MAX=8*1024*1024;
const capability={version:1,root:BASE,cars:BASE+'/cars',results:BASE+'/results',changes:BASE+'/changes',status:BASE+'/status',events:BASE+'/events',pageSize:PAGE,lapPageSize:LAPS,mediaChunkBytes:CHUNK,maxResponseBytes:MAX};
const fail=(code,message,status=400)=>{throw T.fault(code,message,status);};
function params(url,allowed){const seen=new Set();for(const k of url.searchParams.keys()){if(!allowed.includes(k)||seen.has(k))fail('INVALID_QUERY','Unknown or repeated query parameter.');seen.add(k);}}
function number(raw,defaultValue=0){if(raw===null)return defaultValue;if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('INVALID_QUERY','Expected a non-negative integer.');return Number(raw);}
function state(r){return {epoch:r.epoch,after:Number(r.db.prepare("SELECT value FROM state WHERE key='change_sequence'").get().value)};}
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
function decode(raw){try{if(!raw||raw.length>512||!/^[a-zA-Z0-9_-]+$/.test(raw))throw Error();const v=JSON.parse(Buffer.from(raw,'base64url'));if(Object.keys(v).sort().join()!=='after,databaseId,epoch'||typeof v.databaseId!=='string'||typeof v.epoch!=='string'||!Number.isSafeInteger(v.after)||v.after<0)throw Error();return v;}catch{fail('INVALID_CURSOR','Invalid cursor.');}}
function cursor(r){return encode({databaseId:r.id,...state(r)});}
function checkSnapshot(r,url,offset){const raw=url.searchParams.get('snapshot');if(!raw){if(offset)fail('SNAPSHOT_REQUIRED','Continuation pages require the first page snapshot.');return;}if(raw!==cursor(r))fail('SNAPSHOT_CHANGED','The collection changed; restart this listing.',409);}
function media(car){const a=lazy.property(car,'picture');if(a)return {hash:a.meta.hash,mime:a.meta.mime,size:a.meta.encodedBytes,encoding:'utf8-data-uri',url:BASE+'/cars/'+car.id+'/media/'+a.meta.hash};if(car.picture)fail('MEDIA_UNAVAILABLE','Save the collection before requesting media.',409);return null;}
function carValue(car){return {id:car.id,revision:car.revision,name:car.name,...Object.fromEntries(['maker','marque','model','scale','raceClass','availability'].map(k=>[k,car[k]||''])),archived:!!car.archived,media:media(car)};}
function resultToken(record,r){return T.digest({databaseId:r.id,epoch:r.epoch,contentHash:record.contentHash,receivedAt:record.receivedAt,warnings:record.warnings});}
function resultValue(record,r){const p=record.payload;return {sourceId:p.source.id,sessionId:p.sessionId,revision:p.revision,state:p.state,name:p.name||record.lastName||'',carIds:record.carIds,resultToken:resultToken(record,r)};}
function readSession(r,source,id,lapsOnly){
 // Lap pages do not reconstruct every driver's configuration/stint metadata.
 const projection=lapsOnly?`json_object('contentHash',json_extract(json,'$.contentHash'),'receivedAt',json_extract(json,'$.receivedAt'),'warnings',json_extract(json,'$.warnings'),
 'payload',json_object('state',json_extract(json,'$.payload.state'),'participants',(SELECT json_group_array(json_object('id',json_extract(p.value,'$.id'))) FROM json_each(query_sessions.json,'$.payload.participants') p)))`:`json_remove(json,'$._query.runs')`;
 const row=r.db.prepare("SELECT key,json_extract(json,'$.format') format,"+projection+' json FROM query_sessions WHERE source=? AND session=?').get(source,id);
 if(row?.format==='history-v1')fail('RESULT_REQUIRES_SHARED_HISTORY','Read this session through the shared-history API.',409);
 return row;
}
function bounded(value){if(Buffer.byteLength(JSON.stringify(value))>MAX)fail('RESPONSE_TOO_LARGE','This response exceeds the supported 8 MiB limit. Use the existing v1 session endpoint where supported.',413);return value;}
function changes(r,url){
 params(url,['kind','cursor']);const kind=url.searchParams.get('kind');if(!['cars','results'].includes(kind))fail('INVALID_QUERY','Choose cars or results.');const since=decode(url.searchParams.get('cursor')),now=state(r);
 if(since.databaseId!==r.id)fail('DATABASE_MISMATCH','This cursor belongs to another database.',409);
 const reset=reason=>({version:1,databaseId:r.id,kind,resetRequired:true,reason,cursor:cursor(r),entries:[],more:false});
 if(since.epoch!==now.epoch)return reset('epoch');if(since.after>now.after)fail('INVALID_CURSOR','Cursor is ahead of this database.',409);
 const rows=r.db.prepare('SELECT sequence FROM change_log WHERE sequence>? ORDER BY sequence LIMIT 32').all(since.after);
 if(since.after<now.after&&(!rows.length||rows[0].sequence!==since.after+1))return reset('expired');
 if(rows.some((row,i)=>row.sequence!==since.after+i+1))return reset('expired');
 const next=rows.at(-1)?.sequence??since.after;
 // Extract keys only inside SQLite; never send internal deltas or private values.
 const entries=r.db.prepare(`SELECT json_extract(c.value,'$.key') key,json_extract(c.value,'$.remove') removed
 FROM change_log l,json_each(l.json,'$.changes') c WHERE l.sequence>? AND l.sequence<=?
 AND json_extract(c.value,'$.key') LIKE ? ORDER BY l.sequence,c.key LIMIT 513`).all(since.after,next,kind==='cars'?'["cars",%':'["timing","sessions",%');
 if(entries.length>512)return reset('batch-size');const selected=new Map();
 if(kind==='cars')for(const row of r.db.prepare("SELECT json_type(json,'$.publicCars') type,json_extract(json,'$.publicCars') cars FROM change_log WHERE sequence>? AND sequence<=? AND EXISTS(SELECT 1 FROM json_each(change_log.json,'$.changes') c WHERE json_extract(c.value,'$.key') LIKE '[\"parts\",%' OR json_extract(c.value,'$.key') LIKE '[\"installations\",%') ORDER BY sequence").all(since.after,next)){
  if(row.type!=='array')return reset('configuration-dependency');
  for(const id of JSON.parse(row.cars)){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))return reset('configuration-dependency');selected.set(id,{carId:id,operation:'invalidate'});}
  if(selected.size>512)return reset('batch-size');
 }
 for(const row of entries){const key=JSON.parse(row.key);if(kind==='cars'&&key[0]==='cars'){const id=key[1].slice(3);selected.set(id,{carId:id,operation:row.removed||require('./car-membership.cjs').isWishlist(r.one('cars',id))?'remove':'invalidate'});}if(kind==='results'&&key[0]==='timing'&&key[1]==='sessions'){const [sourceId,sessionId]=JSON.parse(key[2].slice(8));selected.set(key[2],{sourceId,sessionId,operation:row.removed?'remove':'invalidate'});}}
 if(selected.size>512)return reset('batch-size');
 return {version:1,databaseId:r.id,kind,resetRequired:false,reason:null,cursor:encode({databaseId:r.id,epoch:now.epoch,after:next}),entries:[...selected.values()],more:next<now.after};
}
function handle(store,method,url,access,expected){
 if(method!=='GET')fail('METHOD_NOT_ALLOWED','This extension is read-only.',405);
 if(!expected)fail('DATABASE_REQUIRED','Send X-SlotForge-Database.');if(expected!==store.data.id)fail('DATABASE_MISMATCH','A different database is at this address.',409);
 const route=url.pathname.slice(BASE.length),resultRoute=route.startsWith('/results')||route==='/changes'&&url.searchParams.get('kind')==='results';
 if(!(resultRoute?access.timingResults:access.browse))fail('PERMISSION_REQUIRED',resultRoute?'Result-reading permission is required.':'Browsing permission is required.',403);
 if(!store.file||store.expectedIdentity===null)fail('STORAGE_REQUIRED','Save this collection before using the extension.',409);
 // Keep the existing signed capture semantics; only its optional inline image
 // is omitted. Creating a signing key is an existing Timing operation.
 const profile=route.match(/^\/cars\/([a-zA-Z0-9_-]{1,100})\/profile$/);
 if(profile){params(url,[]);const value=T.profile(store,profile[1],{includePicture:false});return bounded({version:1,profile:value,media:Q.read(store,null,r=>media(r.one('cars',profile[1]))).value});}
 return bounded(Q.read(store,null,r=>{
  const base={version:1,databaseId:r.id};
  if(route===''||route==='/'){params(url,[]);return {...base,...capability};}
  if(route==='/status'){params(url,[]);return {...base,cursor:cursor(r)};}
  if(route==='/changes')return changes(r,url);
  if(route==='/cars'){params(url,['offset','snapshot']);const offset=number(url.searchParams.get('offset'));checkSnapshot(r,url,offset);const page=r.list('cars',{collectionStatus:'collection',offset,limit:PAGE});if(offset>page.total)fail('INVALID_PAGE','Offset exceeds the car list.');return {...base,snapshot:cursor(r),cursor:cursor(r),cars:page.rows.map(carValue),nextOffset:page.nextOffset};}
  const picture=route.match(/^\/cars\/([a-zA-Z0-9_-]{1,100})\/media\/([a-f0-9]{64})$/);
  if(picture){params(url,['offset']);const car=r.one('cars',picture[1]);if(!car||require('./car-membership.cjs').isWishlist(car))fail('CAR_NOT_FOUND','Car no longer exists.',404);const a=lazy.property(car,'picture');if(!a||a.meta.hash!==picture[2])fail('MEDIA_CHANGED','This image is no longer the car main picture; refresh the car.',409);const offset=number(url.searchParams.get('offset'));if(offset>=a.meta.encodedBytes)fail('INVALID_PAGE','Offset exceeds the image.');const row=r.db.prepare('SELECT substr(value,?,?) bytes FROM assets WHERE hash=?').get(offset+1,CHUNK,picture[2]);return {...base,hash:picture[2],offset,size:a.meta.encodedBytes,data:Buffer.from(row.bytes).toString('base64'),nextOffset:offset+row.bytes.length<a.meta.encodedBytes?offset+row.bytes.length:null};}
  if(route==='/results'){params(url,['offset','snapshot','carId']);const offset=number(url.searchParams.get('offset')),carId=url.searchParams.get('carId');if(carId!==null&&!/^[a-zA-Z0-9_-]{1,100}$/.test(carId))fail('INVALID_QUERY','Invalid car ID.');checkSnapshot(r,url,offset);const where=carId?' WHERE EXISTS (SELECT 1 FROM query_car_results c WHERE c.key=s.key AND c.car_id=?)':'',args=carId?[carId]:[];const total=r.db.prepare('SELECT count(*) n FROM query_sessions s'+where).get(...args).n;if(offset>total)fail('INVALID_PAGE','Offset exceeds the result list.');const rows=r.db.prepare("SELECT json_object('carIds',json_extract(s.json,'$.carIds'),'lastName',json_extract(s.json,'$.lastName'),'contentHash',json_extract(s.json,'$.contentHash'),'receivedAt',json_extract(s.json,'$.receivedAt'),'warnings',json_extract(s.json,'$.warnings'),'payload',json_object('source',json_extract(s.json,'$.payload.source'),'sessionId',json_extract(s.json,'$.payload.sessionId'),'revision',json_extract(s.json,'$.payload.revision'),'state',json_extract(s.json,'$.payload.state'),'name',json_extract(s.json,'$.payload.name'))) json FROM query_sessions s"+where+" ORDER BY s.source,s.session LIMIT ? OFFSET ?").all(...args,PAGE,offset);return {...base,snapshot:cursor(r),cursor:cursor(r),results:rows.map(v=>resultValue(JSON.parse(v.json),r)),nextOffset:offset+rows.length<total?offset+rows.length:null};}
  const session=route.match(/^\/results\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})(?:\/laps\/([a-zA-Z0-9_-]{1,100}))?$/);
  if(session){params(url,session[3]?['offset','token']:['token']);const row=readSession(r,session[1],session[2],!!session[3]);if(!row)fail('SESSION_NOT_FOUND','Session no longer exists.',404);const record=JSON.parse(row.json),token=resultToken(record,r),requested=url.searchParams.get('token');if(session[3]&&!requested)fail('TOKEN_REQUIRED','Read the session metadata before requesting laps.');if(requested!==null&&requested!==token)fail('RESULT_CHANGED','Session was corrected, withdrawn or replaced; discard its downloaded pages and reload.',409);
   if(session[3]){if(record.payload.state!=='active')fail('SESSION_WITHDRAWN','This session has been withdrawn.',409);if(!record.payload.participants.some(p=>p.id===session[3]))fail('PARTICIPANT_NOT_FOUND','Participant no longer exists.',404);const offset=number(url.searchParams.get('offset')),total=r.db.prepare('SELECT count(*) n FROM query_laps WHERE key=? AND participant=?').get(row.key,session[3]).n;if(offset>total)fail('INVALID_PAGE','Offset exceeds the lap list.');const laps=r.db.prepare('SELECT json FROM query_laps WHERE key=? AND participant=? ORDER BY position LIMIT ? OFFSET ?').all(row.key,session[3],LAPS,offset).map(l=>JSON.parse(l.json));return {...base,sourceId:session[1],sessionId:session[2],participantId:session[3],resultToken:token,laps,total,nextOffset:offset+laps.length<total?offset+laps.length:null};}
   const payload={...record.payload};if(payload.state==='active')payload.participants=payload.participants.map(({laps,...p})=>p);return {...base,resultToken:token,payload,summaries:record._query.summaries,requiresCorrection:record._query.requiresCorrection,warnings:record.warnings,lapCounts:r.db.prepare('SELECT participant participantId,count(*) count FROM query_laps WHERE key=? GROUP BY participant').all(row.key)};
  }
  fail('NOT_FOUND','Unknown scalable API route.',404);
 }).value);
}
class Events {
 constructor(network){this.network=network;this.clients=new Set();this.closed=false;this.pending=false;this.running=false;this.unsubscribe=network.store.subscribe(()=>this.queue());this.heartbeat=setInterval(()=>this.queue(),15000);this.heartbeat.unref();}
 valid(c){return this.network.store.data.id===c.databaseId&&this.network.access(c.code)?.browse;}
 end(c){this.clients.delete(c);if(!c.res.writableEnded&&!c.res.destroyed)c.res.end();}
 revalidate(){for(const c of this.clients)if(!this.valid(c))this.end(c);}
 async open(req,res,url,code){params(url,[]);const network=this.network;const value=await network.store.withIdle(()=>handle(network.store,req.method,new URL('http://localhost'+BASE+'/status'),network.access(code)||{},req.headers['x-slotforge-database']));if(this.closed)fail('HOST_STOPPED','Host stopped.',503);if(this.clients.size>=10)fail('STREAM_LIMIT','Maximum 10 scalable notification connections.',429);const c={res,code,databaseId:value.databaseId};this.clients.add(c);res.once('close',()=>this.clients.delete(c));res.once('error',()=>this.clients.delete(c));res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});this.write(c,value);}
 write(c,value){if(!this.valid(c)){this.end(c);return;}if(c.res.destroyed||c.res.writableEnded){this.clients.delete(c);return;}try{if(c.res.writableLength>16384||!c.res.write('data: '+JSON.stringify(value)+'\n\n')){this.clients.delete(c);c.res.destroy();}}catch{this.clients.delete(c);c.res.destroy();}}
 queue(){if(this.closed||!this.clients.size)return;this.pending=true;if(this.timer||this.running)return;this.timer=setTimeout(()=>{this.timer=null;void this.flush();},50);this.timer.unref();}
 async flush(){if(this.closed)return;this.pending=false;this.running=true;try{const value=await this.network.store.withIdle(()=>Q.read(this.network.store,null,r=>({version:1,databaseId:r.id,cursor:cursor(r)})).value);if(!this.closed)for(const c of this.clients)this.write(c,value);}catch{for(const c of [...this.clients])this.end(c);}finally{this.running=false;if(this.pending)this.queue();}}
 close(){this.closed=true;this.unsubscribe();clearTimeout(this.timer);clearInterval(this.heartbeat);for(const c of [...this.clients])this.end(c);}
}
module.exports={capability,handle,BASE,Events};
