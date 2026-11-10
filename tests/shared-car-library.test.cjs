'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Store}=require('../src/store.cjs'),{LocalLibrary}=require('../src/local-library.cjs'),shared=require('../src/shared-car-library.cjs');
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-shared-')),file=path.join(root,'database.sqlite');let store=new Store(file);store.persist(store.data);let service;
 const start=async()=>{service=new LocalLibrary({store,profile:root,folder:path.join(root,'discovery')});await service.start();assert.equal(service.error,'');};await start();
 t.after(async()=>{service.quiesce();await service.idle();service.close();fs.rmSync(root,{recursive:true,force:true});});
 const request=async(route,body,headers={})=>{const r=await fetch('http://127.0.0.1:'+service.network.port+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+service.token,'X-SlotForge-Instance':service.instanceId,'X-SlotForge-Database':store.data.id,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,value:await r.json()};};
 const schema=await request('/v1/local-library/car-schema');assert.equal(schema.status,200);
 const input=(extra={})=>({version:1,databaseId:store.data.id,recoveryId:schema.value.recoveryId,sourceId:'timing-home',operationId:'operation-1',action:'create',set:{name:'Shared GT',maker:'NSR',weight:82.5},...extra});
 return {root,get store(){return store;},get service(){return service;},request,input,schema:schema.value,post:body=>request('/v1/local-library/car-operations',body),async restart(){service.quiesce();await service.idle();service.close();store=await Store.open(file);await start();}};
}

test('targeted editable reads include every field, archived cars and parsing hints without writes or photos',async t=>{
 const f=await fixture(t),id=f.store.mutate('car.save',{data:{name:'Editor car',reference:'NSR-001',number:'12',livery:'Gulf',maker:'x'.repeat(1001),owner:'Private owner',privateNotes:'Private notes',picture:'data:image/png;base64,AAAA',technical:{weight:'about 80g',pinion:'9'}}}).result;
 const before=f.store.snapshot(),route='/v1/local-library/cars/'+id,response=await f.request(route);assert.equal(response.status,200);assert.deepEqual(response.value,{version:1,databaseId:before.id,recoveryId:f.schema.recoveryId,...shared.project(before.cars[0])});assert.deepEqual(Object.keys(response.value.fields),Object.keys(shared.fields));assert.equal(response.value.fields.reference,'NSR-001');assert.equal(response.value.fields.number,'12');assert.equal(response.value.fields.livery,'Gulf');assert.equal(response.value.fields.pinion,9);assert.equal(response.value.fields.weight,null);assert.equal(response.value.unparsed.weight,'about 80g');assert.deepEqual(response.value.truncated,['maker']);assert.ok(!JSON.stringify(response.value).includes('Private'));assert.ok(!JSON.stringify(response.value).includes('data:image'));assert.deepEqual(f.store.snapshot(),before);
 assert.equal(f.schema.car,'/v1/local-library/cars/{carId}');const status=await f.request('/v1/status');assert.equal(status.value.capabilities.localLibrary.sharedCars.car,f.schema.car);
 f.store.mutate('car.archive',{id,revision:1});const archived=await f.request(route);assert.equal(archived.value.archived,true);assert.equal(archived.value.revision,2);assert.equal((await f.request('/v1/local-library/cars/missing')).value.code,'CAR_NOT_FOUND');assert.equal((await f.request(route+'?fields=name')).status,400);
 await f.restart();assert.deepEqual((await f.request(route)).value,archived.value);
});

test('editable reads retain local credential, instance, database and origin protection and are absent on LAN',async t=>{
 const f=await fixture(t),id=(await f.post(f.input())).value.car.id,route='/v1/local-library/cars/'+id;
 assert.equal((await f.request(route,undefined,{Authorization:'Bearer invalid'})).status,401);
 assert.equal((await f.request(route,undefined,{'X-SlotForge-Instance':'wrong'})).status,409);
 assert.equal((await f.request(route,undefined,{'X-SlotForge-Database':'wrong'})).value.code,'DATABASE_MISMATCH');
 assert.equal((await f.request(route,undefined,{Origin:'null'})).status,403);
 const n=new(require('../src/network.cjs').Network)(f.store);t.after(async()=>{await n.stop();n.close();});const started=await n.start();assert.equal((await fetch('http://127.0.0.1:'+started.port+route,{headers:{Authorization:'Bearer '+started.code,'X-SlotForge-Database':f.store.data.id}})).status,404);
});

