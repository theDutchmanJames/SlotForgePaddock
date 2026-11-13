const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const discovery=require('./discovery.cjs');
const timing=require('./timing-integration.cjs');
const telemetry=require('./telemetry-export.cjs');
const { publicCar, makePackage, validatePackage } = require('./store.cjs');
const MAX = 32 * 1024 * 1024;
const PAGE_BYTES=16*1024*1024;
function identityError(){const error=Error('A different database is at this address. Disconnect and pair with it explicitly.');error.identityChanged=true;return error;}
function publicView(id,revision,name,cars){return {schema:1,id,revision,settings:{name},cars,setups:[],parts:[],assemblies:[],installations:[],events:[],tests:[],submissions:[],choices:{},views:[],customFields:[]};}
function localAddress(address) {
  if(typeof address!=='string'||address.length>2048)throw new Error('Enter the sharing computer’s local IPv4 address and port.');
  let url;try{url=new URL(address.includes('://')?address:'http://'+address);}catch{throw new Error('Enter an address such as 192.168.1.20:4777.');}
  const h=url.hostname;
  if(url.protocol!=='http:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Use a local HTTP address and port only.');
  const octets=h.split('.').map(Number);
  const privateIP=octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(octets[0]===10||octets[0]===127||(octets[0]===192&&octets[1]===168)||(octets[0]===172&&octets[1]>=16&&octets[1]<=31));
  if(h!=='localhost'&&!privateIP)throw new Error('Use the sharing computer’s local IPv4 address. Internet addresses are not supported.');
  return url.origin;
}
class Network {
  constructor(store,onChange=()=>{},onNetwork=()=>{},local=null){this.local=local;this.work=new (require('./work-gate.cjs').WorkGate)();this.shutdownAbort=new AbortController();this.store=store;this.onChange=onChange;this.onNetwork=onNetwork;this.server=null;this.code='';this.browseCode='';this.allowSubmissions=true;this.remote=null;this.cached=null;this.pending=null;this.generation=0;this.readAbort=new AbortController();this.starting=null;this.advertiser=null;this.discoveryError='';this.refreshing=null;this.nextPoll=0;this.failures=0;this.scanning=null;this.sending=false;}
  status(){return {...(this.portal?{portal:this.portal.status()}:{}),...(this.backgroundMode?{background:this.backgroundMode.status()}:{}),...(this.localLibrary?{localLibrary:this.localLibrary.status()}:{}),hostingMode:this.server?this.hostingMode:null,clubCode:this.club?.coordinator?(this.clubCode||''):'',timingCode:this.timingCode||'',sharing:!!this.server&&!!this.port,code:this.code,browseCode:this.browseCode,allowSubmissions:this.allowSubmissions,discoverable:!!this.advertiser,discoveryError:this.discoveryError,port:this.port||0,addresses:this.server?Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal).map(i=>i.address+':'+this.port):[],remote:this.remote?{address:this.remote.address,name:this.remote.name,id:this.remote.id,state:this.remote.state,lastSync:this.remote.lastSync,lastError:this.remote.lastError,permissions:this.remote.permissions,autoRefresh:this.remote.autoRefresh}:null,pending:this.pending?{hostId:this.pending.hostId,name:this.pending.name,count:this.pending.bundle.cars.length}:null};}
  notify(data){try{this.onNetwork({status:this.status(),...(data?{data}: {})});}catch{}}
  access(code){const token=Buffer.from(String(code||''));const matches=value=>{const expected=Buffer.from(value||'');return expected.length>0&&token.length===expected.length&&crypto.timingSafeEqual(token,expected);};
    if(this.local)return this.local.available()&&matches(this.local.token)?{browse:true,submit:false,timingResults:true,localImport:true,sharedCars:true}:null;
    if(this.hostingMode==='dealership')return this.club?.coordinator&&matches(this.clubCode)?{browse:true,submit:true,timingResults:true,club:true}:null;
    for(const [value,submit,timingResults]of [[this.code,true,false],[this.browseCode,false,false],[this.timingCode,false,true]])if(matches(value))return {browse:true,submit:submit&&this.allowSubmissions,timingResults};return null;
  }
  controls(p={}){
    if(this.club?.coordinator)throw Error('Use the Dealership password and hosting controls.');
    if(!this.server)throw Error('Start sharing first.');
    // Validate every change before applying any of it, including permission flags.
    for(const key of ['allowSubmissions'])if(p[key]!==undefined&&typeof p[key]!=='boolean')throw Error('Invalid permission.');
    let credentialKey;
    if(p.password!==undefined){

      credentialKey=({browse:'browseCode',submit:'code',timing:'timingCode'})[p.access];
      if(!['browse','submit','timing'].includes(p.access)||!credentialKey)throw Error('Choose a valid access type.');
      if(p.rotate===true)throw Error('Set a password or revoke all passwords separately.');
      if(typeof p.password!=='string'||p.password.length<8||p.password.length>128||!/^[\x20-\x7e]+$/.test(p.password)||p.password!==p.password.trim())throw Error('Use 8–128 characters: English letters, numbers, spaces or symbols, with no spaces at either end.');
      if(['code','browseCode','timingCode','clubCode'].some(key=>key!==credentialKey&&this[key]===p.password))throw Error('Use a different password for each access type.');
    }
    for(const key of ['allowSubmissions'])if(p[key]!==undefined)this[key]=p[key];
    if(credentialKey)this[credentialKey]=p.password;
    if(p.rotate===true){this.code=crypto.randomBytes(12).toString('hex');this.browseCode=crypto.randomBytes(12).toString('hex');this.timingCode=crypto.randomBytes(12).toString('hex');}
    if(credentialKey||p.rotate===true){this.authAttempts?.clear();this.telemetryEvents?.revalidate();this.scalableEvents?.revalidate();}
    return this.status();
  }
  async discover(){if(!this.scanning)this.scanning=discovery.scan().finally(()=>{this.scanning=null;});return (await this.scanning).filter(h=>h.id!==this.store.data.id);}
  async start(){if(this.work.closing)throw require('./work-gate.cjs').closingError();if(!this.local)this.club?.assertHost();if(this.starting){await this.starting;return this.status();}if(!this.local&&this.server&&this.hostingMode!==(this.club?.coordinator?'dealership':'legacy'))await this.stop();if(this.server)return this.status();this.starting=this.startHost();try{await this.starting;}finally{this.starting=null;}return this.status();}
  async startHost(){this.hostingMode=this.local?'local':this.club?.coordinator?'dealership':'legacy';
    if(this.local){this.code='';this.browseCode='';this.timingCode='';this.clubCode='';}
    else if(this.hostingMode==='dealership'){this.clubCode=this.club.password(this.club.device.hostPassword);this.code='';this.browseCode='';this.timingCode='';}
    else{this.clubCode='';this.code=crypto.randomBytes(12).toString('hex');this.browseCode=crypto.randomBytes(12).toString('hex');this.timingCode=crypto.randomBytes(12).toString('hex');}
    this.allowSubmissions=true;this.authAttempts=new Map();
    this.server=http.createServer(require('./work-gate.cjs').http(this.work,async(req,res)=>{
      const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;if(res.headersSent){res.destroy();return;}res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status>=400&&!req.url.startsWith('/v1/timing/')&&!req.url.startsWith('/v1/local-library/')&&!req.url.startsWith('/v1/shared-history/')&&req.url!=='/v1/submissions'?{'Connection':'close'}:{})});if(status>=400){let discarded=0;const timer=setTimeout(()=>{if(!req.complete)req.destroy();},2000);timer.unref();req.once('end',()=>clearTimeout(timer));req.on('data',chunk=>{discarded+=chunk.length;if(discarded>16*1024*1024)req.destroy();});req.resume();}res.end(JSON.stringify(value));};
      if(Object.hasOwn(req.headers,'origin'))return send(403,{error:'Browser access is not supported.',code:'BROWSER_ORIGIN_FORBIDDEN'});
      if(this.local&&!this.local.available())return send(503,{error:'This local library is unavailable during database replacement or without local ownership.',code:'LOCAL_UNAVAILABLE'});
      const now=Date.now(),peer=req.socket.remoteAddress;
      for(const [key,value]of this.authAttempts)if(value.until<=now)this.authAttempts.delete(key);
      const attempt=this.authAttempts.get(peer);
      if(attempt?.count>=10){res.setHeader('Retry-After',Math.max(1,Math.ceil((attempt.until-now)/1000)));return send(429,{error:'Too many incorrect passwords. Wait one minute before trying again.',code:'AUTH_RATE_LIMITED'});}
      const authorization=String(req.headers.authorization||''),code=authorization.startsWith('Bearer ')?authorization.slice(7):'',access=this.access(code);
      if(!access){
        if(!attempt&&this.authAttempts.size>=256)this.authAttempts.delete(this.authAttempts.keys().next().value);
        this.authAttempts.set(peer,{count:(attempt?.count||0)+1,until:attempt?.until||now+60000});
        return send(401,{error:'Incorrect connection code or password.',code:'UNAUTHENTICATED'});
      }
      // Keep failed guesses for the whole window: a valid browse credential
      // must not reset the limit while guessing a higher-permission password.
      try{
        const url=new URL(req.url,'http://localhost');
        if(this.local&&req.headers['x-slotforge-instance']!==this.local.instanceId)throw timing.fault('INSTANCE_CHANGED','Rediscover this local library instance.',409);
        if(this.local&&url.pathname!=='/v1/status'){if(!req.headers['x-slotforge-database'])throw timing.fault('DATABASE_REQUIRED','Send X-SlotForge-Database.');if(req.headers['x-slotforge-database']!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','The local library identity changed.',409);}
        if(this.local&&url.pathname.startsWith('/v1/shared-history/'))return await require('./shared-history.cjs').handle(this,req,res,url,code,send);
        if(this.local&&url.pathname.startsWith('/v1/local-library/'))return await this.local.handle(this,req,res,url,code,send);
        if(this.local&&['/v1/submissions','/v1/club'].some(p=>url.pathname===p||url.pathname.startsWith(p+'/')))return send(403,{error:'Use the reviewed local import endpoint.',code:'LOCAL_ROUTE_FORBIDDEN'});
        if(this.work.closing&&(url.pathname.endsWith('/events')||url.pathname==='/v1/telemetry/changes'))return send(503,{error:'Host is closing.',code:'HOST_CLOSING'});
        if(url.pathname==='/v1/scalable/events')return await this.scalableEvents.open(req,res,url,code);
        if(url.pathname==='/v1/scalable'||url.pathname.startsWith('/v1/scalable/'))return await this.store.withIdle(()=>send(200,require('./scalable-api.cjs').handle(this.store,req.method,url,this.access(code)||{},req.headers['x-slotforge-database'])));
        if(req.method==='GET'&&/^\/v1\/rebuilds\/cars\/[a-zA-Z0-9_-]{1,100}$/.test(url.pathname))return await this.store.withIdle(()=>{if(!this.access(code)?.browse)throw timing.fault('UNAUTHENTICATED','Browsing is unavailable.',401);if(req.headers['x-slotforge-database']!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','Specify the original database identity.',409);if(url.search)throw timing.fault('INVALID_QUERY','This lookup has no query parameters.');return send(200,require('./rebuild.cjs').lifecycle(this.store,url.pathname.split('/').pop()));});
        if(req.method==='GET'&&url.pathname==='/v1/status')return await this.store.withIdle(()=>{const currentAccess=this.access(code);if(!currentAccess)return send(403,{error:'Connection permission changed.',code:'PERMISSION_CHANGED'});const clubFieldReview=this.club?.coordinator?require('./field-review.cjs').capability(this.store):null;return send(200,{protocol:2,id:this.store.data.id,revision:this.store.data.revision,catalogueRevision:this.store.data.catalogueRevision,name:this.store.data.settings.name,permissions:currentAccess,...(this.local?{localInstanceId:this.local.instanceId}:{}),capabilities:{...(this.local&&req.headers['x-slotforge-extensions']==='shared-history-v1'?{sharedHistory:require('./shared-history.cjs').capability}:{}),...(this.local?{localLibrary:require('./local-library-api.cjs').capability}:{}),...(req.headers['x-slotforge-extensions']==='scalable-v1'?{scalable:require('./scalable-api.cjs').capability,rebuilds:require('./rebuild.cjs').capability}:{}),telemetry:telemetry.capability,...timing.capabilities(),...(this.club?.coordinator?{club:1}:{}),...(clubFieldReview?{clubFieldReview:1}:{})},...(this.club?.coordinator?{clubId:this.store.data.club.id}:{}),...(clubFieldReview?{clubFieldReview}:{})});});
        if(url.pathname==='/v1/telemetry/events')return this.telemetryEvents.open(req,res,url,access,code);
        if(url.pathname==='/v1/telemetry/changes')return this.telemetryEvents.wait(req,res,url,access,code);
        if(url.pathname.startsWith('/v1/telemetry/'))return await this.store.withIdle(()=>send(200,telemetry.handleStore(this.store,req.method,url,this.access(code)||{},req.headers['x-slotforge-database'])));
        if(url.pathname.startsWith('/v1/club/')&&this.club)return await this.club.handle(req,res,url,access,code);
        if(url.pathname.startsWith('/v1/timing/')){
          const expected=req.headers['x-slotforge-database'];
          if(!expected)throw timing.fault('DATABASE_REQUIRED','Send X-SlotForge-Database with the paired database ID.');
          if(expected!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','A different database is at this address.',409);
          const carMatch=url.pathname.match(/^\/v1\/timing\/cars\/([a-zA-Z0-9_-]{1,100})$/);
          if(req.method==='GET'&&carMatch)return await this.store.withIdle(()=>{if(expected!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','The host database changed while waiting.',409);if(!this.access(code)?.browse)throw timing.fault('UNAUTHENTICATED','Connection access changed while waiting.',401);const before=this.store.data.revision,value=timing.profile(this.store,carMatch[1]);if(this.store.data.revision!==before)try{this.onChange({kind:'timing-capture'});}catch{}return send(200,value);});
          if(!access.timingResults)throw timing.fault('TIMING_PERMISSION_REQUIRED','Use the Dealership password, or the Timing credential on a legacy host, to send and check results.',403);
          const receiptMatch=url.pathname.match(/^\/v1\/timing\/sessions\/([a-zA-Z0-9_-]{1,100})\/([a-zA-Z0-9_-]{1,100})$/);
          if(req.method==='GET'&&receiptMatch){return await this.store.withIdle(async()=>{
            const guard=()=>{if(expected!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','The host database changed.',409);if(!this.access(code)?.timingResults)throw timing.fault('TIMING_PERMISSION_REQUIRED','Timing access changed.',403);};guard();
            if(this.store.file&&this.store.expectedIdentity!==null)return send(200,await require('./domain-tasks.cjs').run(this.store,{kind:'timing-receipt',sourceId:receiptMatch[1],sessionId:receiptMatch[2]},guard));
            const record=this.store.data.timing.sessions.find(r=>r.payload.source.id===receiptMatch[1]&&r.payload.sessionId===receiptMatch[2]);if(!record)throw timing.fault('SESSION_NOT_FOUND','No session with that source and session ID is stored.',404);return send(200,timing.receipt(this.store.data,record));
          });}
          if(req.method==='POST'&&url.pathname==='/v1/timing/sessions'){
            if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw timing.fault('CONTENT_TYPE_REQUIRED','Send application/json with UTF-8 encoding.',415);
            if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw timing.fault('CONTENT_ENCODING_UNSUPPORTED','Compressed request bodies are not supported.',415);
            if(Number(req.headers['content-length'])>timing.MAX_BYTES)throw timing.fault('PAYLOAD_TOO_LARGE','Timing sessions are limited to 8 MiB.',413);
            const chunks=[];let size=0;for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>timing.MAX_BYTES){send(413,{error:'Timing sessions are limited to 8 MiB.',code:'PAYLOAD_TOO_LARGE'});return;}chunks.push(chunk);}
            if(expected!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','The host database changed during upload.',409);
            if(!this.access(code)?.timingResults)throw timing.fault('TIMING_PERMISSION_REQUIRED','Timing access changed during upload.',403);
            const result=await timing.receiveAsync(this.store,Buffer.concat(chunks),()=>{if(expected!==this.store.data.id)throw timing.fault('DATABASE_MISMATCH','The host database changed during upload.',409);if(!this.access(code)?.timingResults)throw timing.fault('TIMING_PERMISSION_REQUIRED','Timing access changed during upload.',403);});
            if(!result.duplicate)try{this.onChange({kind:'timing'});}catch{}return send(200,result);
          }
          throw timing.fault('NOT_FOUND','Unknown Timing operation.',404);
        }
        if(req.method==='GET'&&url.pathname==='/v1/collection')return await this.store.withIdle(()=>{
          const access=this.access(code);if(!access?.browse)return send(403,{error:'Browsing access changed. Reconnect.'});
          const db=this.store.data,offset=Number(url.searchParams.get('offset')||0),paged=req.headers['x-slotforge-pages']==='1'&&this.store.file&&this.store.expectedIdentity!==null&&Number.isSafeInteger(offset)&&offset>=0?require('./sqlite-query.cjs').read(this.store,null,r=>r.list('cars',{archived:false,offset,limit:25})).value:null,all=paged?null:db.cars.filter(c=>!c.archived),total=paged?paged.total:all.length;
          if(req.headers['x-slotforge-pages']!=='1'){const view=publicView(db.id,db.revision,db.settings.name,all.map(publicCar));if(require('./json-encoding.cjs').byteLength(view)>MAX)return send(413,{error:'This photo collection needs a newer SlotForge client with paged transfers.'});return send(200,{...view,catalogueRevision:db.catalogueRevision,permissions:access});}
          if(!Number.isSafeInteger(offset)||offset<0||offset>total)return send(400,{error:'Invalid collection page.'});
          if(offset>0&&(url.searchParams.get('revision')!==String(db.revision)||url.searchParams.get('database')!==db.id))return send(409,{error:'The shared collection changed during transfer. Refresh to try again.'});
          const cars=[];let size=0;
          for(const car of (paged?paged.rows:all.slice(offset,offset+25))){const value=publicCar(car),bytes=require('./json-encoding.cjs').byteLength(value);if(cars.length&&size+bytes>PAGE_BYTES)break;cars.push(value);size+=bytes;}
          return send(200,{...publicView(db.id,db.revision,db.settings.name,cars),catalogueRevision:db.catalogueRevision,permissions:access,nextOffset:offset+cars.length<total?offset+cars.length:null});
        });
        if(req.method==='POST'&&req.url==='/v1/submissions'){
          if(req.headers['x-slotforge-database']&&req.headers['x-slotforge-database']!==this.store.data.id)return send(409,{error:'The database at this address changed. Reconnect to the original host.'});
          if(!access.submit)return send(403,{error:'This connection is browse-only or the host has paused submissions.'});
          if(Number(req.headers['content-length'])>MAX)return send(413,{error:'Package exceeds the 32 MB network limit. Use a file export.'});
          let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>MAX){send(413,{error:'Package exceeds the 32 MB network limit. Use a file export.'});return;}chunks.push(chunk);}
          if(req.headers['x-slotforge-database']&&req.headers['x-slotforge-database']!==this.store.data.id)return send(409,{error:'The host database changed during upload.'});
          if(!this.access(code)?.submit)return send(403,{error:'Submission access changed during upload. Reconnect with a current submission code.'});
          return await this.store.withIdle(()=>{if(req.headers['x-slotforge-database']&&req.headers['x-slotforge-database']!==this.store.data.id)return send(409,{error:'The host database changed during upload.'});if(!this.access(code)?.submit)return send(403,{error:'Submission access changed during upload. Reconnect with a current submission code.'});const result=this.store.mutate('submission.add',{package:JSON.parse(Buffer.concat(chunks).toString())});if(result.result!=='duplicate'){try{this.onChange();}catch{/* Notification failure must not change a successful save response. */}}return send(200,{ok:true,duplicate:result.result==='duplicate'});});
        }
        send(404,{error:'Unknown operation.'});
      }catch(e){
        if(e.code==='WORKER_BUSY'){res.setHeader('Retry-After','1');return send(503,{error:'Paddock is busy processing earlier requests. Keep this request queued and retry shortly.',code:'STORAGE_FAILED'});}
        const recovery=e.code==='WRITE_UNCERTAIN'?'The save acknowledgement was interrupted. Check its receipt or retry the same request; do not create a new transfer.':e.code==='QUERY_CHANGED'?'The library changed while processing this request. Reconnect to the original database and check its receipt before retrying.':'The host could not save this request. Check storage on the Paddock computer, then retry the same request.';
        send(e.httpStatus||(e.code?500:400),{error:e.code?recovery:e.message,code:e.apiCode||(e.code?'STORAGE_FAILED':'INVALID_PAYLOAD'),...(e.details?{details:e.details}:{})});
      }
    }));
    this.telemetryEvents=new telemetry.Events(this);this.scalableEvents=new (require('./scalable-api.cjs').Events)(this);
    this.server.requestTimeout=15000;this.server.headersTimeout=10000;this.server.maxConnections=30;
    const listening=new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,this.local?'127.0.0.1':'0.0.0.0',resolve);});
    try{await listening;this.port=this.server.address().port;try{if(!this.local)this.advertiser=await discovery.advertise(()=>this.server?{id:this.store.data.id,name:this.store.data.settings.name,port:this.port}:null);this.discoveryError='';}catch{this.discoveryError='Discovery is unavailable on this computer. Members can still enter the displayed address and code.';}if(this.work.closing)this.quiesce();}catch(e){this.scalableEvents?.close();this.scalableEvents=null;this.telemetryEvents?.close();this.telemetryEvents=null;this.server=null;this.code='';throw e;}return this.status();
  }
  async stop(){if(this.starting)await this.starting.catch(()=>{});this.scalableEvents?.close();this.scalableEvents=null;this.telemetryEvents?.close();this.telemetryEvents=null;const s=this.server;this.server=null;this.code='';this.browseCode='';this.timingCode='';this.clubCode='';this.port=0;if(this.advertiser){this.advertiser.close();this.advertiser=null;}this.discoveryError='';if(s){s.closeAllConnections();await new Promise(resolve=>s.close(resolve));}return this.status();}
  async request(address,code,route,body,expectedDatabase,signal){
    if(this.work.closing)throw require('./work-gate.cjs').closingError();
    signal=signal?AbortSignal.any([signal,this.shutdownAbort.signal]):this.shutdownAbort.signal;
    const payload=body?require('./json-encoding.cjs').boundedStringify(body,MAX,'Package exceeds the 32 MB network limit. Use a file export.'):undefined;
    const response=await fetch(localAddress(address)+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+code,'Content-Type':'application/json','X-SlotForge-Pages':'1',...(expectedDatabase?{'X-SlotForge-Database':expectedDatabase}:{})},body:payload,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
    if(Number(response.headers.get('content-length'))>MAX){await response.body?.cancel();throw new Error('Response too large.');}
    if(!response.body)throw new Error('The host returned an empty response.');const reader=response.body.getReader();let size=0,chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();throw new Error('Response too large.');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    let result;try{result=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new Error('The host returned an invalid response.');}if(!response.ok){const error=new Error(result?.error||'Connection failed.');error.httpStatus=response.status;throw error;}return result;
  }
  async readCollection(address,code,generation,signal){
    const deadline=AbortSignal.timeout(this.transferTimeoutMs??60000);signal=signal?AbortSignal.any([signal,deadline]):deadline;
    address=localAddress(address);let route='/v1/collection',data=null,offset=0,totalBytes=0,permissions=null;const ids=new Set();
    while(true){
      const received=await this.request(address,code,route,undefined,undefined,signal);if(generation!==this.generation)throw new Error('Connection canceled.');
      if(received?.schema!==1||!Number.isSafeInteger(received.revision)||received.revision<0||!Array.isArray(received.cars)||received.cars.length>1000)throw new Error('Not a compatible SlotForge collection page.');
      const checked=validatePackage({format:'slotforge-car-package',version:1,packageId:crypto.randomUUID(),source:received.id,sender:received.settings?.name,created:new Date().toISOString(),cars:received.cars.length?received.cars:[{id:'empty-placeholder',name:'Empty'}]});
      if(!data){data=publicView(checked.source,received.revision,checked.sender,[]);permissions=received.permissions?this.checkedPermissions(received.permissions):{browse:true,submit:true};}
      if(data.id!==checked.source||data.revision!==received.revision||data.settings.name!==checked.sender)throw new Error('The shared collection changed during transfer. Refresh to try again.');
      for(const c of received.cars.length?checked.cars:[]){if(ids.has(c.id))throw new Error('Duplicate car identity in shared collection.');totalBytes+=Buffer.byteLength(JSON.stringify(c));if(totalBytes>200*1024*1024)throw new Error('The shared collection exceeds the 200 MB limit.');ids.add(c.id);data.cars.push(c);}
      if(data.cars.length>10000)throw new Error('The shared collection exceeds 10,000 cars.');
      if(received.nextOffset==null)break;
      if(!Number.isSafeInteger(received.nextOffset)||received.nextOffset<=offset||received.nextOffset!==data.cars.length)throw new Error('Invalid collection pagination.');
      offset=received.nextOffset;route='/v1/collection?offset='+offset+'&revision='+data.revision+'&database='+encodeURIComponent(data.id);
    }
    return {data,permissions};
  }
  checkedPermissions(p){if(!p||p.browse!==true||typeof p.submit!=='boolean')throw Error('Invalid host permissions.');return {browse:true,submit:p.submit};}
  async connect(address,code){
    address=localAddress(address);if(typeof code!=='string'||!code.trim()||code.length>200)throw Error('Enter the host connection code or password.');code=code.trim();
    this.readAbort.abort();this.readAbort=new AbortController();const generation=++this.generation,{data,permissions}=await this.readCollection(address,code,generation,this.readAbort.signal);
    if(generation!==this.generation)throw Error('Connection canceled.');
    this.remote={address,code,id:data.id,name:data.settings.name,state:'connected',lastSync:new Date().toISOString(),lastError:'',permissions,autoRefresh:true};this.cached=data;this.nextPoll=Date.now()+5000;this.failures=0;
    this.notify(data);return {data,status:this.status()};
  }
  async refresh(){
    if(!this.remote)throw Error('Connect to a database first.');if(this.remote.identityChanged)throw identityError();if(this.refreshing&&this.refreshGeneration===this.generation)return this.refreshing;
    const remote=this.remote,generation=this.generation;
    this.refreshGeneration=generation;const task=(async()=>{try{const {data,permissions}=await this.readCollection(remote.address,remote.code,generation,this.readAbort.signal);
      if(this.remote!==remote||generation!==this.generation)throw Error('Connection canceled.');if(data.id!==remote.id)throw identityError();
      Object.assign(remote,{name:data.settings.name,state:'connected',lastSync:new Date().toISOString(),lastError:'',permissions});this.cached=data;this.failures=0;this.nextPoll=Date.now()+5000;this.notify(data);return {data,status:this.status()};
    }catch(e){if(this.remote===remote&&generation===this.generation)this.failed(e);throw e;}finally{if(this.refreshing===task)this.refreshing=null;}})();this.refreshing=task;return task;
  }
  failed(e){if(!this.remote)return;this.remote.identityChanged=!!e.identityChanged;this.remote.state=e.identityChanged||e.httpStatus===401||e.httpStatus===403?'access-required':'offline';this.remote.lastError=e.httpStatus?e.message:'Unable to refresh the shared collection. Check Wi-Fi and that the host is still sharing. '+(e.message==='fetch failed'?'':e.message);this.nextPoll=Date.now()+Math.min(60000,5000*2**Math.min(++this.failures,4));this.notify();}
  autoRefresh(enabled){if(!this.remote)throw Error('Connect first.');if(typeof enabled!=='boolean')throw Error('Invalid refresh preference.');this.remote.autoRefresh=enabled;this.nextPoll=0;this.notify();return this.status();}
  async poll(){
    if(this.work.closing)return;
    if(!this.remote||!this.remote.autoRefresh||this.remote.state==='access-required'||this.refreshing&&this.refreshGeneration===this.generation||this.polling||Date.now()<this.nextPoll)return;
    const remote=this.remote,generation=this.generation;this.polling=true;
    try{
      let status;try{status=await this.request(remote.address,remote.code,'/v1/status',undefined,undefined,this.readAbort.signal);}catch(e){if(e.httpStatus===404){if(this.remote===remote&&generation===this.generation){try{await this.refresh();}catch{}}return;}throw e;}
      if(this.remote!==remote||generation!==this.generation)return;
      if(typeof status?.id!=='string'||!status.id)throw Error('Host status is missing its database identity. Reconnect to verify the host.');
      if(status.id!==remote.id)throw identityError();
      if(status?.protocol!==2||!Number.isSafeInteger(status.revision)||status.revision<0||typeof status.name!=='string'||status.name.length>200)throw Error('Host identity or status changed. Reconnect to verify the host.');
      const permissions=this.checkedPermissions(status.permissions);
      if(status.revision!==this.cached.revision||status.name!==this.cached.settings.name){try{await this.refresh();}catch{}return;}
      Object.assign(remote,{state:'connected',lastError:'',permissions,lastSync:new Date().toISOString()});this.failures=0;this.nextPoll=Date.now()+5000;this.notify();
    }catch(e){if(this.remote===remote&&generation===this.generation)this.failed(e);}finally{this.polling=false;}
  }
  disconnect(){this.readAbort.abort();this.readAbort=new AbortController();this.generation++;this.remote=null;this.cached=null;this.nextPoll=0;this.notify();return this.status();}
  async submit(ids,options){
    if(this.pending)throw Error('Resolve the previous submission first: retry it or discard its retry copy in Connections.');
    if(!this.remote)throw Error('Connect to a database first.');if(!this.remote.permissions.submit)throw Error('This connection is browse-only or submissions are paused.');
    if(this.remote.state!=='connected')throw Error('Reconnect before submitting cars.');
    const bundle=makePackage(this.store.snapshot(),ids,options);if(require('./json-encoding.cjs').byteLength(bundle)>MAX)throw Error('Package exceeds the 32 MB network limit. Use a file export.');
    this.pending={hostId:this.remote.id,name:this.remote.name,bundle};return this.retrySubmission();
  }
  async retrySubmission(){
    if(this.sending)throw Error('A submission is already being sent.');if(!this.pending||!this.remote||this.pending.hostId!==this.remote.id)throw Error('Connect to the original host to retry this submission.');
    if(this.remote.identityChanged)throw identityError();
    if(!this.remote.permissions.submit)throw Error('The current connection cannot submit. Use a submission code or ask the host to resume submissions.');
    const pending=this.pending,remote=this.remote;this.sending=true;
    try{const result=await this.request(remote.address,remote.code,'/v1/submissions',pending.bundle,remote.id);if(result?.ok!==true||typeof result.duplicate!=='boolean')throw Error('The host did not acknowledge the submission.');if(this.pending===pending)this.pending=null;this.notify();return result;}
    catch(e){this.notify();throw Error(e.message+' The retry copy is retained in Connections. Retry sends the same package, so the host can recognise an already received submission.');}finally{this.sending=false;}
  }
  discardSubmission(){if(this.sending)throw Error('Wait for the current submission to finish.');this.pending=null;this.notify();return this.status();}
  quiesce(){this.work.stop();this.shutdownAbort.abort();this.readAbort.abort();if(this.advertiser){this.advertiser.close();this.advertiser=null;}this.scalableEvents?.close();this.telemetryEvents?.close();}
  async idle(){await Promise.allSettled([this.starting,this.refreshing]);await this.work.idle();}
  close(){this.scalableEvents?.close();this.scalableEvents=null;this.telemetryEvents?.close();this.telemetryEvents=null;this.disconnect();if(this.advertiser){this.advertiser.close();this.advertiser=null;}this.server?.closeAllConnections();this.server?.close();}
}
module.exports={Network,localAddress};
