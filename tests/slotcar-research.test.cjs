'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const M=require('../renderer/slotcar-research-model.js'),{Store}=require('../src/store.cjs');
const target={databaseId:'db-a',carId:'car-a'},car={id:'car-a',name:'Product',maker:'Example maker',reference:'ABC-01-R',scale:'1:32',technical:{motor:'Upgraded motor'},factory:{motor:'Old factory motor',technicalNotes:'My own notes'}};
function filled(){const k=M.kit({id:target.databaseId},car),url='https://example.org/product/ABC-01-R';k.sources=[{title:'Manufacturer product',url}];k.identification={status:'exact',maker:car.maker,reference:car.reference,scale:car.scale,sourceUrls:[url],uncertainty:'Check production batch.'};for(const [key,value]of [['model','GT model'],['factory.motor','Original motor'],['factory.pinion','9'],['factory.gear','27'],['factory.ratedRpm','21500'],['factory.ratedVoltage','12']])k.research[key]={value,sourceUrls:[url],uncertainty:key==='factory.motor'?'As supplied in this edition.':''};return k;}
test('URL-free research preserves AI verification notes and selective import',()=>{
 const k=M.kit({id:target.databaseId},car);
 assert.equal(k.sources,undefined);assert.equal(k.identification.sourceUrls,undefined);
 assert.match(k.instructions.join(' '),/at least five independent sources/);
 assert.match(k.instructions.join(' '),/three or more independent sources/);
 k.identification={status:'exact',maker:car.maker,reference:car.reference,scale:car.scale,uncertainty:'Exact variant checked.'};
 k.research['factory.motor']={value:'Original motor',uncertainty:'AI-reported verified: 3 of 5 independent sources agree.'};
 k.research.model={value:'GT model',uncertainty:'Only two sources available; not verified.'};
 const result=M.preview(k,target,car),index=result.proposals.findIndex(p=>p.field==='factory.motor'),data=M.patch(car,result,[index]);
 assert.deepEqual(result.sources,[]);assert.deepEqual(result.identification.sourceUrls,[]);
 assert.equal(data.model,undefined);assert.equal(data.technical,undefined);assert.equal(data.factory.motor,'Original motor');
 assert.match(data.factory.technicalNotes,/3 of 5/);assert.doesNotMatch(data.factory.technicalNotes,/Sources:|Product match sources:/);
 k.sources=[];k.identification.sourceUrls=[];k.research['factory.motor'].sourceUrls=[];
 assert.equal(M.preview(k,target,car).proposals.length,2);
 for(const change of [x=>x.sources=null,x=>x.identification.sourceUrls=null,x=>x.research.model.sourceUrls='not an array']){const bad=structuredClone(k);change(bad);assert.throws(()=>M.preview(bad,target,car));}
});
test('slotcar kit requires maker and reference, contains English instructions and excludes private/current data',()=>{
 const k=M.kit({id:'db-a'},{...car,privateNotes:'SECRET',owner:'PRIVATE',picture:'HUGE'});assert.deepEqual(k.target,target);assert.equal(k.language,'en');assert.match(k.instructions.join(' '),/English/);assert.match(k.instructions.join(' '),/NOT the full-size/);assert.doesNotMatch(JSON.stringify(k),/SECRET|PRIVATE|HUGE|Upgraded motor|My own notes/);assert.throws(()=>M.kit({id:'db-a'},{...car,maker:''}),/manufacturer/);assert.throws(()=>M.kit({id:'db-a'},{...car,reference:' '}),/reference/);
});
test('slotcar import requires exact product identity and matching car and collection',()=>{
 assert.equal(M.preview(filled(),target,car).proposals.length,6);
 for(const modify of [k=>k.target.carId='other',k=>k.target.databaseId='other',k=>k.reference.reference='ABC-01',k=>k.identification.reference='ABC-01',k=>k.identification.maker='Other',k=>k.identification.scale='1:24',k=>k.identification.status='ambiguous',k=>k.identification.status='not-found',k=>k.version=2,k=>k.language='de']){const k=filled();modify(k);assert.throws(()=>M.preview(k,target,car));}
 assert.throws(()=>M.preview(filled(),target,{...car,reference:'ABC-02'}),/changed/);
});
test('slotcar import rejects unsupported fields, unsafe sources and malformed values',()=>{
 for(const modify of [k=>k.research.owner={value:'private'},k=>k.research['factory.motor'].sourceUrls=['https://missing.example.org'],k=>k.sources[0].url='javascript:alert(1)',k=>k.sources[0].url='https://user:password@example.org',k=>k.research['factory.motor'].value={},k=>k.research['factory.motor'].value='x'.repeat(501),k=>k.research['factory.motor'].uncertainty='x'.repeat(1001),k=>k.research['factory.ratedRpm'].value='21.5k',k=>k.research['factory.pinion'].value='9.5',k=>k.research['factory.pinion'].value='0',k=>k.research['factory.ratedVoltage'].value='12 V',k=>k.sources=Array(21).fill(k.sources[0])]){const k=filled();modify(k);assert.throws(()=>M.preview(k,target,car));}
 const k=filled();k.research=JSON.parse('{"__proto__":{"value":"bad"}}');assert.throws(()=>M.preview(k,target,car),/Unsupported/);
});
test('slotcar ratings use existing calculator enum values and no guessed units',()=>{
 const k=filled(),sourceUrls=k.identification.sourceUrls;for(const [field,value]of [['factory.motorType','Brushed DC'],['factory.torqueType','Stall'],['factory.motorTorque','285'],['factory.torqueVoltage','12']])k.research[field]={value,sourceUrls,uncertainty:''};assert.equal(M.preview(k,target,car).proposals.length,10);k.research['factory.motorTorque'].value='285 grams';assert.throws(()=>M.preview(k,target,car),/positive number/);
});
test('selective slotcar import changes factory reference, preserves current setup, and records evidence',()=>{
 const result=M.preview(filled(),target,car),index=result.proposals.findIndex(p=>p.field==='factory.motor'),before=JSON.stringify(car),data=M.patch(car,result,[index]);assert.equal(data.factory.motor,'Original motor');assert.equal(data.technical,undefined);assert.equal(data.model,undefined);assert.match(data.factory.technicalNotes,/My own notes/);assert.match(data.factory.technicalNotes,/As supplied/);assert.match(data.factory.technicalNotes,/Check production batch/);assert.match(data.factory.technicalNotes,/https:\/\/example.org/);assert.equal(JSON.stringify(car),before);assert.equal(M.patch({...car,factory:data.factory},result,[index]).factory.technicalNotes,data.factory.technicalNotes);assert.throws(()=>M.patch(car,result,[]),/Select/);assert.throws(()=>M.patch(car,result,[999]),/Invalid/);
});
test('current initialization requires an empty configuration and caps appended evidence',()=>{
 const result=M.preview(filled(),target,car),ids=result.proposals.map((_,i)=>i),data=M.patch({...car,technical:{}},result,ids,true);assert.throws(()=>M.patch(car,result,ids,true),/no current/);assert.throws(()=>M.patch({...car,technical:{},hasInstalledParts:true},result,ids,true),/no current/);assert.equal(data.model,'GT model');assert.equal(data.technical.motor,'Original motor');assert.equal(data.technical.ratedRpm,'21500');assert.equal(data.factory.motor,'Original motor');assert.throws(()=>M.patch({...car,factory:{technicalNotes:'x'.repeat(20000)}},result,ids),/20,000/);
});
test('research changes persist through deferred SQLite saves without touching installed stock or historical setups',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-slotcar-research-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let s=new Store(path.join(dir,'db.sqlite'));
 const id=s.mutate('car.save',{data:{name:'Product',maker:car.maker,reference:car.reference,scale:car.scale,technical:{pinion:'8'},factory:{technicalNotes:'Keep notes'}}}).result,part=s.mutate('part.save',{data:{name:'Upgraded motor',quantity:1,tracking:'individual'}}).result;
 s.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor'});s.mutate('setup.save',{carId:id,name:'Before research'});const before=s.snapshot();s=new Store(s.file,{deferred:true});const c=s.data.cars.find(c=>c.id===id),k=filled();k.target={databaseId:s.data.id,carId:id};k.research.category={value:'GT'};k.research.raceClass={value:'GT3'};delete k.sources;delete k.identification.sourceUrls;for(const value of Object.values(k.research))delete value.sourceUrls;const result=M.preview(k,k.target,c),data=M.patch(c,result,result.proposals.map((_,i)=>i));
 await s.mutateAsync('car.save',{id,revision:c.revision,data},{snapshot:false});const after=new Store(s.file).snapshot();assert.equal(after.cars[0].technical.motor,'Upgraded motor');assert.equal(after.cars[0].technical.pinion,'8');assert.equal(after.cars[0].technical.gear,undefined);assert.equal(after.cars[0].category,'GT');assert.equal(after.cars[0].raceClass,'GT3');assert.equal(after.cars[0].factory.motor,'Original motor');assert.deepEqual(after.installations,before.installations);assert.deepEqual(after.parts,before.parts);assert.deepEqual(after.setups,before.setups);assert.match(after.cars[0].factory.technicalNotes,/Keep notes/);assert.throws(()=>s.mutate('car.save',{id,revision:c.revision,data}),/changed/);
});