test('editable projection, identity and recovery generation remain from one snapshot across replacement',async t=>{
 const f=await fixture(t),id=(await f.post(f.input())).value.car.id,before=shared.readCar(f.store,id),replacement=f.store.snapshot();replacement.cars[0].name='Restored name';replacement.cars[0].revision++;replacement.revision++;
 const persist=f.store.persistAsync.bind(f.store);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 f.store.persistAsync=async(...args)=>{entered();await gate;return persist(...args);};
 const restore=f.store.restoreAsync(replacement,f.store.data.revision);await started;let settled=false;const read=f.request('/v1/local-library/cars/'+id).finally(()=>{settled=true;});
 try{await new Promise(r=>setTimeout(r,50));assert.equal(settled,false);}finally{release();f.store.persistAsync=persist;}
 await restore;const after=await read;assert.equal(after.status,200);assert.equal(after.value.fields.name,'Restored name');assert.equal(after.value.revision,2);assert.notEqual(after.value.recoveryId,before.recoveryId);assert.deepEqual(after.value,shared.readCar(f.store,id));
});
test('shared creates commit once, survive restart and retain original receipts after edits',async t=>{
 const f=await fixture(t),request=f.input();const responses=await Promise.all([f.post(request),f.post(request)]);for(const r of responses)assert.equal(r.status,200,JSON.stringify(r.value));assert.equal(responses.filter(r=>!r.value.duplicate).length,1);
 const first=responses[0].value,id=first.car.id;assert.equal(f.store.data.cars.length,1);assert.equal(f.store.data.submissions.length,0);assert.equal(first.car.fields.weight,82.5);
 const patch=f.input({operationId:'edit-1',action:'patch',carId:id,expectedRevision:first.car.revision,set:{name:'Renamed'},clear:['reference']});assert.equal((await f.post(patch)).status,200);await f.restart();
 const retry=await f.post(request);assert.equal(retry.value.duplicate,true);assert.deepEqual(retry.value.car,first.car);assert.equal(retry.value.current.revision,2);
 const receipt=await f.request('/v1/local-library/car-operations/timing-home/operation-1',undefined,{'X-SlotForge-Recovery':request.recoveryId});assert.equal(receipt.status,200);assert.equal(receipt.value.car.id,id);assert.equal(receipt.value.current.revision,2);
 assert.equal((await f.post({...request,set:{name:'Another'}})).value.code,'OPERATION_CONFLICT');assert.equal(f.store.data.cars.length,1);
});
test('patches preserve private fields/photos, report conflicts, and archive/restore are explicit',async t=>{
 const f=await fixture(t),id=f.store.mutate('car.save',{data:{name:'Owned',owner:'Private',picture:'data:image/png;base64,AAAA',technical:{motor:'Existing',rearTyres:'Old',technicalNotes:'Keep'}}}).result;
 const command=f.input({action:'patch',carId:id,expectedRevision:1,set:{rearTyres:'New'},clear:['reference']});const r=await f.post(command);assert.equal(r.status,200,JSON.stringify(r.value));const c=f.store.data.cars.find(c=>c.id===id);assert.equal(c.owner,'Private');assert.equal(c.picture,'data:image/png;base64,AAAA');assert.equal(c.technical.motor,'Existing');assert.equal(c.technical.technicalNotes,'Keep');assert.equal(r.value.car.fields.rearTyres,'New');assert.equal(JSON.stringify(r.value).includes('Private'),false);
 const conflict=await f.post({...command,operationId:'stale'});assert.equal(conflict.status,409);assert.equal(conflict.value.code,'REVISION_CONFLICT');assert.equal(conflict.value.details.current.revision,2);
 const state=(action,operationId,revision)=>f.input({action,operationId,carId:id,expectedRevision:revision,set:undefined});const archived=await f.post(state('archive','archive',2));assert.equal(archived.value.car.archived,true);assert.equal((await f.post(state('archive','archive-again',3))).value.car.revision,3);
 assert.equal((await f.post({...command,operationId:'archived-edit',expectedRevision:3})).value.code,'CAR_ARCHIVED');const restored=await f.post(state('restore','restore',3));assert.equal(restored.value.car.archived,false);assert.equal(restored.value.car.revision,4);assert.equal(f.store.data.cars.length,1);
});
test('installed fields cannot be overwritten or cleared and stock remains unchanged',async t=>{
 const f=await fixture(t),id=f.store.mutate('car.save',{data:{name:'Fitted'}}).result,part=f.store.mutate('part.save',{data:{name:'Installed motor',category:'Motor',quantity:1,tracking:'individual',condition:'New'}}).result;
 f.store.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor',position:'Motor'});const c=f.store.data.cars.find(c=>c.id===id),before=f.store.snapshot();
 const input=f.input({action:'patch',carId:id,expectedRevision:c.revision,set:{motor:'Different'}});const r=await f.post(input);assert.equal(r.value.code,'INSTALLED_PART_CONFLICT',JSON.stringify(r.value));assert.deepEqual(r.value.details.fields,['motor']);assert.deepEqual(f.store.snapshot(),before);
 assert.equal((await f.post({...input,set:{},clear:['motor']})).value.code,'INSTALLED_PART_CONFLICT');assert.equal((await f.post({...input,set:{motor:'Installed motor',weight:81}})).status,200);
});
test('strict fields, units, revision requirements and metadata limits reject without writes',async t=>{
 const f=await fixture(t);const bad=[{set:{name:'A',owner:'Private'}},{set:{name:'A',weight:'82'}},{set:{name:'A',pinion:1.5}},{set:{name:'A',gear:0}},{set:{name:'A',picture:'data:image/png;base64,AAAA'}},{set:{name:'A'},clear:['name']},{set:{name:'A',reference:'r'},clear:['reference']},{set:{name:'A'},carId:'client-chosen'},{set:{name:'A'},unknown:true},{action:'patch',carId:'x',expectedRevision:0,set:{name:'A'}}];
 for(const p of bad){const r=await f.post(f.input(p));assert.equal(r.status,400,JSON.stringify(r.value));}assert.equal(f.store.data.cars.length,0);
 const large=await f.post(f.input({set:{name:'a'.repeat(140000)}}));assert.equal(large.status,413);assert.equal((await f.request('/v1/local-library/car-schema',undefined,{Origin:'null'})).status,403);
});
test('restore changes recovery identity and blocks both acknowledged and uncertain retries',async t=>{
 const f=await fixture(t),before=f.store.snapshot(),input=f.input();assert.equal((await f.post(input)).status,200);await f.store.restoreAsync(before,f.store.data.revision);const next=await f.request('/v1/local-library/car-schema');assert.notEqual(next.value.recoveryId,input.recoveryId);
 for(const request of [input,{...input,operationId:'uncertain-create'}])assert.equal((await f.post(request)).value.code,'RECOVERY_CHANGED');assert.equal(f.store.data.cars.length,0);
 const receipt=await f.request('/v1/local-library/car-operations/timing-home/operation-1',undefined,{'X-SlotForge-Recovery':input.recoveryId});assert.equal(receipt.value.code,'RECOVERY_CHANGED');await f.restart();assert.equal((await f.post(input)).value.code,'RECOVERY_CHANGED');
});
test('receipt insert failure rolls back car, feed, revision and outcome atomically',async t=>{
 const f=await fixture(t),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(f.store.file);db.exec("CREATE TRIGGER fail_shared BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT,'injected receipt failure'); END;");db.close();
 const before=f.store.snapshot(),cursor=require('../src/sqlite-storage.cjs').syncState(f.store.file);assert.notEqual((await f.post(f.input())).status,200);assert.deepEqual(f.store.snapshot(),before);assert.deepEqual(require('../src/sqlite-storage.cjs').syncState(f.store.file),cursor);
 const clean=new DatabaseSync(f.store.file);clean.exec('DROP TRIGGER fail_shared');clean.close();assert.equal((await f.post(f.input())).status,200);
});
test('LAN credentials cannot access direct writes and local disable revokes them',async t=>{
 const f=await fixture(t),n=new (require('../src/network.cjs').Network)(f.store);await n.start();t.after(()=>n.close());const r=await fetch('http://127.0.0.1:'+n.port+'/v1/local-library/car-operations',{method:'POST',headers:{Authorization:'Bearer '+n.timingCode,'Content-Type':'application/json'},body:JSON.stringify(f.input())});assert.equal(r.status,404);assert.equal(f.store.data.cars.length,0);
 await f.service.setEnabled(false);assert.equal(f.service.status().available,false);
});

