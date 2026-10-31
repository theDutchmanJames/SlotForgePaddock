const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const icons=require('../renderer/icon-catalogue.js'),catalogue=require('../renderer/catalogue.js');
const {Store,migrate}=require('../src/store.cjs');
const act=(s,action,p)=>s.mutate(action,{revision:s.data.revision,...p}).result;
const part=s=>act(s,'part.save',{data:{name:'Motor',category:'Motors & motor parts',partType:'Motor',tracking:'quantity',quantity:4,iconId:'long-can-motor',iconColour:'blue'}});
test('Every part and supply type has an automatic icon with bundled vector artwork',()=>{
 const art=vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../renderer/icon-art.js'),'utf8')+';slotforgeIconArt');
 assert.equal(icons.icons.length,113);assert.equal(new Set(icons.icons.map(i=>i.id)).size,113);assert.deepEqual(Object.keys(art).sort(),icons.icons.map(i=>i.id).sort());
 for(const [category,types]of Object.entries({...catalogue.parts,...catalogue.supplies}))for(const partType of types){assert.ok(Object.hasOwn(icons.types,partType),partType);const id=icons.automatic({category,partType});assert.equal(id,icons.types[partType]);assert.ok(art[id],id);assert.ok(fs.existsSync(path.join(__dirname,'../renderer/icons',id+'.svg')));}
 for(const [id,svg]of Object.entries(art))assert.doesNotMatch(svg,/<script|<foreignObject|\bhref\s*=|\bon\w+\s*=|url\(|#[0-9a-f]{6}/i,id);
});
test('Automatic follows category/type while manual choices survive category changes',()=>{
 assert.equal(icons.resolve({category:'Wheels & tyres',partType:'Tyre'}),'racing-tire');assert.equal(icons.resolve({category:'Motors & motor parts',partType:'Tyre'}),'short-can-motor');assert.equal(icons.resolve({category:'Custom category'}),'other-part');assert.equal(icons.resolve({category:'Wheels & tyres',iconId:'long-can-motor'}),'long-can-motor');
});
test('Appearance persists through ordinary edits, backup restore and returned stock',()=>{
 const s=new Store(),id=part(s),car=act(s,'car.save',{data:{name:'Car'}});act(s,'part.save',{id,data:{name:'Motor renamed',quantity:4,tracking:'quantity'}});assert.equal(s.data.parts[0].iconId,'long-can-motor');assert.equal(s.data.parts[0].iconColour,'blue');
 act(s,'part.install',{carId:car,partId:id,quantity:1,field:'motor'});act(s,'part.remove',{id:s.data.installations[0].id,destination:'spares'});assert.equal(s.data.parts[1].iconId,'long-can-motor');assert.equal(s.data.parts[1].iconColour,'blue');assert.deepEqual(migrate(s.snapshot()).parts,s.data.parts);
 act(s,'part.appearance',{id,data:{iconId:'',iconColour:'auto'}});assert.equal(s.data.parts[0].iconId,'');assert.equal(s.data.parts[0].iconColour,'auto');
});
test('Reserved assembly components can change appearance without changing inventory',()=>{
 const s=new Store(),id=part(s);act(s,'assembly.create',{name:'Motor assembly',components:[{partId:id,quantity:1,field:'motor',position:'Motor'}]});const reserved=s.data.assemblies[0].components[0].partId,before=s.snapshot();
 act(s,'part.appearance',{id:reserved,data:{iconId:'brushless-motor',iconColour:'purple',quantity:999,name:'Ignored'}});assert.deepEqual(s.data.assemblies,before.assemblies);assert.deepEqual(s.data.installations,before.installations);assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),4);assert.equal(s.data.parts.find(p=>p.id===reserved).name,'Motor');assert.equal(s.data.parts.find(p=>p.id===reserved).iconColour,'purple');
});
test('Supply appearance survives amount changes and does not manufacture amount history',()=>{
 const s=new Store(),id=act(s,'supply.save',{data:{name:'Oil',category:'Cleaning & lubrication',partType:'Bearing oil',kind:'Consumable',quantity:1,remaining:10,unit:'ml',iconId:'bearing-oil',iconColour:'amber'}});
 const first=structuredClone(s.data.supplies[0]);act(s,'supply.save',{id,data:{...first,iconColour:'green'}});assert.equal(s.data.supplies[0].history.length,0);const data={...s.data.supplies[0],remaining:5};delete data.iconId;delete data.iconColour;act(s,'supply.save',{id,data});assert.equal(s.data.supplies[0].iconColour,'green');assert.equal(s.data.supplies[0].history.length,1);assert.deepEqual(migrate(s.snapshot()).supplies,s.data.supplies);
});
test('Invalid icons, CSS-like colours, stale edits and failed writes leave data intact',()=>{
 const s=new Store(),id=part(s),before=s.snapshot();for(const data of [{iconId:'../../secret'},{iconId:'__proto__'},{iconId:7},{iconColour:'#fff'},{iconColour:'url(https://example.com)'},{iconColour:'constructor'}]){assert.throws(()=>act(s,'part.appearance',{id,data}));assert.deepEqual(s.snapshot(),before);}
 assert.throws(()=>s.mutate('part.appearance',{id,revision:0,data:{iconColour:'red'}}),/changed/);s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'part.appearance',{id,data:{iconColour:'red'}}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('Existing records without appearance fields remain valid; invalid backup choices are refused',()=>{
 const s=new Store();part(s);const old=s.snapshot();delete old.parts[0].iconId;delete old.parts[0].iconColour;assert.equal(migrate(old).schema,8);const bad=s.snapshot();bad.parts[0].iconId='javascript:bad';assert.throws(()=>migrate(bad),/icon/);
});
