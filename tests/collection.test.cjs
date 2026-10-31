const test=require('node:test');
const assert=require('node:assert/strict');
const {Store,makePackage,validatePackage,migrate}=require('../src/store.cjs');
const {validateDocument}=require('../src/documents.cjs');
const {Network}=require('../src/network.cjs');
const add=(s,name='Car',data={})=>s.mutate('car.save',{data:{name,maker:'Nsr',technical:{motor:'Original'},factory:{motor:'Original'},usage:['Home racing'],tags:['Favourite'],...data}}).result;
const action=(s,name,p)=>s.mutate(name,{...p,revision:s.data.revision}).result;
const doc=(text='Private receipt')=>{const b=Buffer.from(text);return {name:'receipt.txt',mime:'text/plain',size:b.length,data:b.toString('base64')};};
test('bulk preview is read only and enabled fields change together without touching other cars',()=>{
  const s=new Store(),a=add(s,'A'),b=add(s,'B'),c=add(s,'C'),before=s.snapshot(),payload={revision:s.data.revision,ids:[a,b],updates:{location:'Club rack',owner:'James'},labels:{usage:{mode:'add',values:['Club racing']}}};
  const preview=s.plan('bulk.preview',payload);assert.equal(preview.changed,2);assert.deepEqual(s.snapshot(),before);assert.throws(()=>s.mutate('car.bulk',payload),/Confirm/);s.mutate('car.bulk',{...payload,confirmed:true});
  for(const id of [a,b]){const car=s.data.cars.find(c=>c.id===id);assert.equal(car.location,'Club rack');assert.deepEqual(car.usage,['Home racing','Club racing']);assert.deepEqual(car.tags,['Favourite']);}
  assert.equal(s.data.cars.find(x=>x.id===c).location,undefined);assert.equal(s.data.events.filter(e=>e.title==='Bulk details updated').length,2);
});
test('bulk label remove and replace support explicit clearing and reject technical or missing records atomically',()=>{
  const s=new Store(),id=add(s);action(s,'car.bulk',{ids:[id],labels:{usage:{mode:'remove',values:['Home racing']},tags:{mode:'replace',values:[]}},confirmed:true});assert.deepEqual(s.data.cars[0].usage,[]);assert.deepEqual(s.data.cars[0].tags,[]);
  const before=s.snapshot();for(const p of [{ids:[id],updates:{technical:'no'}},{ids:[id,'missing'],updates:{owner:'No'}},{ids:[id,id],updates:{owner:'No'}}]){assert.throws(()=>action(s,'car.bulk',{...p,confirmed:true}));assert.deepEqual(s.snapshot(),before);}
});
test('bulk changes reject stale reviews, label overflow and failed disk writes',()=>{
  const s=new Store(),id=add(s),p={ids:[id],updates:{owner:'New'},revision:s.data.revision,confirmed:true};s.mutate('settings.save',{name:'Later'});const before=s.snapshot();assert.throws(()=>s.mutate('car.bulk',p),/changed/);
  assert.throws(()=>action(s,'car.bulk',{ids:[id],labels:{tags:{mode:'add',values:Array.from({length:100},(_,n)=>String(n))}},confirmed:true}),/100 labels/);assert.deepEqual(s.snapshot(),before);
  s.persist=()=>{throw Error('Disk full');};assert.throws(()=>action(s,'car.bulk',{...p,confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);
});
test('choice rename updates reviewed current values and keeps snapshots and factory references intact',()=>{
  const s=new Store(),id=add(s);s.mutate('setup.save',{carId:id,name:'Before'});s.mutate('test.add',{carId:id,track:'Home'});const setup=structuredClone(s.data.setups),tests=structuredClone(s.data.tests),before=s.snapshot(),p={field:'tech_motor',from:'Original',to:'Corrected',updateCars:true,revision:s.data.revision};
  assert.equal(s.plan('choice.preview',p).rows.length,1);assert.deepEqual(s.snapshot(),before);s.mutate('choice.rename',{...p,confirmed:true});assert.equal(s.data.cars[0].technical.motor,'Corrected');assert.equal(s.data.cars[0].factory.motor,'Original');assert.deepEqual(s.data.setups,setup);assert.deepEqual(s.data.tests,tests);assert.deepEqual(s.plan('choices.catalogue').values.tech_motor.map(v=>v.value),['Corrected']);
});
test('choice merge redirects previous spellings directly and avoids duplicate suggestions',()=>{
  const s=new Store();add(s);add(s,'Other',{maker:'NSR'});action(s,'choice.rename',{field:'maker',from:'Nsr',to:'NSR',updateCars:true,confirmed:true});assert.deepEqual(s.plan('choices.catalogue').values.maker.map(v=>v.value),['NSR']);
  action(s,'choice.rename',{field:'maker',from:'NSR',to:'NSR Racing',updateCars:true,confirmed:true});assert.ok(s.data.choiceAliases.every(a=>a.to==='NSR Racing'));assert.equal(s.data.cars[0].maker,'NSR Racing');action(s,'choice.rename',{field:'maker',from:'NSR Racing',to:'Nsr',updateCars:true,confirmed:true});assert.equal(s.data.cars[0].maker,'Nsr');assert.ok(s.data.choiceAliases.every(a=>a.to==='Nsr'));assert.equal(s.data.choiceAliases.some(a=>a.from==='Nsr'),false);
});
test('future-only renames preserve cars, while installed fields are explicitly skipped',()=>{
  const s=new Store(),id=add(s);action(s,'choice.rename',{field:'maker',from:'Nsr',to:'NSR',updateCars:false,confirmed:true});assert.equal(s.data.cars[0].maker,'Nsr');
  const part=s.mutate('part.save',{data:{name:'Original',tracking:'individual',quantity:1}}).result;s.mutate('part.install',{carId:id,partId:part,quantity:1,field:'motor'});
  const p={field:'tech_motor',from:'Original',to:'New suggestion',updateCars:true,revision:s.data.revision};const plan=s.plan('choice.preview',p);assert.equal(plan.skipped.length,1);assert.equal(plan.rows.length,0);s.mutate('choice.rename',{...p,confirmed:true});assert.equal(s.data.cars[0].technical.motor,'Original');assert.equal(s.data.parts[0].name,'Original');
});
test('usage renames preserve label uniqueness and update saved filters without rewriting earlier history',()=>{
  const s=new Store(),id=add(s,'A',{usage:['Home racing','Home']});s.mutate('view.save',{name:'Home',usage:['Home racing','Home']});const events=structuredClone(s.data.events);action(s,'choice.rename',{field:'usage',from:'Home racing',to:'Home',updateCars:true,confirmed:true});assert.deepEqual(s.data.cars[0].usage,['Home']);assert.deepEqual(s.data.views[0].usage,['Home']);assert.deepEqual(s.data.events.slice(1),events);
});
test('track choices remain reusable without rewriting test or setup history',()=>{
  const s=new Store(),id=add(s);s.mutate('test.add',{carId:id,track:'Old track'});action(s,'choice.rename',{field:'track',from:'Old track',to:'New track',updateCars:true,confirmed:true});assert.equal(s.data.tests[0].track,'Old track');assert.equal(s.plan('choices.catalogue').values.track[0].value,'New track');action(s,'choice.add',{field:'driver',value:'James'});assert.equal(s.plan('choices.catalogue').values.driver[0].value,'James');
});
test('column order persists independently in saved views and supports custom fields',()=>{
  const s=new Store();s.mutate('custom.add',{label:'Club class',type:'choice'});const key='custom_'+s.data.customFields[0].id,columns=['name','tech_motor',key,'location'];action(s,'columns.save',{columns});s.mutate('view.save',{name:'Club',columns});action(s,'columns.save',{columns:['name','maker']});assert.deepEqual(s.data.views[0].columns,columns);assert.deepEqual(s.data.settings.columns,['name','maker']);
  const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.views[0].columns,columns);for(const invalid of [[],['maker'],['name','name'],['name','missing']])assert.throws(()=>action(s,'columns.save',{columns:invalid}),/columns/);
});
test('old schemas migrate to choice, document and column defaults without losing collection data',()=>{
  const s=new Store();add(s);s.mutate('view.save',{name:'Old view'});const old=s.snapshot();old.schema=2;delete old.documents;delete old.choiceAliases;delete old.settings.columns;delete old.views[0].columns;const next=migrate(old);assert.equal(next.schema,10);assert.deepEqual(next.cars,old.cars);assert.deepEqual(next.documents,[]);assert.deepEqual(next.views[0].columns,next.settings.columns);assert.equal(old.schema,2);
});
test('documents survive complete restore but never enter car packages or duplication',()=>{
  const s=new Store(),id=add(s);s.mutate('document.add',{carId:id,revision:s.data.cars[0].revision,title:'Receipt',category:'Receipt',document:doc()});const packageText=JSON.stringify(makePackage(s.data,[id],{photos:true,setups:true,documents:true}));assert.ok(!packageText.includes('Private receipt'));assert.ok(!packageText.includes(doc().data));
  const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.data.documents,s.data.documents);s.mutate('car.duplicate',{id});assert.equal(s.data.documents.length,1);assert.equal(s.data.documents[0].carId,id);
});
test('document adds and removals require the current car revision and preserve earlier backups',()=>{
  const s=new Store(),id=add(s);assert.throws(()=>s.mutate('document.add',{carId:id,revision:0,title:'Receipt',document:doc()}),/changed/);s.mutate('document.add',{carId:id,revision:1,title:'Receipt',document:doc()});const backup=s.snapshot(),documentId=s.data.documents[0].id;assert.throws(()=>s.mutate('document.remove',{id:documentId,revision:1}),/changed/);s.mutate('document.remove',{id:documentId,revision:2});assert.equal(s.data.documents.length,0);assert.equal(backup.documents.length,1);
});
test('attachment validation rejects executable extensions, paths, MIME mismatches and damaged encoding',()=>{
  for(const malformed of [{...doc(),name:'run.exe'},{...doc(),name:'../receipt.txt'},{...doc(),name:'fake.pdf',mime:'application/pdf'},{...doc(),size:100},{...doc(),data:'!!!!'}])assert.throws(()=>validateDocument(malformed));
  const s=new Store(),id=add(s),pack=makePackage(s.data,[id]);pack.cars[0].documents=[doc()];assert.equal(validatePackage(pack).cars[0].documents,undefined);
});
test('network public reads exclude private attachment content and library ownership suggestions',async()=>{
  const s=new Store(),id=add(s);s.mutate('document.add',{carId:id,revision:1,title:'Receipt',document:doc()});action(s,'choice.add',{field:'owner',value:'Private owner'});const host=new Network(s),client=new Network(new Store());try{const status=await host.start(),result=await client.connect('127.0.0.1:'+status.port,status.code);const wire=JSON.stringify(result.data);assert.ok(!wire.includes(doc().data));assert.ok(!wire.includes('Private owner'));assert.equal(result.data.documents,undefined);}finally{await host.stop();}
});
test('entered custom choices and less common car values remain reusable after correction',()=>{
  const s=new Store();s.mutate('custom.add',{label:'Tyre treatment',type:'choice'});const field=s.data.customFields[0].id,id=add(s,'A',{origin:'Hand built',custom:{[field]:'Dry'}});s.mutate('car.save',{id,revision:s.data.cars[0].revision,data:{origin:'Kit',custom:{[field]:'Oiled'}}});const catalogue=s.plan('choices.catalogue');assert.deepEqual(catalogue.values['custom_'+field].map(v=>v.value),['Dry','Oiled']);assert.deepEqual(catalogue.values.origin.map(v=>v.value),['Hand built','Kit']);
});