test('concurrent distinct edits cannot both apply the same car revision',async t=>{
 const f=await fixture(t),created=await f.post(f.input()),id=created.value.car.id;
 const edit=f.input({action:'patch',carId:id,expectedRevision:1,set:{name:'Edit A'}});
 const outcomes=await Promise.all([f.post({...edit,operationId:'edit-a'}),f.post({...edit,operationId:'edit-b',set:{name:'Edit B'}})]);
 assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);assert.equal(outcomes.find(r=>r.status===409).value.code,'REVISION_CONFLICT');assert.equal(f.store.data.cars[0].revision,2);
});

test('fitted gears protect known tooth counts without preventing unrelated measurements',async t=>{
 const f=await fixture(t),id=f.store.mutate('car.save',{data:{name:'Geared'}}).result;
 for(const [field,partType,teeth] of [['pinionPart','Pinion','9'],['gearPart','Crown gear','27']]){const product={kind:'part',name:partType,manufacturer:'Example',reference:field,category:'Gears & transmission',partType,supplyKind:'',packSize:1,packUnit:'piece',packDescription:'',sourceUrl:'https://example.com/gear',checkedDate:'',reviewNotes:'',specifications:[{name:'Teeth',value:teeth,unit:'teeth'}]};f.store.mutate('catalogue.apply',{revision:f.store.data.revision,confirmed:true,input:{format:'slotforge-catalogue',version:1,products:[product]},selections:[{index:0,create:true}]});const part=f.store.data.parts.find(p=>p.reference===field);f.store.mutate('part.save',{id:part.id,data:{...part,quantity:1}});f.store.mutate('part.install',{carId:id,partId:part.id,quantity:1,field});}
 const input=f.input({action:'patch',carId:id,expectedRevision:f.store.data.cars[0].revision,set:{pinion:10,gear:28}}),before=f.store.snapshot();
 const conflict=await f.post(input);assert.equal(conflict.value.code,'INSTALLED_PART_CONFLICT',JSON.stringify(conflict.value));assert.deepEqual(conflict.value.details.fields.sort(),['gear','pinion']);assert.deepEqual(f.store.snapshot(),before);
 assert.equal((await f.post({...input,set:{pinion:9,gear:27,weight:80}})).status,200);
});

