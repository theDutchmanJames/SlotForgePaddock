'use strict';
const http=require('node:http'),os=require('node:os'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {WorkGate}=require('./work-gate.cjs'),{fault,fields}=require('./portal-store.cjs');
const MAX_BODY=12*1024*1024+4096,MAX_PHOTOS_BODY=60*1024*1024+8192;
function privateIP(ip){const parts=String(ip).replace(/^::ffff:/,'').split('.').map(Number);return parts.length===4&&parts.every(n=>Number.isInteger(n)&&n>=0&&n<256)&&(parts[0]===127||parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<32||parts[0]===169&&parts[1]===254);}
function addresses(){return [...new Set(Object.values(os.networkInterfaces()).flat().filter(i=>i.family==='IPv4'&&!i.internal&&privateIP(i.address)).map(i=>i.address))];}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
const staticFiles={'/':['index.html','text/html; charset=utf-8'],'/portal.js':['portal.js','text/javascript; charset=utf-8'],'/existing.js':['existing.js','text/javascript; charset=utf-8'],'/portal.css':['portal.css','text/css; charset=utf-8'],'/icon.png':['../icon.png','image/png']};
class PaddockPortal{
 constructor({getStore,available=()=>true,validatePhoto,makeThumbnail=()=>null,onStatus=()=>{},onChange=()=>{},interfaces=addresses,host='0.0.0.0'}){Object.assign(this,{getStore,available,validatePhoto,makeThumbnail,onStatus,onChange,interfaces,host});this.active=null;this.starting=null;this.stopping=null;this.reason='';}
 status(){const s=this.active;return {enabled:!!s,available:this.available(),reason:this.reason,...(s?{collectionName:s.name,databaseId:s.databaseId,code:s.code,port:s.port,addresses:s.links||[]}:{})};}
 notify(){try{this.onStatus();}catch{}}
 guard(s){
  const stopped=()=>fault('PORTAL_STOPPED','Paddock Portal is off or the collection changed. Enable it again on the computer.',409);
  if(this.active!==s||this.getStore()!==s.store)throw stopped();
  const validate=store=>{if(!this.available(store))throw stopped();require('./portal-store.cjs').identity(store,s);};
  try{validate(s.store);}catch(error){
   if(error.code!=='QUERY_CHANGED')throw error;
   // Validate all the same protections against a fresh read-only generation.
   // The worker independently refreshes and revalidates before any write.
   validate(new (require('./store.cjs').Store)(s.store.file,{deferred:true}));
  }
 }
 async start(){
  if(this.stopping)await this.stopping;if(this.active)return this.status();if(this.starting)return this.starting;
  this.starting=this.open();try{return await this.starting;}finally{this.starting=null;}
 }
 async open(){
  if(!this.available())throw Error('Open your local collection to enable Paddock Portal.');const store=this.getStore();
  const token=await store.withIdle(()=>require('./sqlite-storage.cjs').syncState(store.file));
  if(!this.available()||this.getStore()!==store)throw Error('The collection changed. Enable Paddock Portal again.');
  const s={store,databaseId:store.data.id,recoveryId:token.epoch,name:store.data.settings.name,code:String(crypto.randomInt(100000,1000000)),join:crypto.randomBytes(24).toString('hex'),sessions:new Map(),attempts:new Map(),globalAttempts:[],work:new WorkGate(),reading:new Set(),uploads:0,photoUpload:false,thumbnails:0,thumbCache:new Map(),addresses:this.interfaces(),port:0};
  this.reason='';s.server=http.createServer((req,res)=>{void s.work.run(()=>this.handle(s,req,res)).catch(()=>{if(!res.destroyed)res.destroy();});});
  s.server.requestTimeout=30000;s.server.headersTimeout=10000;s.server.keepAliveTimeout=3000;s.server.maxConnections=32;
  try{await new Promise((resolve,reject)=>{s.server.once('error',reject);s.server.listen(0,this.host,resolve);});if(!this.available()||this.getStore()!==store)throw Error('The collection changed while starting the Portal.');s.port=s.server.address().port;this.active=s;
   s.links=s.addresses.map(ip=>{const url=`http://${ip}:${s.port}/`;return {url,qr:require('./reports.cjs').qr(url+'#join='+s.join).replace('Open car in Paddock','Open Paddock Portal')};});
   s.server.on('error',()=>{void this.stop('The Portal listener stopped. Enable it again.');});
   s.timer=setInterval(()=>{try{this.guard(s);}catch{void this.stop('The collection changed; Paddock Portal was turned off.');}},1000);s.timer.unref();this.notify();return this.status();
  }catch(e){if(this.active===s)this.active=null;clearInterval(s.timer);s.server.close();throw e;}
 }
 async stop(reason=''){
  if(this.starting)await this.starting.catch(()=>{});if(this.stopping)return this.stopping;
  const s=this.active;this.active=null;this.reason=reason;this.notify();if(!s)return;
  this.stopping=(async()=>{clearInterval(s.timer);s.work.stop();s.sessions.clear();for(const req of s.reading)req.destroy();const closed=new Promise(resolve=>s.server.close(resolve));s.server.closeIdleConnections();await s.work.idle();s.server.closeAllConnections();await closed;})();
  try{await this.stopping;}finally{this.stopping=null;}
 }
 async body(s,req,limit){
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw fault('INVALID_CONTENT_TYPE','Send JSON data.',415);
  if(req.headers['content-encoding']||Number(req.headers['content-length'])>limit)throw fault('UPLOAD_TOO_LARGE','Upload is too large. Choose a smaller photo.',413);
  s.reading.add(req);const timer=setTimeout(()=>req.destroy(),30000);timer.unref();
  try{let size=0;const chunks=[];for await(const chunk of req.iterator({destroyOnReturn:false})){size+=chunk.length;if(size>limit)throw fault('UPLOAD_TOO_LARGE','Upload is too large. Choose a smaller photo.',413);chunks.push(chunk);}this.guard(s);try{return require('./strict-json.cjs').parse(Buffer.concat(chunks));}catch{throw fault('INVALID_JSON','The upload could not be read. Retry it.');}}
  finally{clearTimeout(timer);s.reading.delete(req);}
 }
 authenticate(s,req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const until=s.sessions.get(token);if(!until||until<Date.now()){s.sessions.delete(token);throw fault('ACCESS_REQUIRED','Enter the code shown in Paddock or scan its QR code.',401);}}
 async handle(s,req,res){
  const send=(status,value,type='application/json; charset=utf-8')=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",...(status>=400?{Connection:'close'}:{})});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
  try{
   this.guard(s);const host=req.headers.host,allowed=['127.0.0.1',...s.addresses].map(ip=>ip+':'+s.port);
   if(!privateIP(req.socket.remoteAddress)||!allowed.includes(host))throw fault('INVALID_HOST','Use the local address displayed in Paddock.',403);
   const origin='http://'+host;
   if(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==origin||req.method==='POST'&&req.headers.origin!==origin)throw fault('INVALID_ORIGIN','Open Paddock Portal directly from its QR code or local address.',403);
   const url=new URL(req.url,origin);if(url.search)throw fault('INVALID_ROUTE','Unknown Portal address.',404);
   if(req.method==='GET'&&Object.hasOwn(staticFiles,url.pathname)){const [file,type]=staticFiles[url.pathname];return send(200,fs.readFileSync(path.join(__dirname,'..','assets','portal',file)),type);}
   if(req.method==='POST'&&url.pathname==='/api/session'){
    const now=Date.now(),ip=req.socket.remoteAddress;s.globalAttempts=s.globalAttempts.filter(t=>now-t<60000);for(const [key,tries]of s.attempts)if(now-(tries.at(-1)||0)>60000)s.attempts.delete(key);
    const tries=(s.attempts.get(ip)||[]).filter(t=>now-t<60000);if(tries.length>=8||s.globalAttempts.length>=60)throw fault('TOO_MANY_ATTEMPTS','Too many attempts. Wait a minute and try again.',429);
    tries.push(now);s.attempts.set(ip,tries);s.globalAttempts.push(now);const input=await this.body(s,req,1024);
    if(!equal(input?.code,s.code)&&!equal(input?.token,s.join))throw fault('ACCESS_REQUIRED','That access code is not correct. Check Paddock.',401);
    for(const [token,until]of s.sessions)if(until<now)s.sessions.delete(token);if(s.sessions.size>=64)throw fault('PORTAL_BUSY','Too many connected devices. Turn the Portal off and on to reconnect.',429);
    const token=crypto.randomBytes(32).toString('hex');s.sessions.set(token,now+8*3600000);return send(200,{token,databaseId:s.databaseId,recoveryId:s.recoveryId,collectionName:s.name});
   }
   this.authenticate(s,req);
   if(req.method==='GET'&&url.pathname==='/api/info')return send(200,{databaseId:s.databaseId,recoveryId:s.recoveryId,collectionName:s.name});
   if(req.method==='GET'&&/^\/api\/receipts\/[a-f0-9-]{36}$/.test(url.pathname))return send(200,await require('./domain-tasks.cjs').run(s.store,{kind:'portal-receipt',id:url.pathname.split('/').pop(),expected:{databaseId:s.databaseId,recoveryId:s.recoveryId}},()=>this.guard(s)));
   if(req.method==='POST'&&['/api/car-list','/api/thumbnail'].includes(url.pathname)){
    const input=await this.body(s,req,4096);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!(url.pathname==='/api/car-list'?['offset','query','revision']:['carId','revision']).includes(k)))throw fault('INVALID_QUERY','Invalid car selection.');
    const expected={databaseId:s.databaseId,recoveryId:s.recoveryId},run=input=>require('./domain-tasks.cjs').run(s.store,{kind:'portal-read',input,expected},()=>this.guard(s));
    if(url.pathname==='/api/car-list')return send(200,await run({...input,kind:'list'}));
    if(s.thumbnails>=2)throw fault('PORTAL_BUSY','Retry the thumbnail shortly.',503);s.thumbnails++;
    try{const key=JSON.stringify(input);let thumbnail=s.thumbCache.get(key);
     if(thumbnail===undefined){const value=await run({...input,kind:'thumbnail'});thumbnail=await this.makeThumbnail(value.picture);this.guard(s);if(s.thumbCache.size>=24)s.thumbCache.delete(s.thumbCache.keys().next().value);s.thumbCache.set(key,thumbnail);}
     return send(200,{thumbnail});
    }finally{s.thumbnails--;}
   }
   if(req.method==='POST'&&url.pathname==='/api/photos'){
    if(s.uploads)throw fault('PORTAL_BUSY','Another upload is in progress. Retry shortly.',503);s.uploads++;s.photoUpload=true;
    try{const input=await this.body(s,req,MAX_PHOTOS_BODY),P=require('./portal-store.cjs');P.batch(input);for(const photo of input.photos)await this.validatePhoto(P.photo(photo.data));this.guard(s);
     const result=await require('./domain-tasks.cjs').run(s.store,{kind:'portal-photos',input,expected:{databaseId:s.databaseId,recoveryId:s.recoveryId}},()=>this.guard(s));
     s.thumbCache.clear();try{this.onChange({kind:'portal-car',carId:result.carId});}catch{}return send(200,{saved:true,...result,databaseId:s.databaseId,collectionName:s.name});
    }finally{s.uploads--;s.photoUpload=false;}
   }
   if(req.method==='POST'&&url.pathname==='/api/cars'){
    if(s.photoUpload||s.uploads>=2)throw fault('PORTAL_BUSY','Two photos are already uploading. Retry shortly.',503);s.uploads++;
    try{const input=await this.body(s,req,MAX_BODY),photo=fields(input);await this.validatePhoto(photo.bytes);this.guard(s);
     const result=await require('./domain-tasks.cjs').run(s.store,{kind:'portal-create',input,expected:{databaseId:s.databaseId,recoveryId:s.recoveryId}},()=>this.guard(s));
     try{this.onChange({kind:'portal-car',carId:result.carId});}catch{}return send(200,{saved:true,...result,databaseId:s.databaseId,collectionName:s.name});
    }finally{s.uploads--;}
   }
   throw fault('INVALID_ROUTE','Unknown Portal action.',404);
  }catch(e){const known=['COMMAND_CONFLICT','COMMAND_EPOCH_CHANGED','QUERY_CHANGED','WRITE_UNCERTAIN','WORKER_BUSY'];send(e.httpStatus||(known.includes(e.code)?409:500),{code:e.code||'UPLOAD_FAILED',error:e.httpStatus?e.message:e.code==='COMMAND_CONFLICT'?'This upload was already saved with different details. Check Paddock before adding another car.':'Paddock could not confirm the save. Keep this page open and retry; the same upload will not create another car.'});req.resume();}
 }
}
module.exports={PaddockPortal,privateIP,MAX_BODY,MAX_PHOTOS_BODY};
