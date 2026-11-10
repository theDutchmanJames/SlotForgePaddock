'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {Store}=require('../../src/store.cjs'),T=require('../../src/timing-integration.cjs'),Q=require('../../src/sqlite-query.cjs');
const profile=path.resolve(process.argv[3]||'');if(!path.basename(profile).startsWith('sf-local-qualify-')||path.dirname(profile)!==path.resolve(__dirname,'..','..','.qa'))throw Error('Use a generated QA profile.');let file=path.join(profile,'database.sqlite');
function png(){
 const crc=b=>{let c=0xffffffff;for(const n of b){c^=n;for(let j=0;j<8;j++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
 const chunk=(type,bytes)=>{const head=Buffer.alloc(4),end=Buffer.alloc(4),body=Buffer.concat([Buffer.from(type),bytes]);head.writeUInt32BE(bytes.length);end.writeUInt32BE(crc(body));return Buffer.concat([head,body,end]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(256,0);header.writeUInt32BE(256,4);header[8]=8;header[9]=2;const raw=crypto.randomBytes(256*(256*3+1));for(let y=0;y<256;y++)raw[y*(256*3+1)]=0;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw,{level:0})),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
async function seed(){
 const f=require('./timing-fixtures.cjs').fixtures(),data=f.store.snapshot(),template=data.cars[0];
 for(let i=2;i<500;i++)data.cars.push({...structuredClone(template),id:'large-'+i,name:'Qualification car '+String(i).padStart(3,'0'),maker:['NSR','Slot.it','Scaleauto'][i%3]});
 const p=structuredClone(f.normal);p.heats[0].endedAtMs=100000;p.endedAt=new Date(Date.parse(p.startedAt)+100000).toISOString();p.participants[0].stints[0].endedAtMs=100000;const lap=p.participants[0].laps[0];p.participants[0].laps=Array.from({length:100},(_,i)=>({...lap,id:'lap-'+i,number:i+1,durationMs:1000,endedAtMs:(i+1)*1000}));p.standings[0].classifiedLaps=100;p.standings[0].classifiedElapsedMs=100000;T.receive(f.store,p);const base=f.store.data.timing.sessions[0];
 data.timing.sessions=Array.from({length:1000},(_,i)=>{const r=structuredClone(base);r.payload.sessionId='large-session-'+i;r.payload.name='Qualification race '+i;r.lastName=r.payload.name;r.contentHash=T.digest(r.payload);return r;});
 const source=new Store();source.replace({...data,timing:{...data.timing,sessions:[]}});
 // Historical reviewed transfers stress receipt/origin lookup and Review,
 // without installing test cars or modifying any real user collection.
 const local=require('../../src/local-library-api.cjs');for(let i=0;i<250;i++)local.receive(source,{version:1,databaseId:data.id,sourceId:'large-source',transferId:'large-transfer-'+i,export:{format:'slotforge-timing-export',fileVersion:1,items:{slotcars:[{id:'source-car-'+i,name:'Pending car '+i}]}}});
 source.data.timing.sessions=data.timing.sessions;for(const c of source.data.cars)c.picture=png();
 const store=new Store(file);store.replace(source.data);fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify({...f.normal,databaseId:data.id}));
 return {cars:500,photos:500,sessions:1000,laps:100000,pendingTransfers:250,sqliteMiB:+(fs.statSync(file).size/1048576).toFixed(2),scope:'Unique valid synthetic PNGs, fictional cars and sessions; fresh measurement process after seeding.'};
}
async function measure(){
 const copy=path.join(profile,'measurement-'+crypto.randomUUID()+'.sqlite');fs.copyFileSync(file,copy);file=copy;
 const timings={},lazy=require('../../src/lazy-assets.cjs'),{RendererMedia}=require('../../src/renderer-media.cjs'),media=new RendererMedia(),view=require('../../src/view-query.cjs'),results={};let last=performance.now(),maxGap=0,ticks=0;
 const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;ticks++;},5),timed=async(name,fn)=>{const start=performance.now(),value=await fn();timings[name]=+(performance.now()-start).toFixed(2);await new Promise(r=>setTimeout(r,10));return value;};let service,inbox;
 try{
  const store=await timed('openMs',()=>Store.open(file));inbox=new (require('../../src/result-inbox.cjs').ResultInbox)(profile);store.resultInbox=inbox;
  const overview=await timed('overviewMs',()=>view.view(store,{page:'Overview'}));results.overviewBytes=Buffer.byteLength(JSON.stringify(media.project(overview)));results.startupLoading=structuredClone(store.deferredState.stats);assert.equal(lazy.stats().reads,0);
  await timed('carsPageMs',()=>view.view(store,{page:'Cars'}));await timed('reviewPageMs',()=>view.view(store,{page:'Review',reviewTab:'Incoming cars'}));await timed('raceNoticePageMs',()=>view.view(store,{page:'Review',reviewTab:'Race results'}));await timed('performancePageMs',()=>view.view(store,{page:'Cars',carId:'car-a',section:'Performance'}));
  service=new (require('../../src/local-library.cjs').LocalLibrary)({store,profile,folder:path.join(profile,'discovery')});await timed('discoveryMs',()=>service.start());assert.equal(service.status().available,true);
  const request=async(route,body)=>{const r=await fetch('http://127.0.0.1:'+service.network.port+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+service.token,'X-SlotForge-Instance':service.instanceId,'X-SlotForge-Database':store.data.id,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;};
  const cars=await timed('cataloguePageMs',()=>request('/v1/scalable/cars'));results.catalogueBytes=Buffer.byteLength(JSON.stringify(cars));assert.ok(cars.cars.length<=100);
  const receipt=await timed('transferReceiptMs',()=>request('/v1/local-library/imports/large-source/large-transfer-0'));assert.equal(receipt.cars[0].status,'pending');
  await timed('originLookupMs',()=>request('/v1/local-library/origins/large-source?timingCarId=source-car-0'));
  await timed('resultDeliveryMs',()=>request('/v1/timing/sessions',JSON.parse(fs.readFileSync(path.join(profile,'result.json')))));
  const car=Q.read(store,null,r=>r.one('cars','large-2')).value;
  await timed('carEditMs',()=>store.mutateAsync('car.save',{id:car.id,revision:car.revision,data:{livery:'Qualification edit'}},{snapshot:false,commandId:crypto.randomUUID()}));
  await timed('approvalMs',()=>store.mutateAsync('submission.review',{id:receipt.submissionId,carId:receipt.cars[0].paddockCarId,decision:'accept',revision:0,fields:['name']},{snapshot:false,commandId:crypto.randomUUID()}));
  const schema=await request('/v1/local-library/car-schema');const shared={version:1,databaseId:store.data.id,recoveryId:schema.recoveryId,sourceId:'large-timing',operationId:'large-create',action:'create',set:{name:'Shared qualification car'}};const made=await timed('sharedCreateMs',()=>request('/v1/local-library/car-operations',shared));await timed('sharedPatchMs',()=>request('/v1/local-library/car-operations',{...shared,operationId:'large-patch',action:'patch',carId:made.car.id,expectedRevision:made.car.revision,set:{weight:81.5}}));assert.equal((await request('/v1/local-library/car-operations',shared)).duplicate,true);
  results.photoReads=lazy.stats().reads;assert.equal(results.photoReads,0);assert.ok(store.deferredState);results.peakRssMiB=+(process.resourceUsage().maxRSS/1024).toFixed(2);results.maxTimerGapMs=+maxGap.toFixed(2);results.timerTicks=ticks;
  return {...results,timings,scope:'Fresh Node host process, warm OS cache; local HTTP and backend/IPC projections, not renderer paint or physical LAN.'};
 }finally{clearInterval(timer);service?.quiesce();await service?.idle();service?.close();inbox?.close();}
}
(process.argv[2]==='--seed'?seed():measure()).then(value=>console.log(JSON.stringify(value))).catch(e=>{console.error(e.stack);process.exitCode=1;});
