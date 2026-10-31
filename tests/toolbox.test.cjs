const test=require('node:test'),assert=require('node:assert/strict');
const {Store,migrate,makePackage}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
const catalogue=require('../renderer/catalogue.js');
const photo='data:image/png;base64,iVBORw0KGgo=';
const act=(s,action,p={})=>s.mutate(action,{revision:s.data.revision,...p}).result;
const part=(s,quantity=4)=>act(s,'part.save',{data:{name:'Rear tyre',category:'Tyres',quantity,tracking:'quantity',picture:photo,material:'Rubber',dimensions:'20 × 10 mm'}});
const supply=(s,data={})=>act(s,'supply.save',{data:{name:'Bearing oil',category:'Cleaning & lubrication',kind:'Consumable',quantity:2,remaining:'30.5',minimum:10,unit:'ml',picture:photo,...data}});
test('schema 4 migration preserves identities and custom categories, and leaves input untouched',()=>{
  const s=new Store();const id=part(s),old=s.snapshot();old.schema=4;delete old.supplies;old.parts[0].category='Handmade pickup';delete old.parts[0].partType;
  const next=migrate(old);assert.equal(next.schema,9);assert.deepEqual(next.supplies,[]);assert.equal(next.parts[0].id,id);assert.equal(next.parts[0].category,'Other & custom parts');assert.equal(next.parts[0].partType,'Handmade pickup');assert.equal(next.parts[0].picture,photo);assert.equal(old.schema,4);assert.equal(old.parts[0].category,'Handmade pickup');
});
test('part metadata and photos survive edits, stock returns and complete restore',()=>{
  const s=new Store(),p=part(s),c=act(s,'car.save',{data:{name:'Car'}});assert.equal(s.data.parts[0].category,'Wheels & tyres');assert.equal(s.data.parts[0].partType,'Tyre');act(s,'part.install',{carId:c,partId:p,quantity:2,field:'rearTyres'});act(s,'part.remove',{id:s.data.installations[0].id,destination:'spares'});
  assert.equal(s.data.parts[1].material,'Rubber');assert.equal(s.data.parts[1].picture,photo);act(s,'part.save',{id:p,data:{name:'Corrected tyre',quantity:2,tracking:'quantity'}});assert.equal(s.data.parts[0].picture,photo);const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.parts,s.data.parts);assert.throws(()=>act(s,'part.save',{data:{name:'Bad photo',quantity:1,tracking:'quantity',picture:'https://example.com/image.png'}}));
});
test('toolbox supports tools, fractional consumable amounts, zero and unknown',()=>{
  const s=new Store();supply(s);supply(s,{name:'Unknown amount',remaining:'',minimum:''});supply(s,{name:'Empty',remaining:0});supply(s,{name:'Hex driver',category:'Hand tools',kind:'Tool / equipment',quantity:1});assert.equal(s.data.supplies[0].remaining,30.5);assert.equal(s.data.supplies[1].remaining,null);assert.equal(s.data.supplies[2].remaining,0);assert.equal(s.data.supplies[3].remaining,null);assert.equal(s.data.supplies[3].unit,'');
});
test('amount updates retain prior units and history; archive can be reversed',()=>{
  const s=new Store(),id=supply(s),original=structuredClone(s.data.supplies[0]);act(s,'supply.save',{id,data:{...original,remaining:5,quantity:1}});assert.deepEqual(s.data.supplies[0].history[0].before,{kind:'Consumable',quantity:2,remaining:30.5,minimum:10,unit:'ml'});assert.equal(s.data.supplies[0].history[0].after.remaining,5);act(s,'supply.archive',{id});assert.equal(s.data.supplies[0].archived,true);act(s,'supply.archive',{id});assert.equal(s.data.supplies[0].archived,false);
});
test('invalid, stale and failed toolbox mutations are atomic',()=>{
  const s=new Store(),id=supply(s),before=s.snapshot();for(const data of [{remaining:-1},{remaining:Infinity},{remaining:true},{quantity:1.5},{quantity:''},{unit:''},{category:'Unknown'}]){assert.throws(()=>act(s,'supply.save',{id,data:{...s.data.supplies[0],...data}}));assert.deepEqual(s.snapshot(),before);}assert.throws(()=>s.mutate('supply.archive',{id,revision:0}));s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'supply.archive',{id}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('supplies survive full backups while public exports and network views exclude them and part photos',async t=>{
  const s=new Store();supply(s,{name:'PRIVATE toolbox item'});part(s);const c=act(s,'car.save',{data:{name:'Public car'}}),restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.supplies,s.data.supplies);assert.equal(JSON.stringify(makePackage(s.data,[c])).includes('PRIVATE'),false);const host=new Network(s);t.after(()=>host.stop());const info=await host.start();const body=await(await fetch('http://127.0.0.1:'+info.port+'/v1/collection',{headers:{Authorization:'Bearer '+info.code}})).json();assert.equal(JSON.stringify(body).includes('PRIVATE'),false);assert.equal(JSON.stringify(body).includes(photo),false);
});
test('restored toolbox data rejects malformed photo, amounts, identities and histories',()=>{
  const s=new Store();supply(s);for(const change of [d=>d.supplies.push(structuredClone(d.supplies[0])),d=>d.supplies[0].remaining='30',d=>d.supplies[0].picture='javascript:bad',d=>d.supplies[0].history=[{date:'today',before:{},after:{}}]]){const bad=s.snapshot();change(bad);assert.throws(()=>migrate(bad));}
});
test('Add setup rejects a car changed after its snapshot dialog opened',()=>{
  const s=new Store(),id=act(s,'car.save',{data:{name:'Snapshot car'}}),revision=s.data.cars[0].revision;act(s,'car.save',{id,revision,data:{technical:{weight:'80'}}});assert.throws(()=>s.mutate('setup.save',{carId:id,name:'Stale',carRevision:revision}),/car changed/);assert.equal(s.data.setups.length,0);
});
test('category catalogue contains the agreed parts and toolbox groups',()=>{assert.equal(Object.keys(catalogue.parts).length,11);assert.equal(Object.keys(catalogue.supplies).length,7);assert.equal(catalogue.classify('Motor').category,'Motors & motor parts');});
