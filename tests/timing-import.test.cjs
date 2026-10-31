const test=require('node:test'),assert=require('node:assert/strict');
const {timingPackage,timingCarId}=require('../src/timing-import.cjs');
const {Store,migrate}=require('../src/store.cjs');
const {gearRatio,gearRatioText}=require('../renderer/domain.js');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const fixture=()=>({format:'slotforge-timing-export',fileVersion:1,exported:'2026-10-30T19:50:54.519Z',items:{raceclasses:[{id:'gt3',name:'GT3'}],slotcars:[{id:'timing-original',brand:'NSR',manufacturer:'Mosler',model:'MT900R',scale:'1:32',motor:'King Evo',tyres:'SC30',gearing:'13/31',weight:'63gr',raceClass:'gt3',picture:image,extraPictures:[image],lapsDriven:7278,lapsSinceService:0,custom:{myField:'Blue'}}]},customFields:{slotcars:[{id:'myField',label:'Paint'}]}});

test('Timing cars map identity, units, class and pictures including rear tyres without inventing lap records',()=>{
  const input=fixture(),original=structuredClone(input),p=timingPackage(input),c=p.cars[0];
  assert.deepEqual(input,original);assert.equal(c.name,'Mosler MT900R');assert.equal(c.maker,'NSR');assert.equal(c.marque,'Mosler');assert.equal(c.raceClass,'GT3');
  assert.equal(c.technical.pinion,'13');assert.equal(c.technical.gear,'31');assert.equal(c.technical.weight,'63');assert.equal(c.technical.rearTyres,'SC30');
  assert.equal(c.technical.frontTyres,undefined);assert.match(c.technical.technicalNotes,/Laps since service: 0/);assert.match(c.technical.technicalNotes,/Custom · Paint: Blue/);
  assert.equal(c.picture,image);assert.equal(c.photos[0].data,image);assert.equal(c.sharedSetups,undefined);
});
test('Timing imports enter review, repeated files are idempotent, changed exports update the same car',()=>{
  const s=new Store(),input=fixture(),pack=timingPackage(input),received=s.mutate('submission.add',{package:pack});assert.equal(s.data.cars.length,0);
  s.mutate('submission.review',{id:received.result,carId:pack.cars[0].id,revision:0,decision:'accept'});const car=s.data.cars[0];
  s.mutate('car.save',{id:car.id,revision:car.revision,data:{owner:'Private owner',technical:{guide:'Local guide'}}});
  assert.equal(s.mutate('submission.add',{package:timingPackage(input)}).result,'duplicate');
  input.items.slotcars[0].motor='New motor';input.exported='2026-10-31T00:00:00Z';const next=timingPackage(input);assert.equal(next.cars[0].id,car.id);assert.notEqual(next.packageId,pack.packageId);
  const second=s.mutate('submission.add',{package:next});s.mutate('submission.review',{id:second.result,carId:car.id,revision:s.data.cars[0].revision,decision:'accept'});
  assert.equal(s.data.cars.length,1);assert.equal(s.data.cars[0].technical.motor,'New motor');assert.equal(s.data.cars[0].technical.guide,'Local guide');assert.equal(s.data.cars[0].owner,'Private owner');assert.equal(s.data.tests.length,0);assert.equal(s.data.parts.length,0);
  assert.equal(migrate(s.snapshot()).cars[0].id,car.id);
});
test('Timing IDs distinguish same-name cars and do not collide with native IDs',()=>{
  const input=fixture();input.items.slotcars.push({...input.items.slotcars[0],id:'second'});const p=timingPackage(input);
  assert.equal(p.cars[0].name,p.cars[1].name);assert.notEqual(p.cars[0].id,p.cars[1].id);assert.notEqual(p.cars[0].id,'timing-original');assert.equal(timingCarId('timing-original'),p.cars[0].id);
});
test('Unparseable units, gearing and missing class definitions remain readable notes',()=>{
  const input=fixture();Object.assign(input.items.slotcars[0],{weight:'2 oz',gearing:'unknown gear',raceClass:'missing'});const c=timingPackage(input).cars[0];
  assert.equal(c.technical.weight,undefined);assert.equal(c.technical.pinion,undefined);assert.equal(c.raceClass,undefined);assert.match(c.technical.technicalNotes,/2 oz/);assert.match(c.technical.technicalNotes,/unknown gear/);assert.match(c.technical.technicalNotes,/missing/);
  input.items.slotcars[0].weight='63,5 g';input.items.slotcars[0].gearing='9 : 27';const other=timingPackage(input).cars[0];assert.equal(other.technical.weight,'63.5');assert.equal(other.technical.pinion,'9');
});
test('Empty Timing values do not clear existing local photos or specifications',()=>{
  const input=fixture();Object.assign(input.items.slotcars[0],{motor:'',picture:'',gearing:'',weight:'',extraPictures:[]});const c=timingPackage(input).cars[0];
  for(const k of ['picture','photos'])assert.equal(Object.hasOwn(c,k),false);for(const k of ['motor','pinion','gear','weight'])assert.equal(Object.hasOwn(c.technical,k),false);
});
test('Malformed Timing files fail conversion before adding any submission',()=>{
  for(const mutate of [d=>d.fileVersion=2,d=>d.items.slotcars=[],d=>d.items.slotcars.push({...d.items.slotcars[0]}),d=>d.items.slotcars[0].picture='https://example.com/picture.png',d=>d.items.slotcars[0].extraPictures=[{data:image}],d=>d.items.slotcars[0].custom={bad:{}},d=>delete d.items.slotcars[0].id]){
    const input=fixture(),s=new Store();mutate(input);assert.throws(()=>s.mutate('submission.add',{package:timingPackage(input)}));assert.equal(s.data.submissions.length,0);assert.equal(s.data.revision,0);
  }
});
test('Gear ratio is driven gear divided by pinion, rounded with at least two decimals',()=>{
  assert.equal(gearRatio(9,27),3);assert.equal(gearRatioText('9','27'),'3.00:1');assert.equal(gearRatioText('8','27'),'3.375:1');assert.equal(gearRatioText('13','31'),'2.385:1');assert.equal(gearRatioText(' 9 ','27'),'3.00:1');
});
test('Missing, fractional, zero or non-numeric tooth counts never produce a false ratio',()=>{
  for(const value of ['',null,undefined,0,-1,8.5,'8.5','8 teeth','1e2','0x10',true,Infinity,'9007199254740992']){assert.equal(gearRatio(value,27),null);assert.equal(gearRatio(9,value),null);assert.equal(gearRatioText(value,27),'');}
});
