const test=require('node:test'),assert=require('node:assert/strict');
const {Store,migrate,makePackage}=require('../src/store.cjs');
const C=require('../src/catalogue-import.cjs');
const taxonomy=require('../renderer/catalogue.js');
const product=(extra={})=>({kind:'part',name:'King motor',manufacturer:'Example Racing',reference:'M-01',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'Single motor',sourceUrl:'https://example.com/motor',checkedDate:'2026-10-31',reviewNotes:'',specifications:[{name:'RPM',value:'21500',unit:'rpm'}],...extra});
const input=(products=[product()])=>({format:'slotforge-catalogue',version:1,products});
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
const apply=(s,pack,selections)=>act(s,'catalogue.apply',{input:pack,selections,confirmed:true});
test('the kit includes all categories, instructions and isolated fictional examples',()=>{
  const kit=C.kit();assert.deepEqual(kit.reference.parts,taxonomy.parts);assert.deepEqual(kit.reference.supplies,taxonomy.supplies);assert.deepEqual(kit.products,[]);assert.match(kit.instructions,/do not invent/i);assert.throws(()=>C.parse(kit),/empty template/);
});

test('AI classification guidance uses only supported pairs and the downloadable template stays current',()=>{
  const kit=C.kit(),options=kit.reference.classificationOptions;
  const expected=Object.entries({part:taxonomy.parts,supply:taxonomy.supplies}).flatMap(([kind,groups])=>Object.entries(groups).flatMap(([category,types])=>types.map(partType=>({kind,category,partType}))));
  assert.deepEqual(options,expected);
  for(const example of kit.reference.classificationGuide.examples){
    const r=C.parse(input([product({...example,name:example.description})]))[0];assert.deepEqual(r.errors,[],example.description);
  }
  assert.match(kit.instructions,/Generate the entire product list in English/);
  assert.match(kit.instructions,/Do not refresh checkedDate unless you actually recheck/);
  assert.match(kit.instructions,/Retain genuinely unresolved rows/);
  assert.deepEqual(JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname,'../docs/templates/slotforge-catalogue-kit.json'),'utf8')),kit);
});

