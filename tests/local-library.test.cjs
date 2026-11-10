'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,initial}=require('../src/store.cjs'),{LocalLibrary,directory}=require('../src/local-library.cjs');
const api=require('../src/local-library-api.cjs');
async function fixture(t,data){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-local-')),file=path.join(root,'database.json');
 const store=new Store(file);if(data)store.data=data;store.persist(store.data);
 const options={store,folder:path.join(root,'discovery'),profile:root};let service=new LocalLibrary(options);await service.start();assert.equal(service.error,'');
 t.after(async()=>{service.quiesce();await service.idle();service.close();fs.rmSync(root,{recursive:true,force:true});});
 return {root,store,get service(){return service;},async restart(){service.quiesce();await service.idle();service.close();const reopened=new Store(file,{deferred:true});service=new LocalLibrary({...options,store:reopened});await service.start();return reopened;}};
}
async function request(f,route,{method='GET',body,headers={}}={}){
 const response=await fetch('http://127.0.0.1:'+f.service.network.port+route,{method,headers:{Authorization:'Bearer '+f.service.token,'X-SlotForge-Instance':f.service.instanceId,'X-SlotForge-Database':f.service.store.data.id,'Content-Type':'application/json',...headers},body:body===undefined?undefined:typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 return {status:response.status,value:await response.json()};
}
function transfer(db,extra={}){return {version:1,databaseId:db.id,sourceId:'timing-home',transferId:'transfer-1',export:{format:'slotforge-timing-export',fileVersion:1,exported:'2026-11-09T12:00:00.000Z',items:{slotcars:[{id:'timing-car-a',name:'Test GT3',brand:'NSR',gearing:'9/27',tyres:'Rear tyres'}]}},...extra};}
const post=(f,body)=>request(f,'/v1/local-library/imports',{method:'POST',body});
const receipt=f=>request(f,'/v1/local-library/imports/timing-home/transfer-1');

test('receipt and origin queries read only the matching package and linked car',async t=>{
 const f=await fixture(t);const input=transfer(f.store.data);await post(f,input);
 const store=new Store(f.store.file,{deferred:true}),state=store.deferredState;
 const before=state.stats.recordReads;const r=api.lookup(store,input.sourceId,input.transferId);assert.equal(r.cars[0].status,'pending');
 assert.ok(state.stats.recordReads-before<=2);assert.equal(state.stats.loadedSections.includes('cars'),false);assert.equal(state.stats.loadedSections.includes('submissions'),false);
 const origin=api.originReceipt(store,input.sourceId,'timing-car-a');assert.equal(origin.transferId,input.transferId);assert.equal(state.stats.loadedSections.includes('submissions'),false);
});
test('a saturated host gives a retry hint without pretending the request was committed',async t=>{
 const f=await fixture(t);f.store.domainPending=16;
 try{const response=await fetch('http://127.0.0.1:'+f.service.network.port+'/v1/local-library/imports',{method:'POST',headers:{Authorization:'Bearer '+f.service.token,'X-SlotForge-Instance':f.service.instanceId,'X-SlotForge-Database':f.store.data.id,'Content-Type':'application/json'},body:JSON.stringify(transfer(f.store.data))});
 assert.equal(response.status,503);assert.equal(response.headers.get('retry-after'),'1');const body=await response.json();assert.equal(body.code,'STORAGE_FAILED');assert.match(body.error,/queued and retry/);assert.equal(f.store.data.submissions.length,0);
 }finally{f.store.domainPending=0;}
 assert.equal((await post(f,transfer(f.store.data))).status,200);
});
test('replacement during a partially uploaded import cannot retarget it',async t=>{
 const f=await fixture(t),http=require('node:http'),bytes=Buffer.from(JSON.stringify(transfer(f.store.data))),before=f.store.data.id;
 const result=new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:f.service.network.port,path:'/v1/local-library/imports',method:'POST',headers:{Authorization:'Bearer '+f.service.token,'X-SlotForge-Instance':f.service.instanceId,'X-SlotForge-Database':before,'Content-Type':'application/json','Content-Length':bytes.length}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(Buffer.concat(chunks))}));});req.on('error',reject);req.write(bytes.subarray(0,8));
 setTimeout(async()=>{try{await f.store.restoreAsync(initial(),f.store.data.revision);req.end(bytes.subarray(8));}catch(e){req.destroy();reject(e);}},50);
 });
 const response=await result;assert.equal(response.status,409);assert.equal(response.value.code,'DATABASE_MISMATCH');assert.equal(f.store.data.submissions.length,0);assert.notEqual(f.store.data.id,before);
});

