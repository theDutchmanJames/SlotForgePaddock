const test=require('node:test'),assert=require('node:assert/strict');
const {Store,migrate,makePackage,validatePackage,publicCar}=require('../src/store.cjs');
const history=require('../src/real-history.cjs'),pace=require('../renderer/pace-model.js');
const timing=require('../src/timing-integration.cjs'),{fixtures}=require('./support/timing-fixtures.cjs');
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1kAAAAASUVORK5CYII=';
function setup(){const s=new Store(),id=s.mutate('car.save',{data:{name:'Example',privateNotes:'Private'}}).result;return {s,id};}
function save(s,id,realHistory){return s.mutate('car.save',{id,revision:s.data.cars.find(c=>c.id===id).revision,data:{realHistory}});}
const photo={id:'photo-1',name:'Original car',data:pixel,caption:'Example credit',sourceUrl:'https://example.org/photo'};
test('real history is optional, validated, persistent and separate from racing and private data',()=>{
 const {s,id}=setup();assert.equal(s.data.cars[0].realHistory,undefined);
 save(s,id,{team:'Example team',finish:'DNF',sources:[{title:'Results',url:'https://example.org/results'}],photos:[photo]});
 const h=s.data.cars[0].realHistory;assert.equal(h.classification,'Unverified');assert.equal(h.finish,'DNF');assert.deepEqual(migrate(s.snapshot()).cars[0].realHistory,h);
 assert.equal(publicCar(s.data.cars[0]).realHistory,undefined);assert.equal(timing.profile(s,id).car.realHistory,undefined);
 const before=s.snapshot();assert.throws(()=>s.mutate('car.save',{id,revision:1,data:{realHistory:{history:'Stale'}}}),/changed/);assert.deepEqual(s.snapshot(),before);
});
test('history rejects bad sources, photos and classifications atomically',()=>{
 const {s,id}=setup(),before=s.snapshot();
 for(const h of [{classification:'Automatically verified'},{sources:[{url:'javascript:alert(1)'}]},{sources:[{url:'file:///C:/secret'}]},{sources:[{url:'https://user:password@example.org'}]},{sources:[{title:'No URL',url:''}]},{sources:Array.from({length:21},()=>({url:'https://example.org'}))},{photos:[{...photo,data:'data:image/svg+xml,<svg/>'}]},{photos:[photo,photo]},{team:5}]){assert.throws(()=>save(s,id,h));assert.deepEqual(s.snapshot(),before);}
 assert.throws(()=>history.url('mailto:user@example.org'));assert.equal(history.url('https://example.org/a'),'https://example.org/a');
});
test('duplicating a model copies its research, without copying its slotcar performance history',()=>{
 const {s,id}=setup();save(s,id,{team:'Example team',photos:[photo]});s.mutate('test.add',{carId:id,track:'Circuit',best:'10'});
 const copy=s.mutate('car.duplicate',{id}).result;
 assert.deepEqual(s.data.cars.find(c=>c.id===copy).realHistory,s.data.cars.find(c=>c.id===id).realHistory);
 assert.equal(s.data.tests.filter(t=>t.carId===copy).length,0);assert.equal(s.data.cars.find(c=>c.id===copy).privateNotes,undefined);
});
test('car packages retain sources, optionally photos, and text-only imports preserve existing history photos',()=>{
 const {s,id}=setup();save(s,id,{team:'Example team',photos:[photo],sources:[{url:'https://example.org',title:'Source'}]});
 const text=makePackage(s.data,[id]),full=makePackage(s.data,[id],{photos:true});
 assert.equal(text.cars[0].realHistory.photos,undefined);assert.deepEqual(full.cars[0].realHistory.photos,[photo]);assert.equal(text.cars[0].privateNotes,undefined);
 assert.deepEqual(validatePackage(full),full);
 const other=new Store();other.mutate('submission.add',{package:full});let sub=other.data.submissions[0];other.mutate('submission.review',{id:sub.id,carId:id,revision:0,decision:'accept'});
 text.cars[0].realHistory.team='Corrected team';other.mutate('submission.add',{package:text});sub=other.data.submissions[0];other.mutate('submission.review',{id:sub.id,carId:id,revision:other.data.cars[0].revision,decision:'accept'});
 assert.equal(other.data.cars[0].realHistory.team,'Corrected team');assert.deepEqual(other.data.cars[0].realHistory.photos,[photo]);
});
test('manual conditions are historical and legacy tests retain unknown conditions',()=>{
 const {s,id}=setup();s.mutate('test.add',{carId:id,track:'Circuit',lane:'1',driver:'Alex',voltage:'12',direction:'Clockwise',magnetStatus:'Without magnets',laps:'5',best:'8.2',average:'8.4'});
 s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{technical:{magnets:'Now fitted'}}});
 let r=pace.runs(s.data)[0];assert.equal(r.direction,'Clockwise');assert.equal(r.magnetStatus,'Without magnets');assert.equal(r.best,8200);assert.equal(r.median,null);assert.equal(r.sustained5,null);
 assert.throws(()=>s.mutate('test.add',{carId:id,direction:'sideways'}),/direction/);
 const legacy=s.snapshot();delete legacy.tests[0].direction;delete legacy.tests[0].magnetStatus;assert.equal(pace.runs(migrate(legacy))[0].direction,'Unknown');
});
function laps(values){let end=0;return values.map((n,i)=>({number:i+1,durationMs:n,endedAtMs:end+=n,valid:true,pit:false,recordEligible:true}));}
test('pace distinguishes eligible best, median and uninterrupted runs without bridging gaps or pit/invalid laps',()=>{
 let data=laps([1000,2000,3000,4000,5000,6000]);data[0].recordEligible=false;
 let m=pace.measured(data);assert.equal(m.best,2000);assert.equal(m.median,3500);assert.equal(m.sustained5,3000);assert.equal(m.sustained10,null);
 data[2].pit=true;m=pace.measured(data);assert.equal(m.validLaps,5);assert.equal(m.sustained5,null);
 data=laps([1000,1000,1000,1000,1000]);data[2].valid=false;assert.equal(pace.measured(data).sustained5,null);
 data=laps([1000,1000,1000,1000,1000]);data[2].number=99;assert.equal(pace.measured(data).sustained5,null);
 data=laps([1000,1000,1000,1000,1000]);data.slice(2).forEach(l=>l.endedAtMs+=100);assert.equal(pace.measured(data).sustained5,null);
 assert.equal(pace.measured([]).median,null);assert.equal(pace.median([3,1,2,4]),2.5);
});
test('Timing runs preserve captured configurations and split lanes, heats and endurance drivers',()=>{
 const f=fixtures();timing.receive(f.store,f.multi);timing.receive(f.store,f.endurance);
 let runs=pace.runs(f.store.data);assert.equal(runs.length,6);assert.ok(runs.some(r=>r.driver==='Sam Example'));assert.equal(new Set(runs.map(r=>r.lane)).size,2);
 f.store.mutate('car.save',{id:'car-a',revision:f.store.data.cars[0].revision,data:{technical:{motor:'New motor'}}});
 assert.ok(pace.runs(f.store.data,'car-a').every(r=>r.technical.motor==='21.5k'&&r.direction==='Unknown'&&r.voltage==='Unknown'&&r.magnetStatus==='Unknown'));
});
test('corrections replace pace contributions and withdrawals and virtual participants disappear',()=>{
 const f=fixtures();timing.receive(f.store,f.normal);assert.equal(pace.runs(f.store.data)[0].best,10000);
 timing.receive(f.store,f.correction);assert.equal(pace.runs(f.store.data)[0].best,11000);assert.equal(pace.runs(f.store.data).length,1);
 timing.receive(f.store,f.withdrawal);assert.equal(pace.runs(f.store.data).length,0);
 const virtual=structuredClone(f.normal);virtual.sessionId='virtual';virtual.participants[0].kind='virtual';virtual.participants[0].carId=null;virtual.participants[0].configuration=null;virtual.participants[0].laps.forEach(l=>{l.countsForDistance=false;l.recordEligible=false;});timing.receive(f.store,virtual);assert.equal(pace.runs(f.store.data).length,0);
});
test('comparison uses scoped tracks, matching conditions and per-car fastest run, with optional lane/driver relaxation',()=>{
 const base={id:'a',carId:'a',kind:'timing',trackKey:'source-1/track-1',direction:'Clockwise',voltage:'12',magnetStatus:'Without magnets',lane:'1',driver:'Alex',best:10000,median:10100,date:'2026-01-01'};
 const b={...base,id:'b',carId:'b',best:10100},runs=[base,b,{...b,id:'b2',best:10050},{...b,id:'different-source',carId:'c',trackKey:'source-2/track-1'},{...b,id:'different-voltage',carId:'d',voltage:'Unknown'},{...b,id:'different-lane',carId:'e',lane:'2'},{...b,id:'archived',carId:'f'},{...b,id:'different-driver',carId:'g',driver:'Sam'}];
 const cars=['a','b','c','d','e','f','g'].map(id=>({id,name:id,archived:id==='f'}));let result=pace.compare(runs,cars,'a');assert.deepEqual(result.rows.map(r=>r.car.id),['b']);assert.equal(result.rows[0].deltaMs,50);
 result=pace.compare(runs,cars,'a',{sameLane:false,sameDriver:false});assert.deepEqual(result.rows.map(r=>r.car.id),['b','e','g']);
 assert.equal(pace.compare(runs,cars,'a',{tolerance:.049}).rows.length,0);assert.equal(pace.compare(runs,cars,'a',{tolerance:.05}).rows.length,1);
 assert.throws(()=>pace.compare(runs,cars,'a',{tolerance:-1}));assert.throws(()=>pace.compare(runs,cars,'a',{metric:'average'}));
});
test('unknown conditions cannot be mistaken for known conditions, manual tracks cannot merge with Timing',()=>{
 const {s,id}=setup();s.mutate('test.add',{carId:id,track:'Club circuit',best:'10'});const manual=pace.runs(s.data)[0],f=fixtures();timing.receive(f.store,f.normal);const measured=pace.runs(f.store.data)[0];assert.equal(pace.compatible(manual,measured,{sameLane:false,sameDriver:false}),false);
 assert.equal(pace.compatible({...manual,direction:'Clockwise'},manual),false);
});