test('additional catalogue types import as zero-stock items and survive backup validation',()=>{
  const examples=C.kit().reference.classificationGuide.examples;
  const pack=input(examples.map((e,i)=>product({...e,name:e.description,reference:'GUIDE-'+i})));
  const store=new Store();const result=apply(store,pack,pack.products.map((_,index)=>({index,create:true})));
  assert.deepEqual(result,{created:examples.length,updated:0});
  assert.ok([...store.data.parts,...store.data.supplies].every(p=>p.quantity===0));
  assert.deepEqual(migrate(store.snapshot()),store.snapshot());
});
test('selected products create zero-owned parts and supplies with packaging and units intact',()=>{
  const s=new Store(),pack=input([product({packSize:4,packUnit:'pieces'}),product({kind:'supply',name:'Oil',reference:'OIL',category:'Cleaning & lubrication',partType:'Bearing oil',supplyKind:'Consumable',specifications:[{name:'Capacity',value:'20',unit:'ml'}]}),product({name:'Not selected',reference:'SKIP'})]);
  const before=s.snapshot(),preview=s.plan('catalogue.preview',{input:pack});assert.deepEqual(s.snapshot(),before);assert.ok(preview.rows.every(r=>r.status==='new'));
  assert.deepEqual(apply(s,pack,[{index:0,create:true},{index:1,create:true}]),{created:2,updated:0});
  assert.equal(s.data.parts.length,1);assert.equal(s.data.parts[0].quantity,0);assert.equal(s.data.parts[0].catalogue.product.packSize,4);assert.equal(s.data.parts[0].catalogue.product.specifications[0].unit,'rpm');
  assert.equal(s.data.supplies.length,1);assert.equal(s.data.supplies[0].quantity,0);assert.equal(s.data.supplies[0].remaining,null);
  assert.deepEqual(migrate(s.snapshot()),s.snapshot());
});
test('reimporting identical catalogue facts is unchanged, including after a local stock rename',()=>{
  const s=new Store(),pack=input();apply(s,pack,[{index:0,create:true}]);const p=s.data.parts[0];act(s,'part.save',{id:p.id,data:{...p,name:'My own motor label',quantity:2}});
  const model=C.preview(s.data,pack);assert.equal(model.rows[0].status,'unchanged');assert.throws(()=>apply(s,pack,[{index:0,create:true}]),/Resolve|up to date/);assert.equal(s.data.parts.length,1);
});
test('approved metadata updates preserve installed stock, local notes, fields, icons and historical snapshots',()=>{
  const s=new Store(),pack=input();apply(s,pack,[{index:0,create:true}]);const p=s.data.parts[0];act(s,'part.save',{id:p.id,data:{...p,name:'Personal motor name',quantity:2,notes:'Private notes',location:'Drawer',iconColour:'blue'}});
  const car=act(s,'car.save',{data:{name:'Car'}});act(s,'part.install',{partId:p.id,carId:car,field:'motor',quantity:1});act(s,'setup.save',{carId:car,name:'Before import'});const before=s.snapshot();
  const changed=input([product({name:'Revised official name',specifications:[{name:'RPM',value:'22000',unit:'rpm'}]})]);assert.equal(C.preview(s.data,changed).rows[0].status,'update');
  apply(s,changed,[{index:0,targetId:p.id}]);assert.deepEqual(s.data.parts.map(({catalogue,updated,...v})=>v),before.parts.map(({catalogue,updated,...v})=>v));
  for(const key of ['cars','installations','setups','events','jobs','assemblies'])assert.deepEqual(s.data[key],before[key]);assert.equal(s.data.parts[0].catalogue.product.name,'Revised official name');
  assert.equal(JSON.stringify(makePackage(s.data,[car],{setups:true})).includes('https://example.com'),false);
});
test('existing manually entered products match by normalized manufacturer and reference',()=>{
  const s=new Store(),id=act(s,'part.save',{data:{name:'Different local name',maker:' EXAMPLE racing ',reference:' m-01 ',quantity:5,tracking:'quantity'}});
  const model=C.preview(s.data,input());assert.equal(model.rows[0].status,'update');assert.equal(model.rows[0].matches[0].id,id);apply(s,input(),[{index:0,targetId:id}]);assert.equal(s.data.parts[0].quantity,5);
});
test('name similarity never silently merges a different reference; ambiguous lots require a choice',()=>{
  const s=new Store();apply(s,input(),[{index:0,create:true}]);const similar=input([product({name:'King motor racing',reference:'M-02'})]);assert.equal(C.preview(s.data,similar).rows[0].status,'possible');
  assert.throws(()=>apply(s,similar,[{index:0}]),/Resolve/);apply(s,similar,[{index:0,create:true}]);assert.equal(s.data.parts.length,2);
  act(s,'part.save',{data:{name:'Another motor lot',maker:'Example Racing',reference:'M-01',quantity:1,tracking:'quantity'}});
  const changed=input([product({reviewNotes:'Verify torque'})]),model=C.preview(s.data,changed);assert.equal(model.rows[0].status,'ambiguous');assert.equal(model.rows[0].matches.length,2);
  assert.throws(()=>apply(s,changed,[{index:0,create:true}]),/Resolve/);apply(s,changed,[{index:0,targetId:model.rows[0].matches[1].id}]);
});
test('bad rows can be excluded while valid rows import; unsafe URLs and classifications are blocked',()=>{
  const s=new Store(),pack=input([product(),product({reference:'BAD',sourceUrl:'javascript:alert(1)',category:'Unknown'})]);const model=C.preview(s.data,pack);
  assert.equal(model.rows[1].status,'invalid');assert.ok(model.rows[1].errors.length>=2);assert.throws(()=>apply(s,pack,[{index:1,create:true}]),/errors/);
  apply(s,pack,[{index:0,create:true}]);assert.equal(s.data.parts.length,1);
});
test('missing facts remain unknown, while malformed numbers, dates, quantities and specifications are errors',()=>{
  const missing=product({reference:'',sourceUrl:'',checkedDate:'',packSize:null});const r=C.parse(input([missing]))[0];assert.equal(r.errors.length,0);assert.ok(r.warnings.length>=4);assert.equal(r.product.packSize,null);
  for(const changes of [{packSize:0},{packSize:'2'},{quantity:99},{checkedDate:'2026-02-30'},{sourceUrl:'file:///secret'},{sourceUrl:'https://user:password@example.com'},{specifications:[{name:'RPM',value:21000,unit:'rpm'}]}])assert.ok(C.parse(input([product(changes)]))[0].errors.length);
});
test('duplicate source products and repeated target updates are rejected',()=>{
  for(const pack of [input([product(),product({reference:' m-01 '})]),input([product({reference:''}),product({reference:''})])])assert.ok(C.parse(pack).every(r=>r.errors.some(e=>e.includes('Repeated'))));
  const s=new Store();apply(s,input(),[{index:0,create:true}]);const p=input([product({reference:'OTHER',name:'King motor'}),product({reference:'THIRD',name:'King motor'})]);const id=s.data.parts[0].id;
  assert.throws(()=>apply(s,p,[{index:0,targetId:id},{index:1,targetId:id}]),/same stock/);
});
test('stale reviews, forged selections, absent confirmation and failed persistence roll back the entire batch',()=>{
  const s=new Store(),pack=input(),revision=s.data.revision;act(s,'settings.save',{name:'Changed'});
  assert.throws(()=>s.mutate('catalogue.apply',{revision,input:pack,selections:[{index:0,create:true}],confirmed:true}),/changed/);
  const before=s.snapshot();for(const payload of [{selections:[{index:0,targetId:'fake'}],confirmed:true},{selections:[{index:0,create:true}]},{selections:[{index:0,create:true},{index:0,create:true}],confirmed:true}])assert.throws(()=>act(s,'catalogue.apply',{input:pack,...payload}));assert.deepEqual(s.snapshot(),before);
  s.persist=()=>{throw Error('Disk full');};assert.throws(()=>apply(s,pack,[{index:0,create:true}]),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('stored metadata is validated on restore and quantity is never inferred from a pack',()=>{
  const s=new Store();apply(s,input([product({packSize:10})]),[{index:0,create:true}]);assert.equal(s.data.parts[0].quantity,0);
  const bad=s.snapshot();bad.parts[0].catalogue.product.sourceUrl='javascript:bad';assert.throws(()=>migrate(bad),/catalogue/);
  assert.throws(()=>C.parse({format:'other',version:1,products:[]}));
});

test('reference-free catalogue products are recognized on reimport, including short names',()=>{
  for(const name of ['M2','King motor']){
    const s=new Store(),pack=input([product({name,reference:''})]);apply(s,pack,[{index:0,create:true}]);
    assert.equal(C.preview(s.data,pack).rows[0].status,'unchanged');
    const changed=input([product({name,reference:'',reviewNotes:'Updated source facts'})]);
    const preview=C.preview(s.data,changed);assert.equal(preview.rows[0].status,'update');
    apply(s,changed,[{index:0,targetId:s.data.parts[0].id}]);assert.equal(s.data.parts.length,1);
  }
});

test('manufacturer and reference keys cannot collide through delimiter characters',()=>{
  const s=new Store(),a=product({manufacturer:'Brand|Racing',reference:'M1'}),b=product({manufacturer:'Brand',reference:'Racing|M1'});
  const pack=input([a,b]);assert.ok(C.parse(pack).every(r=>r.errors.length===0));
  apply(s,input([a]),[{index:0,create:true}]);assert.equal(C.preview(s.data,input([b])).rows[0].status,'new');
  apply(s,input([b]),[{index:0,create:true}]);assert.equal(s.data.parts.length,2);
});

test('incomplete stored catalogue metadata is rejected before it reaches the renderer',()=>{
  const s=new Store();apply(s,input(),[{index:0,create:true}]);
  for(const value of [undefined,null]){const backup=s.snapshot();backup.parts[0].catalogue.product.specifications=value;assert.throws(()=>migrate(backup),/catalogue/i);}
});
