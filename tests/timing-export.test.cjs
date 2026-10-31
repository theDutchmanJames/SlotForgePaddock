const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
const {timingExport}=require('../src/timing-export.cjs');
const {timingPackage}=require('../src/timing-import.cjs');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){const store=new Store();const id=store.mutate('car.save',{data:{name:'Club Aston',maker:'NSR',marque:'Aston Martin',model:'DB9R',scale:'1:32',raceClass:'GT3',picture:image,owner:'PRIVATE OWNER',privateNotes:'PRIVATE NOTES',technical:{motor:'King Evo',rearTyres:'Rear rubber',frontTyres:'FRONT ONLY',pinion:'9',gear:'27',weight:'83.5',technicalNotes:'PRIVATE TECH'}}}).result;return {store,id};}

test('Timing export maps selected public car fields, rear tyres and linked class definitions without mutation',()=>{
  const {store,id}=fixture(),before=store.snapshot(),out=timingExport(store.data,[id]),car=out.items.slotcars[0];
  assert.equal(out.format,'slotforge-timing-export');assert.equal(out.fileVersion,1);assert.equal(out.app,'SlotForge Paddock');
  assert.deepEqual([car.brand,car.manufacturer,car.model,car.name,car.scale],['NSR','Aston Martin','DB9R','Club Aston','1:32']);
  assert.deepEqual([car.motor,car.tyres,car.gearing,car.weight],['King Evo','Rear rubber','9/27','83.5']);
  assert.equal(out.items.raceclasses[0].id,car.raceClass);assert.equal(out.items.raceclasses[0].name,'GT3');
  assert.equal(car.picture,image);assert.deepEqual(car.extraPictures,[]);assert.deepEqual(store.snapshot(),before);
  for(const secret of ['PRIVATE OWNER','PRIVATE NOTES','PRIVATE TECH','FRONT ONLY'])assert.ok(!JSON.stringify(out).includes(secret));
  for(const field of ['paddock','paddockJournal','lapsDriven','lapsSinceService','tyreCompound','damageFactor','failureFactor','sharedSetups'])assert.ok(!Object.hasOwn(car,field));
});

test('Timing identities distinguish physical cars and databases and classes are deduplicated within an export',()=>{
  const {store,id}=fixture();const other=store.mutate('car.save',{data:{name:'Club Aston',raceClass:'GT3'}}).result;
  const out=timingExport(store.data,[id,other]);assert.equal(out.items.raceclasses.length,1);assert.notEqual(out.items.slotcars[0].id,out.items.slotcars[1].id);
  assert.equal(timingExport(store.data,[id]).items.slotcars[0].id,out.items.slotcars[0].id);
  const copy=store.snapshot();copy.id='another-db';assert.notEqual(timingExport(copy,[id]).items.slotcars[0].id,out.items.slotcars[0].id);
  assert.notEqual(timingExport(copy,[id]).items.raceclasses[0].id,out.items.raceclasses[0].id);
});

test('minimal and partial cars use name as model without inventing a gear ratio or class',()=>{
  const store=new Store(),id=store.mutate('car.save',{data:{name:'My scratch build',technical:{pinion:'9'}}}).result;
  const out=timingExport(store.data,[id]),car=out.items.slotcars[0];assert.equal(car.model,'My scratch build');assert.equal(car.gearing,'');assert.equal(car.raceClass,'');assert.deepEqual(out.items.raceclasses,[]);
});

test('additional photos are opt-in and Timing exports never include saved setups or private custom fields',()=>{
  const {store,id}=fixture();store.data.cars[0].photos=[{id:'photo-1',name:'PRIVATE PHOTO TITLE',data:image}];store.data.cars[0].custom={secret:'SECRET CUSTOM'};
  store.mutate('setup.save',{carId:id,name:'Secret setup',notes:'SECRET SETUP'});
  const out=timingExport(store.data,[id],{photos:true,setups:true});assert.deepEqual(out.items.slotcars[0].extraPictures,[image]);
  for(const secret of ['PRIVATE PHOTO TITLE','SECRET CUSTOM','SECRET SETUP'])assert.ok(!JSON.stringify(out).includes(secret));
  assert.deepEqual(timingExport(store.data,[id]).items.slotcars[0].extraPictures,[]);
});

test('invalid selections fail and file conversion back into Paddock retains supported fields',()=>{
  const {store,id}=fixture();for(const ids of [[],[id,id],['missing'],Array(1001).fill(id)])assert.throws(()=>timingExport(store.data,ids));
  const back=timingPackage(timingExport(store.data,[id])).cars[0];assert.equal(back.name,'Club Aston');assert.equal(back.maker,'NSR');assert.equal(back.marque,'Aston Martin');assert.equal(back.raceClass,'GT3');assert.equal(back.technical.rearTyres,'Rear rubber');assert.equal(back.technical.pinion,'9');assert.equal(back.technical.gear,'27');assert.equal(back.technical.weight,'83.5');
});
