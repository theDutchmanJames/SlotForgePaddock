'use strict';
// Disposable synthetic database; never opens an installed profile.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),catalogue=require('../src/catalogue-import.cjs'),collection=require('../src/collection.cjs'),inventory=require('../src/inventory.cjs'),workshop=require('../src/workshop.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-review-bench-'));
try{
 const file=path.join(dir,'db.sqlite'),s=new Store(file),act=(a,p={})=>s.mutate(a,{revision:s.data.revision,...p},{snapshot:false}).result;
 const car=act('car.save',{data:{name:'Benchmark car',maker:'Old maker'}}),part=act('part.save',{data:{name:'Motor',maker:'Example',reference:'M1',quantity:5,tracking:'quantity'}});
 act('part.install',{carId:car,partId:part,quantity:1,field:'motor'});act('setup.save',{carId:car,name:'Setup'});const setup=s.data.setups[0].id;
 s.transact(d=>{for(let i=1;i<500;i++)d.cars.push({...d.cars[0],id:'car-'+i,maker:'Other'});for(let i=1;i<3000;i++)d.parts.push({...d.parts[0],id:'part-'+i,reference:'M'+(i+1),notes:'Description '.repeat(80)});});
 const input={format:'slotforge-catalogue',version:1,products:[{kind:'part',name:'Motor',manufacturer:'Example',reference:'M1',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'Single motor',sourceUrl:'https://example.com/motor',checkedDate:'2026-10-31',reviewNotes:'',specifications:[]}]};
 const context={textFields:require('../src/store.cjs').TEXT_FIELDS,techFields:require('../src/store.cjs').TECH_FIELDS};
 const cases=[
  ['Bulk preview','bulk.preview',{ids:[car],updates:{location:'Shelf'}},(store,p)=>collection.applyBulk(store.snapshot(),p,true)],
  ['Choice preview','choice.preview',{field:'maker',from:'Old maker',to:'Correct maker',updateCars:true},(store,p)=>collection.renameChoice(store.snapshot(),p,context,true)],
  ['Setup preview','setup.preview',{id:setup,selections:{0:'p:'+part}},(store,p)=>workshop.applySetup(store.snapshot(),p,true)],
  ['Part deletion preview','part.delete',{id:part},(store,p)=>inventory.deletion(store.data,p.id)],
  ['Catalogue preview','catalogue.preview',{input},(store,p)=>catalogue.preview(store.data,p.input)]
 ];
 const reports=[];
 for(const [name,action,input,old]of cases)for(const broad of [true,false]){const samples=[];for(let i=0;i<3;i++){const store=new Store(file,{deferred:true}),state=store.deferredState,p={revision:store.data.revision,...input},start=performance.now();if(broad)old(store,p);else store.plan(action,p);samples.push({ms:+(performance.now()-start).toFixed(1),...state.stats});}reports.push({name,mode:broad?'previous broad preview':'targeted preview',samples});}
 console.log(JSON.stringify({collection:{cars:500,parts:3000},note:'Preview preparation only, excluding startup and renderer work. Broad baseline omits its final validation, so it is a conservative comparison.',reports},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