test('wake and retry republish discovery without changing healthy credentials; disabled stays disabled',async t=>{
 const f=await fixture(t),service=f.service,token=service.token,instance=service.instanceId,port=service.network.port;
 service.suspend();assert.equal(service.status().state,'sleeping');assert.equal((await request(f,'/v1/status')).value.code,'LOCAL_UNAVAILABLE');fs.unlinkSync(service.file);await service.recover();
 assert.equal(service.status().state,'ready');assert.equal(service.token,token);assert.equal(service.instanceId,instance);assert.equal(service.network.port,port);assert.equal(JSON.parse(fs.readFileSync(service.file)).token,token);
 assert.equal((await request(f,'/v1/status')).status,200);await service.setEnabled(false);await service.recover();assert.equal(service.status().state,'disabled');assert.equal(fs.existsSync(service.file),false);
});
test('a discovery error blocks local access until recovery succeeds',async t=>{
 const f=await fixture(t);f.service.error='Discovery could not be updated';
 assert.equal(f.service.status().available,false);assert.equal((await request(f,'/v1/status')).status,503);
 await f.service.recover();assert.equal(f.service.status().available,true);assert.equal((await request(f,'/v1/status')).status,200);
});
test('a stopped listener is recovered with a new credential and shutdown waits for recovery',async t=>{
 const f=await fixture(t),service=f.service,token=service.token;await service.network.stop();await service.recover();assert.equal(service.status().available,true);assert.notEqual(service.token,token);
 const recovering=service.recover();service.quiesce();await service.idle();await recovering;assert.equal(fs.existsSync(service.file),false);assert.equal(service.status().available,false);
});
test('local discovery is private, loopback-only and independent of LAN credentials',async t=>{
 const f=await fixture(t),n=f.service.network,entry=JSON.parse(fs.readFileSync(f.service.file));
 assert.equal(n.server.address().address,'127.0.0.1');assert.equal(n.advertiser,null);assert.equal(n.code,'');assert.equal(n.timingCode,'');
 assert.equal(entry.format,'slotforge-local-library');assert.equal(entry.databaseId,f.store.data.id);assert.equal(entry.address,'http://127.0.0.1:'+n.port);assert.equal(entry.token,f.service.token);assert.equal(entry.token.length,43);
 assert.equal(directory({platform:'win32',env:{LOCALAPPDATA:'base'}}),path.join('base','SlotForge','local-libraries','v1'));
 if(process.platform!=='win32'){assert.equal(fs.statSync(f.service.file).mode&0o777,0o600);assert.equal(fs.statSync(f.service.folder).mode&0o777,0o700);}
 const status=await request(f,'/v1/status',{headers:{'X-SlotForge-Extensions':'scalable-v1'}});assert.equal(status.status,200);assert.equal(status.value.localInstanceId,entry.instanceId);assert.equal(status.value.capabilities.localLibrary.version,1);assert.equal(status.value.capabilities.scalable.version,1);assert.equal(status.value.permissions.timingResults,true);assert.equal(status.value.permissions.submit,false);assert.equal(JSON.stringify(status.value).includes(entry.token),false);
 assert.equal((await request(f,'/v1/status',{headers:{Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await request(f,'/v1/status',{headers:{Origin:'null'}})).value.code,'BROWSER_ORIGIN_FORBIDDEN');
 assert.equal((await request(f,'/v1/status',{headers:{'X-SlotForge-Instance':'old-instance'}})).value.code,'INSTANCE_CHANGED');
 assert.equal((await request(f,'/v1/collection',{headers:{'X-SlotForge-Database':''}})).value.code,'DATABASE_REQUIRED');
 assert.equal((await request(f,'/v1/collection',{headers:{'X-SlotForge-Database':'other'}})).value.code,'DATABASE_MISMATCH');
 assert.equal((await request(f,'/v1/submissions',{method:'POST',body:{}})).value.code,'LOCAL_ROUTE_FORBIDDEN');
 assert.equal((await request(f,'/v1/club/status')).value.code,'LOCAL_ROUTE_FORBIDDEN');
});
test('bootstrap import waits for review; retries and accepted links survive restart',async t=>{
 const f=await fixture(t),input=transfer(f.store.data),r=await post(f,input);assert.equal(r.status,200);assert.equal(r.value.duplicate,false);assert.equal(r.value.cars[0].decision,'pending');assert.equal(f.store.data.cars.length,0);
 const sub=f.store.data.submissions[0],incoming=sub.package.cars[0];
 await f.store.mutateAsync('submission.review',{id:sub.id,carId:incoming.id,decision:'accept',revision:0,fields:['name','maker','technical'],note:''},{snapshot:false});
 assert.equal(f.store.data.cars[0].technical.frontTyres,undefined);assert.equal(f.store.data.cars[0].technical.rearTyres,'Rear tyres');
 const oldToken=f.service.token;await f.restart();assert.notEqual(f.service.token,oldToken);
 const again=await post(f,input);assert.equal(again.status,200);assert.equal(again.value.duplicate,true);assert.equal(again.value.cars[0].decision,'accept');assert.equal(again.value.cars[0].present,true);assert.equal(again.value.cars[0].paddockCarId,incoming.id);
 assert.equal((await receipt(f)).value.status,'reviewed');assert.equal(f.service.store.data.submissions.length,1);
 assert.equal((await request(f,'/v1/status',{headers:{Authorization:'Bearer '+oldToken}})).status,401);
});
test('conflicting transfers, malformed JSON, unsupported encodings and oversized bodies are rejected',async t=>{
 const f=await fixture(t),input=transfer(f.store.data);await post(f,input);input.export.items.slotcars[0].name='Changed';assert.equal((await post(f,input)).value.code,'IMPORT_CONFLICT');
 assert.equal((await post(f,'{')).value.code,'INVALID_JSON');assert.equal((await post(f,Buffer.from([0xff]))).value.code,'INVALID_JSON');
 assert.equal((await request(f,'/v1/local-library/imports',{method:'POST',body:input,headers:{'Content-Encoding':'gzip'}})).status,415);
 assert.equal((await request(f,'/v1/local-library/imports',{method:'POST',body:'{}',headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal((await post(f,' '.repeat(api.MAX+1))).status,413);
 assert.equal((await post(f,transfer(f.store.data,{databaseId:'wrong'}))).value.code,'DATABASE_MISMATCH');
 assert.equal((await post(f,transfer(f.store.data,{unexpected:true}))).value.code,'INVALID_IMPORT');
 assert.equal((await post(f,transfer(f.store.data,{transferId:'null-targets',targets:null}))).value.code,'INVALID_IMPORT');
 const badPicture=transfer(f.store.data,{transferId:'invalid-picture'});badPicture.export.items.slotcars[0].picture=0;assert.equal((await post(f,badPicture)).value.code,'INVALID_IMPORT');
 assert.equal((await request(f,'/v1/local-library/origins/timing-home?timingCarId=a&timingCarId=b')).value.code,'INVALID_QUERY');
 assert.equal((await request(f,'/v1/local-library/imports/timing-home/not-received')).value.code,'IMPORT_NOT_FOUND');
 assert.equal(f.store.data.submissions.length,1);
});
test('simultaneous retries create one durable inbox entry',async t=>{
 const f=await fixture(t),input=transfer(f.store.data),responses=await Promise.all(Array.from({length:4},()=>post(f,input)));
 assert.deepEqual(responses.map(r=>r.status),[200,200,200,200]);assert.equal(responses.filter(r=>!r.value.duplicate).length,1);assert.equal(new Set(responses.map(r=>r.value.submissionId)).size,1);assert.equal(f.store.data.submissions.length,1);
});
test('explicit existing-car matches are reviewed and never replace unselected fields',async t=>{
 const f=await fixture(t),target=(await f.store.mutateAsync('car.save',{data:{name:'My existing car',owner:'Private owner',technical:{motor:'Existing'}}},{snapshot:false})).result;
 const input=transfer(f.store.data,{targets:[{timingCarId:'timing-car-a',paddockCarId:target,expectedRevision:f.store.data.cars[0].revision}]});assert.equal((await post(f,input)).value.cars[0].paddockCarId,target);
 assert.equal(f.store.data.cars[0].name,'My existing car');const sub=f.store.data.submissions[0];await f.store.mutateAsync('submission.review',{id:sub.id,carId:target,decision:'accept',revision:f.store.data.cars[0].revision,fields:['maker'],note:''},{snapshot:false});
 const car=f.store.data.cars[0];assert.equal(car.name,'My existing car');assert.equal(car.owner,'Private owner');assert.equal(car.technical.motor,'Existing');assert.equal(car.maker,undefined);assert.equal(f.store.data.cars.length,1);
 const bad=transfer(f.store.data,{transferId:'missing',targets:[{timingCarId:'timing-car-a',paddockCarId:'missing',expectedRevision:1}]});assert.equal((await post(f,bad)).status,409);
});
test('identical model names never silently merge; source identities scope imported cars',async t=>{
 const f=await fixture(t),a=await post(f,transfer(f.store.data)),b=await post(f,transfer(f.store.data,{sourceId:'other-installation'}));assert.notEqual(a.value.cars[0].paddockCarId,b.value.cars[0].paddockCarId);
 const sub=f.store.data.submissions[0];await f.store.mutateAsync('submission.review',{id:sub.id,carId:sub.package.cars[0].id,decision:'reject',note:''},{snapshot:false});
 const r=await request(f,'/v1/local-library/imports/other-installation/transfer-1');assert.equal(r.value.cars[0].decision,'reject');assert.equal(r.value.cars[0].present,false);
});
test('availability guards pause local access without stopping existing LAN hosting',async t=>{
 const f=await fixture(t),{Network}=require('../src/network.cjs'),lan=new Network(f.store);t.after(()=>lan.stop());await lan.start();
 f.service.network.local.available=()=>false;assert.equal((await request(f,'/v1/status')).status,503);
 const response=await fetch('http://127.0.0.1:'+lan.port+'/v1/status',{headers:{Authorization:'Bearer '+lan.timingCode}});const status=await response.json();assert.equal(response.status,200);assert.equal(status.permissions.timingResults,true);assert.equal(status.capabilities.localLibrary,undefined);
});
test('renames update discovery; reset invalidates old identities and transfer receipts',async t=>{
 const f=await fixture(t),old=f.store.data.id;await post(f,transfer(f.store.data));await f.store.mutateAsync('settings.save',{name:'Renamed library'},{snapshot:false});assert.equal(JSON.parse(fs.readFileSync(f.service.file)).name,'Renamed library');
 await f.store.restoreAsync(initial(),f.store.data.revision,()=>{});assert.notEqual(f.store.data.id,old);assert.equal(JSON.parse(fs.readFileSync(f.service.file)).databaseId,f.store.data.id);
 assert.equal((await request(f,'/v1/scalable/cars',{headers:{'X-SlotForge-Database':old}})).value.code,'DATABASE_MISMATCH');assert.equal((await receipt(f)).value.code,'IMPORT_NOT_FOUND');
});
test('existing Timing results, corrections, withdrawals and Telemetry work through local transport',async t=>{
 const fixtureData=require('./support/timing-fixtures.cjs').fixtures(),f=await fixture(t,fixtureData.store.data);
 const profile=await request(f,'/v1/timing/cars/car-a');assert.equal(profile.status,200);assert.equal(profile.value.configuration.carId,'car-a');
 for(const body of [fixtureData.normal,fixtureData.normal,fixtureData.correction,fixtureData.withdrawal]){const r=await request(f,'/v1/timing/sessions',{method:'POST',body});assert.equal(r.status,200,JSON.stringify(r.value));}
 const r=await request(f,'/v1/scalable/results/timing-demo/session-normal');assert.equal(r.value.payload.state,'withdrawn');assert.equal(r.value.payload.revision,3);assert.equal(f.store.data.timing.sessions.length,1);
 const status=await request(f,'/v1/status');assert.equal(status.value.capabilities.telemetry.version,1);
 const manual=await f.store.mutateAsync('test.add',{carId:'car-a',data:{date:'2026-11-09',track:'Home',bestLap:'6.5'}},{snapshot:false});assert.ok(manual);
});
test('quiet scalable stream delivers invalidations and closes cleanly on shutdown',async t=>{
 const f=await fixture(t),n=f.service.network;
 const response=await fetch('http://127.0.0.1:'+n.port+'/v1/scalable/events',{headers:{Authorization:'Bearer '+f.service.token,'X-SlotForge-Instance':f.service.instanceId,'X-SlotForge-Database':f.store.data.id},signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);
 const reader=response.body.getReader(),first=new TextDecoder().decode((await reader.read()).value);assert.match(first,/cursor/);
 await f.store.mutateAsync('car.save',{data:{name:'A changed car'}},{snapshot:false});const next=new TextDecoder().decode((await reader.read()).value);assert.match(next,/cursor/);assert.notEqual(first,next);
 f.service.quiesce();await f.service.idle();assert.equal(fs.existsSync(f.service.file),false);assert.equal((await reader.read()).done,true);
});
test('discovery cleanup cannot delete a replacement instance descriptor',async t=>{
 const f=await fixture(t),replacement={...JSON.parse(fs.readFileSync(f.service.file)),instanceId:'replacement'};fs.writeFileSync(f.service.file,JSON.stringify(replacement));f.service.close();assert.equal(JSON.parse(fs.readFileSync(f.service.file)).instanceId,'replacement');
});
test('disable survives restart and re-enable rotates credentials without reviving during shutdown',async t=>{
 const f=await fixture(t),token=f.service.token;
 await f.service.setEnabled(false);assert.equal(fs.existsSync(f.service.file),false);assert.equal(f.service.status().available,false);
 await f.restart();assert.equal(f.service.status().enabled,false);assert.equal(f.service.network.port||0,0);
 await f.service.setEnabled(true);assert.equal(f.service.status().available,true);assert.notEqual(f.service.token,token);
 assert.equal((await request(f,'/v1/status',{headers:{Authorization:'Bearer '+token}})).status,401);
 f.service.quiesce();await assert.rejects(f.service.setEnabled(true),/closing/);
});
test('an accepted transfer is drained at shutdown and retry finds its durable result',async t=>{
 const f=await fixture(t);let release;f.store.pendingWrite=new Promise(resolve=>release=resolve);
 const pending=post(f,transfer(f.store.data));for(let i=0;!f.store.domainPending&&i<200;i++)await new Promise(r=>setTimeout(r,5));assert.equal(f.store.domainPending,1);
 f.service.quiesce();let done=false;const drain=f.service.idle().then(()=>done=true);await new Promise(r=>setImmediate(r));assert.equal(done,false);
 f.store.pendingWrite=null;release();assert.equal((await pending).status,200);await drain;await f.restart();assert.equal((await receipt(f)).status,200);
});
test('stale links cannot alter cars; rejection releases the origin for deliberate re-review',async t=>{
 const f=await fixture(t),id=(await f.store.mutateAsync('car.save',{data:{name:'Existing car'}},{snapshot:false})).result;
 const input=transfer(f.store.data,{targets:[{timingCarId:'timing-car-a',paddockCarId:id,expectedRevision:f.store.data.cars[0].revision}]});await post(f,input);
 await f.store.mutateAsync('car.save',{id,revision:f.store.data.cars[0].revision,data:{name:'Renamed car'}},{snapshot:false});const sub=f.store.data.submissions[0];
 await assert.rejects(f.store.mutateAsync('submission.review',{id:sub.id,carId:id,decision:'accept',revision:f.store.data.cars[0].revision,fields:['name']},{snapshot:false}),e=>e.apiCode==='TARGET_CHANGED');assert.equal(f.store.data.cars[0].name,'Renamed car');assert.equal(sub.status,'pending');
 assert.equal((await post(f,{...input,transferId:'second'})).value.code,'ORIGIN_CONFLICT');
 const origin=await request(f,'/v1/local-library/origins/timing-home?timingCarId=timing-car-a');assert.equal(origin.value.transferId,'transfer-1');assert.equal(origin.value.cars[0].timingCarId,'timing-car-a');
 await f.store.mutateAsync('submission.review',{id:sub.id,carId:id,decision:'reject'},{snapshot:false});input.transferId='second';input.targets[0].expectedRevision=f.store.data.cars[0].revision;assert.equal((await post(f,input)).status,200);
});
test('partial reviews and deletion retain origin receipts without recreating cars',async t=>{
 const f=await fixture(t),input=transfer(f.store.data);input.export.items.slotcars.push({id:'second-car',name:'Other car'});const r=await post(f,input),first=r.value.cars[0],second=r.value.cars[1];
 await f.store.mutateAsync('submission.review',{id:r.value.submissionId,carId:first.paddockCarId,decision:'accept',revision:0,fields:['name']},{snapshot:false});
 let status=await receipt(f);assert.equal(status.value.status,'pending');assert.equal(status.value.cars[0].decision,'accept');assert.equal(status.value.cars[1].decision,'pending');assert.ok(status.value.cars[0].reviewedAt);assert.ok(status.value.cars[0].carRevision);
 await f.store.mutateAsync('car.archive',{id:first.paddockCarId,revision:f.store.data.cars[0].revision},{snapshot:false});assert.equal((await receipt(f)).value.cars[0].archived,true);
 await f.store.mutateAsync('car.delete',{id:first.paddockCarId,revision:f.store.data.revision,confirmed:true,confirmName:'Test GT3'},{snapshot:false});
 status=await receipt(f);assert.equal(status.value.cars[0].decision,'accept');assert.equal(status.value.cars[0].present,false);
 assert.equal((await post(f,input)).value.duplicate,true);assert.equal(f.store.data.cars.length,0);
 assert.equal((await post(f,{...input,transferId:'another'})).value.code,'ORIGIN_CONFLICT');
 await f.store.mutateAsync('submission.review',{id:r.value.submissionId,carId:second.paddockCarId,decision:'reject'},{snapshot:false});await f.restart();assert.equal((await receipt(f)).value.status,'reviewed');
});
test('unsafe discovery directories fail closed without stopping database work',async t=>{
 const f=await fixture(t);await f.service.setEnabled(false);const file=path.join(f.root,'not-a-directory');fs.writeFileSync(file,'ordinary file');
 const local=new LocalLibrary({store:f.store,profile:path.join(f.root,'other'),folder:file});t.after(()=>local.close());assert.equal((await local.start()).available,false);assert.match(local.status().error,/unavailable/);assert.equal(local.network.port||0,0);assert.equal(fs.readFileSync(file,'utf8'),'ordinary file');
 await f.store.mutateAsync('car.save',{data:{name:'Still works'}},{snapshot:false});assert.equal(f.store.data.cars[0].name,'Still works');
});
test('cancellation is durable and idempotent and cannot undo approved cars',async t=>{
 const f=await fixture(t),input=transfer(f.store.data);input.export.items.slotcars.push({id:'second-car',name:'Second'});const pending=await post(f,input),[first,second]=pending.value.cars;
 await f.store.mutateAsync('submission.review',{id:pending.value.submissionId,carId:first.paddockCarId,decision:'accept',revision:0,fields:['name']},{snapshot:false});
 const cancel=()=>request(f,'/v1/local-library/imports/timing-home/transfer-1/cancel',{method:'POST',body:{version:1,itemIds:[first.itemId,second.itemId]}});
 const result=await cancel();assert.equal(result.status,200);assert.deepEqual(result.value.cars.map(c=>c.status),['approved','cancelled']);assert.equal(f.store.data.cars.length,1);
 const revision=f.store.data.revision;assert.equal((await cancel()).status,200);assert.equal(f.store.data.revision,revision);await f.restart();assert.deepEqual((await receipt(f)).value.cars.map(c=>c.status),['approved','cancelled']);
 assert.equal((await post(f,input)).value.duplicate,true);assert.equal(f.service.store.data.cars.length,1);
});
test('photos and reference numbers survive review; simulation fields are explicitly rejected',async t=>{
 const f=await fixture(t),input=transfer(f.store.data),row=input.export.items.slotcars[0];row.reference='GT-01';row.picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
 row.damageFactor='2';assert.equal((await post(f,input)).value.code,'INVALID_IMPORT');delete row.damageFactor;
 const result=await post(f,input);assert.equal(result.status,200);await f.store.mutateAsync('submission.review',{id:result.value.submissionId,carId:result.value.cars[0].paddockCarId,decision:'accept',revision:0,fields:['name','picture','reference']},{snapshot:false});assert.equal(f.store.data.cars[0].picture,row.picture);assert.equal(f.store.data.cars[0].reference,row.reference);
});
test('invalid plans and failed commits leave neither origin associations nor submissions',()=>{
 const store=new Store(),input=transfer(store.data);input.export.items.slotcars=Array.from({length:26},(_,i)=>({id:'car-'+i,name:'Car'}));assert.throws(()=>api.receive(store,input),e=>e.apiCode==='INVALID_IMPORT');
 const fresh=transfer(store.data);store.persist=()=>{throw Error('Disk full');};assert.throws(()=>api.receive(store,fresh),/Disk full/);assert.equal(store.data.submissions.length,0);assert.throws(()=>api.originReceipt(store,'timing-home','timing-car-a'),e=>e.apiCode==='ORIGIN_NOT_FOUND');
});
test('published local-library messages match schemas and canonical request hashes',()=>{
 const root=path.join(__dirname,'fixtures','contracts','local-library-v1'),schema=JSON.parse(fs.readFileSync(path.join(root,'schema.json'))),validate=require('../src/timing-schema.cjs').validate;
 const read=name=>JSON.parse(fs.readFileSync(path.join(root,'fixtures',name)));
 for(const name of fs.readdirSync(path.join(root,'fixtures'))){const type=name==='discovery.json'?'descriptor':name==='request-cancel.json'?'cancel':name.startsWith('request-')?'request':name.startsWith('receipt-')?'receipt':name.startsWith('error-')?'error':null;if(type)assert.doesNotThrow(()=>validate(read(name),schema.$defs[type]),name);}
 for(const fixture of read('hashes.json'))assert.equal(require('node:crypto').createHash('sha256').update(require('../src/timing-integration.cjs').canonical(read(fixture.request))).digest('hex'),fixture.sha256);
 assert.deepEqual(read('receipt-cancelled.json').cars.map(c=>c.status),['approved','cancelled']);assert.equal(read('receipt-linked.json').cars[0].action,'link');
});