test('product category and racing class are optional, selectable text fields; ownership remains manual',()=>{
 const k=filled();k.research.category={value:'GT',uncertainty:'3 of 5 sources agree'};k.research.raceClass={value:'GT3',uncertainty:'Represented class; check club rules'};
 const result=M.preview(k,target,car),category=result.proposals.findIndex(p=>p.field==='category'),raceClass=result.proposals.findIndex(p=>p.field==='raceClass');
 const partial=M.patch(car,result,[category]);assert.equal(partial.category,'GT');assert.equal(partial.raceClass,undefined);
 const data=M.patch(car,result,[category,raceClass]);assert.equal(data.raceClass,'GT3');assert.match(data.factory.technicalNotes,/Racing class: GT3/);
 const s=new Store(),id=s.mutate('car.save',{data:{name:'Product',maker:car.maker,reference:car.reference,owner:'Private owner',location:'Home',category:'Old category',raceClass:'Local rules'}}).result;
 s.mutate('car.save',{id,revision:s.data.cars[0].revision,data});assert.equal(s.data.cars[0].raceClass,'GT3');assert.equal(s.data.cars[0].category,'GT');assert.equal(s.data.cars[0].owner,'Private owner');assert.equal(s.data.cars[0].location,'Home');
 const old=filled();delete old.research.category;delete old.research.raceClass;assert.equal(M.preview(old,target,car).proposals.length,6);
 for(const field of ['owner','serial','condition','price','location']){const bad=filled();bad.research[field]={value:'Do not import'};assert.throws(()=>M.preview(bad,target,car),/Unsupported/);}
 assert.match(M.instructions.join(' '),/club rules/);assert.match(M.instructions.join(' '),/five independent sources/);
});