test('operation namespaces are source-specific and deleted cars retain truthful receipts',async t=>{
 const f=await fixture(t),a=await f.post(f.input()),b=await f.post(f.input({sourceId:'another-timing'}));assert.equal(a.status,200);assert.equal(b.status,200);assert.notEqual(a.value.car.id,b.value.car.id);
 f.store.mutate('car.delete',{id:a.value.car.id,revision:f.store.data.revision,confirmName:'Shared GT',confirmed:true});
 const retry=await f.post(f.input());assert.equal(retry.status,200);assert.equal(retry.value.current.present,false);assert.equal(retry.value.current.revision,null);assert.equal(f.store.data.cars.length,1);
 assert.equal((await f.post(f.input({action:'patch',operationId:'deleted-edit',carId:a.value.car.id,expectedRevision:1,set:{name:'Do not resurrect'}}))).value.code,'CAR_NOT_FOUND');
});

test('published shared-car field contract and canonical request hashes match implementation',()=>{
 const root=path.join(__dirname,'./fixtures/contracts/shared-car-library-v1'),read=name=>JSON.parse(fs.readFileSync(path.join(root,name)));
 assert.deepEqual(read('capability.json'),shared.capability);assert.deepEqual(read('writable-fields.json'),shared.fields);
 const definition=read('operation.schema.json');assert.deepEqual(Object.keys(definition.properties.set.properties),Object.keys(shared.fields));
 const readSchema=read('car-read.schema.json');assert.deepEqual(Object.keys(readSchema.properties.fields.properties),Object.keys(shared.fields));for(const [lookup,receipt]of [['car-read-response.json','create-response.json'],['car-read-archived-response.json','archive-response.json']]){const r=read('fixtures/'+receipt);assert.deepEqual(read('fixtures/'+lookup),{version:1,databaseId:r.databaseId,recoveryId:r.recoveryId,...r.car});}
 for(const fixture of read('fixtures/hashes.json'))assert.equal(require('../src/timing-integration.cjs').digest(read('fixtures/'+fixture.request)),fixture.sha256);
 const original=read('fixtures/create-response.json'),retried=read('fixtures/original-receipt-after-edit.json');assert.deepEqual(original.car,retried.car);assert.ok(retried.current.revision>original.car.revision);
});

test('shared writes preserve pre-rebuild receipts and explicitly identify the successor on new writes',async t=>{
 const f=await fixture(t),created=await f.post(f.input()),old=created.value.car.id,act=(action,p)=>f.store.mutate(action,{revision:f.store.data.revision,...p}).result;
 const part=act('part.save',{data:{name:'Chassis',quantity:1,tracking:'individual'}}),draft=act('rebuild.start',{carId:old}),data=structuredClone(f.store.data.buildDrafts.find(d=>d.id===draft).data);data.parts=[{key:'chassis',partId:part,name:'Chassis',quantity:1,slot:'chassis',position:'Chassis'}];const next=act('build.create',{data,draftId:draft,confirmed:true}),original=f.store.data.cars.find(c=>c.id===old);
 const repeated=await f.post(f.input());assert.equal(repeated.status,200);assert.equal(repeated.value.duplicate,true);assert.equal(repeated.value.car.id,old);
 for(const action of ['patch','restore']){const response=await f.post(f.input({operationId:'after-rebuild-'+action,action,carId:old,expectedRevision:original.revision,...(action==='patch'?{set:{name:'Wrong generation'}}:{set:undefined})}));assert.equal(response.status,409);assert.equal(response.value.code,'CAR_REBUILT');assert.equal(response.value.details.successor.id,next);}
 const lookup=await f.request('/v1/rebuilds/cars/'+old);assert.equal(lookup.status,200);assert.equal(lookup.value.successor.id,next);
});
