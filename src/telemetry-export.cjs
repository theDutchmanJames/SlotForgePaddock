// Public analysis projection. Never export a database snapshot or private car fields.
const timing=require('./timing-integration.cjs');
const PAGE_SIZE=100;
const capability={version:1,index:'/v1/telemetry/results',permission:'timingResults',changes:'/v1/telemetry/changes',filters:['carId','sourceId','trackId','from','to'],events:'/v1/telemetry/events',status:'/v1/telemetry/status',snapshot:true,pageSize:PAGE_SIZE};
const manifests=new WeakMap();
function manifest(db){
  let value=manifests.get(db);if(value)return value;
  const entries=db.timing.sessions.filter(record=>record.format!=='history-v1').map(record=>{
    const p=record.payload,active=p.state==='active';
    const carIds=active?p.participants.filter(p=>p.kind==='physical'&&p.carId).map(p=>p.carId):record.carIds;
    return {sourceId:p.source.id,sessionId:p.sessionId,revision:p.revision,state:p.state,contentHash:record.contentHash,
      resultHash:timing.digest({contentHash:record.contentHash,receivedAt:record.receivedAt,warnings:record.warnings}),
      receivedAt:record.receivedAt,name:active?p.name:record.lastName,type:active?p.type:null,
      startedAt:active?p.startedAt:null,endedAt:active?p.endedAt:null,
      track:active?{sourceId:p.source.id,id:p.track.id,name:p.track.name}:null,
      carIds,summary:active?{name:p.name,type:p.type,startedAt:p.startedAt,trackId:p.track.id,trackName:p.track.name,carIds}:null};
  });
  // Content-derived, not a counter: detects restored data even at the same revision.
  // Only small metadata is hashed, never lap arrays, pictures or private documents.
  value={entries,snapshot:timing.digest({databaseId:db.id,name:db.settings.name,entries})};
  manifests.set(db,value);return value;
}
function authorize(db,method,access,expected){
  if(!expected)throw timing.fault('DATABASE_REQUIRED','Pair with this Paddock database first.');
  if(expected!==db.id)throw timing.fault('DATABASE_MISMATCH','A different database is at this address.',409);
  if(!access.timingResults)throw timing.fault('TIMING_PERMISSION_REQUIRED','Use the Dealership password or the Timing credential to read race results.',403);
  if(method!=='GET')throw timing.fault('NOT_FOUND','This interface is read-only.',404);
}
function parameters(url,allowed){
  const seen=new Set();for(const key of url.searchParams.keys()){
    if(!allowed.includes(key)||seen.has(key))throw timing.fault('INVALID_QUERY','Unknown or repeated query parameter: '+key.slice(0,100));
    seen.add(key);
  }
}
function handle(db,method,url,access,expected){
  authorize(db,method,access,expected);
  if(url.pathname==='/v1/telemetry/status'){
    parameters(url,[]);return {version:1,databaseId:db.id,databaseRevision:db.revision,snapshot:manifest(db).snapshot};
  }
  const index=url.pathname==='/v1/telemetry/results';
  const match=url.pathname.match(/^\/v1\/telemetry\/results\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
  if(!index&&!match)throw timing.fault('NOT_FOUND','Unknown result operation.',404);
  parameters(url,index?['offset','revision','snapshot','carId','sourceId','trackId','from','to']:['revision','snapshot']);
  const revision=url.searchParams.get('revision'),snapshot=url.searchParams.get('snapshot'),view=manifest(db);
  if(revision!==null&&(!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))))throw timing.fault('INVALID_QUERY','Invalid database revision.');
  if(snapshot!==null&&!/^[a-f0-9]{64}$/.test(snapshot))throw timing.fault('INVALID_QUERY','Invalid snapshot token.');
  // A snapshot is stable across unrelated saves. Keep revision-only clients working.
  if(snapshot!==null?snapshot!==view.snapshot:revision!==null&&revision!==String(db.revision))throw timing.fault('SNAPSHOT_CHANGED','Paddock results changed during transfer. Refresh to try again.',409);
  const base={version:1,databaseId:db.id,databaseRevision:db.revision,snapshot:view.snapshot,changeToken:view.snapshot};
  if(index){
    const filters=Object.fromEntries(['carId','sourceId','trackId','from','to'].map(k=>[k,url.searchParams.get(k)]));
    for(const key of ['carId','sourceId','trackId'])if(filters[key]!==null&&!/^[a-zA-Z0-9_-]{1,100}$/.test(filters[key]))throw timing.fault('INVALID_QUERY','Invalid '+key+'.');
    for(const key of ['from','to'])if(filters[key]!==null&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(filters[key])||!Number.isFinite(Date.parse(filters[key]))||new Date(filters[key]).toISOString()!==filters[key]))throw timing.fault('INVALID_QUERY','Use an ISO UTC timestamp with milliseconds for '+key+'.');
    if(filters.from&&filters.to&&filters.from>filters.to)throw timing.fault('INVALID_QUERY','from must not be later than to.');
    // Withdrawals stay visible even when their former track/date no longer exists.
    const entries=view.entries.filter(e=>e.state==='withdrawn'||(!filters.carId||e.carIds.includes(filters.carId))&&(!filters.sourceId||e.sourceId===filters.sourceId)&&(!filters.trackId||e.track.id===filters.trackId)&&(!filters.from||e.startedAt>=filters.from)&&(!filters.to||e.startedAt<filters.to));
    const raw=url.searchParams.get('offset')??'0',offset=Number(raw);
    if(!/^\d+$/.test(raw)||!Number.isSafeInteger(offset)||offset>entries.length||offset>0&&revision===null&&snapshot===null)throw timing.fault('INVALID_PAGE','Invalid result page; continuation pages need the snapshot token.');
    const page=[];let bytes=0;
    for(const entry of entries.slice(offset,offset+PAGE_SIZE)){
      const size=Buffer.byteLength(JSON.stringify(entry));if(page.length&&bytes+size>1024*1024)break;
      page.push(entry);bytes+=size;
    }
    return {...base,name:db.settings.name,entries:page,nextOffset:offset+page.length<entries.length?offset+page.length:null};
  }
  if(revision===null&&snapshot===null)throw timing.fault('REVISION_REQUIRED','Read the result index before downloading a session.');
  const record=db.timing.sessions.find(r=>r.payload.source.id===match[1]&&r.payload.sessionId===match[2]);
  if(record?.format==='history-v1')throw timing.fault('RESULT_REQUIRES_SHARED_HISTORY','Read this session through the shared-history API.',409);
  if(!record)throw timing.fault('SESSION_NOT_FOUND','This session no longer exists.',404);
  return {...base,payload:record.payload,receipt:timing.receipt(db,record)};
}

