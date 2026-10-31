const test=require('node:test'),assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
const Model=require('../renderer/build-model.js'),domain=require('../renderer/domain.js');
const act=(s,a,p)=>s.mutate(a,{revision:s.data.revision,...p}).result;
const row=(id,slot)=>({key:id,partId:id,name:id,slot,position:slot,quantity:1});
const gear=(id,teeth)=>({id,name:id,catalogue:{specifications:[{name:'Teeth',value:teeth,unit:'teeth'}]}});

test('build calculator uses exact gearing before rounding the display',()=>{
  for(const [p,g,expected] of [['9','27','3.00:1'],['8','27','3.375:1'],['13','31','2.385:1']]){
    const data={...Model.blank(),gearing:{pinion:p,gear:g}},values=Model.gearing(data,{parts:[],assemblies:[]});
    assert.equal(domain.gearRatioText(values.pinion.value,values.gear.value),expected);
    assert.equal(domain.gearRatio(values.pinion.value,values.gear.value),Number(g)/Number(p));
  }
});
test('explicit tooth specifications follow loose parts and assembly components; overrides are optional',()=>{
  const db={parts:[gear('p','9'),gear('g','27'),gear('other','31')],assemblies:[{id:'a',components:[{partId:'g',field:'gearPart'}]}]};
  const data={...Model.blank(),parts:[row('p','pinionPart')],assemblies:[{id:'a'}]};
  assert.equal(Model.gearing(data,db).gear.value,'27');
  db.assemblies[0].components[0].partId='other';assert.equal(Model.gearing(data,db).gear.value,'31');
  data.gearing.gear='28';assert.equal(Model.gearing(data,db).gear.value,'28');
  data.gearing.gear='';assert.equal(Model.gearing(data,db).gear.value,'31');
  data.assemblies=[];assert.equal(Model.gearing(data,db).gear.value,'');
});
test('names, malformed specifications, conflicting counts and invalid overrides never become guessed teeth',()=>{
  const data={...Model.blank(),parts:[row('p','pinionPart')]};
  for(const p of [{id:'p',name:'NSR 9T 1234'},gear('p','9.5'),gear('p','0'),{...gear('p','9'),catalogue:{specifications:[{name:'Teeth',value:'9',unit:'mm'}]}},{...gear('p','9'),catalogue:{specifications:[{name:'Teeth',value:'9',unit:''},{name:'Tooth count',value:'10',unit:''}]}}]){
    assert.equal(Model.gearing(data,{parts:[p],assemblies:[]}).pinion.value,'');
  }
  data.gearing.pinion='1.5';assert.equal(Model.gearing(data,{parts:[gear('p','9')],assemblies:[]}).pinion.value,'');
});
test('manual gearing survives drafts and backups and reaches car, setup and creation history',()=>{
  const s=new Store(),id=act(s,'part.save',{data:{name:'Motor',tracking:'quantity',quantity:1}});
  const data={...Model.blank(),name:'Geared car',parts:[row(id,'motor')],gearing:{pinion:'9',gear:'27'}};
  const draftId=act(s,'build.draft.save',{data}),restored=new Store();restored.restore(s.snapshot(),0);
  assert.deepEqual(restored.data.buildDrafts[0].data.gearing,data.gearing);
  const carId=act(s,'build.create',{data:s.data.buildDrafts[0].data,draftId,confirmed:true});
  for(const technical of [s.data.cars.find(c=>c.id===carId).technical,s.data.setups[0].technical,...s.data.events.filter(e=>e.carId===carId).map(e=>e.technical)]){
    assert.equal(technical.pinion,'9');assert.equal(technical.gear,'27');
  }
});
test('old drafts and partial gearing still work, invalid tooth counts fail without changing records',()=>{
  const s=new Store(),id=act(s,'part.save',{data:{name:'Motor',tracking:'quantity',quantity:2}});
  const data={...Model.blank(),name:'Partial build',parts:[row(id,'motor')]};delete data.gearing;
  act(s,'build.draft.save',{data});assert.deepEqual(s.data.buildDrafts[0].data.gearing,{pinion:'',gear:''});
  for(const value of ['0','-1','9.5','NaN','9007199254740992',9,null]){
    const before=s.snapshot();assert.throws(()=>act(s,'build.create',{data:{...data,gearing:{pinion:value,gear:'27'}},confirmed:true}),/tooth count/);assert.deepEqual(s.snapshot(),before);
  }
  act(s,'build.create',{data:{...data,gearing:{pinion:'9',gear:''}},confirmed:true});assert.equal(s.data.cars[0].technical.pinion,'9');assert.equal(s.data.cars[0].technical.gear,undefined);
});