// Notifications are hints. Reconcile the complete small index after connecting,
// then download only changed sessions. No persistent journal or polling loop.
class Events {
  constructor(network){
    this.network=network;this.clients=new Set();this.waiters=new Set();this.pending=null;
    this.unsubscribe=network.store.subscribe(()=>{if(!(this.clients.size+this.waiters.size)||this.pending)return;this.pending=setImmediate(()=>{this.pending=null;this.changed();});});
  }
  valid(client){return this.network.store.data.id===client.databaseId&&this.network.access(client.code)?.timingResults;}
  cleanup(client){client.closed=true;clearTimeout(client.timer);clearInterval(client.timer);this.clients.delete(client);this.waiters.delete(client);}
  end(client){this.cleanup(client);if(!client.res.destroyed&&!client.res.writableEnded)client.res.end();}
  write(client,text){
    if(client.closed||client.res.destroyed||client.res.writableEnded){this.cleanup(client);return;}
    if(!this.valid(client)){this.end(client);return;}
    try{if(client.res.writableLength>16384||!client.res.write(text)){this.cleanup(client);client.res.destroy();}}catch{this.cleanup(client);client.res.destroy();}
  }
  track(client,set){set.add(client);client.res.once('close',()=>this.cleanup(client));client.res.once('error',()=>{this.cleanup(client);client.res.destroy();});}
  capacity(){if(this.clients.size+this.waiters.size>=10)throw timing.fault('STREAM_LIMIT','Maximum 10 Telemetry notification connections.',429);}
  finishWait(client){
    if(client.closed||client.res.destroyed||client.res.writableEnded){this.cleanup(client);return;}
    const db=this.network.store.data;let status=200,value;
    if(db.id!==client.databaseId){status=409;value={error:'A different database is at this address.',code:'DATABASE_MISMATCH'};}
    else if(!this.network.access(client.code)?.timingResults){status=403;value={error:'Timing access changed. Reconnect with the current password.',code:'TIMING_PERMISSION_REQUIRED'};}
    else{const changeToken=manifest(db).snapshot;value={version:1,databaseId:db.id,changeToken,changed:changeToken!==client.since};}
    this.cleanup(client);
    try{client.res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});client.res.end(JSON.stringify(value));}catch{client.res.destroy();}
  }
  wait(req,res,url,access,code){
    const db=this.network.store.data;authorize(db,req.method,access,req.headers['x-slotforge-database']);parameters(url,['since','wait']);
    const since=url.searchParams.get('since'),raw=url.searchParams.get('wait')??'25';
    if(!since||since.length>256||!/^\d+$/.test(raw)||Number(raw)>25)throw timing.fault('INVALID_QUERY','Supply a nonempty since token (maximum 256 characters) and wait from 0 to 25 seconds.');
    const client={res,code,databaseId:db.id,since};
    if(Number(raw)===0||since!==manifest(db).snapshot){this.finishWait(client);return;}
    this.capacity();this.track(client,this.waiters);client.timer=setTimeout(()=>this.finishWait(client),Number(raw)*1000);client.timer.unref();
  }
  changed(){
    const db=this.network.store.data,view=manifest(db);
    for(const c of this.clients){if(!this.valid(c)){this.end(c);continue;}if(c.snapshot!==view.snapshot){c.snapshot=view.snapshot;this.write(c,'data: '+JSON.stringify({version:1,databaseId:db.id,snapshot:view.snapshot})+'\n\n');}}
    for(const c of this.waiters)if(!this.valid(c)||c.since!==view.snapshot)this.finishWait(c);
  }
  revalidate(){for(const c of this.clients)if(!this.valid(c))this.end(c);for(const c of this.waiters)if(!this.valid(c))this.finishWait(c);}
  open(req,res,url,access,code){
    const db=this.network.store.data;authorize(db,req.method,access,req.headers['x-slotforge-database']);parameters(url,[]);
    this.capacity();const c={res,code,databaseId:db.id,snapshot:manifest(db).snapshot};this.track(c,this.clients);
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
    c.timer=setInterval(()=>this.write(c,': heartbeat\n\n'),15000);c.timer.unref();
    this.write(c,'data: '+JSON.stringify({version:1,databaseId:db.id,snapshot:c.snapshot})+'\n\n');
  }
  close(){this.unsubscribe();if(this.pending)clearImmediate(this.pending);for(const c of [...this.clients,...this.waiters])this.end(c);}
}
function handleStore(store,method,url,access,expected){
 if(!store.file||store.expectedIdentity===null)return handle(store.data,method,url,access,expected);
 authorize(store.data,method,access,expected);
 return require('./sqlite-query.cjs').read(store,null,r=>{
  const model={id:store.data.id,revision:store.data.revision,settings:store.data.settings,timing:{sessions:require('./query-timing.cjs').allMetadata(r)}};
  const match=url.pathname.match(/^\/v1\/telemetry\/results\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
  // Materialize at most the requested session. Other entries contain only
  // public index metadata, not configurations or measured lap arrays.
  if(match){const record=require('./query-timing.cjs').full(r,match[1],match[2]);if(record){const index=model.timing.sessions.findIndex(s=>s.payload.source.id===match[1]&&s.payload.sessionId===match[2]);model.timing.sessions[index]=record;}}
  return handle(model,method,url,access,expected);
 }).value;
}
module.exports={capability,handle,handleStore,manifest,Events};
