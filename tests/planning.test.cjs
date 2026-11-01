const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate,makePackage}=require('../src/store.cjs'),reports=require('../src/reports.cjs'),comparison=require('../renderer/setup-comparison.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(){const s=new Store(),carId=act(s,'car.save',{data:{name:'Car <script>',picture:image,price:'123',seller:'Private seller',privateNotes:'Private note',technical:{pinion:'9',gear:'27'}}}),partId=act(s,'part.save',{data:{name:'Motor',quantity:0,tracking:'quantity'}}),jobId=act(s,'job.start',{kind:'general',carId,name:'Service'});return {s,carId,partId,jobId};}
test('schema 9 upgrades planning without mutating input or existing catalogue',()=>{const {s}=fixture(),old=s.snapshot();old.schema=9;delete old.planning;const migrated=migrate(old);assert.equal(migrated.schema,11);assert.deepEqual(migrated.planning,{shopping:[],jobs:[],shelves:[],focus:[]});assert.equal(old.planning,undefined);assert.deepEqual(migrated.parts,old.parts);});
test('partial receipts add owned stock exactly once per confirmed current revision and preserve purchase history',()=>{const {s,partId,jobId}=fixture(),id=act(s,'planning.shopping.add',{partId,jobId,quantity:5,notes:'PRIVATE purchase'}),revision=s.data.revision;act(s,'planning.receive',{partId,shoppingId:id,quantity:2,confirmed:true});assert.equal(s.data.parts[0].quantity,2);assert.equal(s.data.planning.shopping[0].received,2);assert.throws(()=>act(s,'planning.receive',{revision,partId,shoppingId:id,quantity:2,confirmed:true}),/changed/);assert.throws(()=>act(s,'planning.receive',{partId,shoppingId:id,quantity:4,confirmed:true}),/remaining/);act(s,'planning.receive',{partId,shoppingId:id,quantity:3,confirmed:true});assert.equal(s.data.parts[0].quantity,5);assert.throws(()=>act(s,'planning.shopping.remove',{id}),/history/);assert.ok(s.plan('part.delete',{id:partId}).reasons.includes('shopping list or purchase history'));});
test('invalid receipts and shopping inputs roll back; individual items cannot grow into quantity stock',()=>{const {s,partId}=fixture();for(const p of [{quantity:0},{quantity:1.5},{quantity:1000001},{partId:'missing',quantity:1},{quantity:1,jobId:'missing'},{quantity:1,date:'2026-02-30'}]){const before=s.snapshot();assert.throws(()=>act(s,'planning.shopping.add',{partId,...p}));assert.deepEqual(s.snapshot(),before);}for(const p of [{quantity:2},{quantity:1,confirmed:'yes'},{quantity:-1,confirmed:true},{quantity:2,confirmed:true,shoppingId:'missing'}]){const before=s.snapshot();assert.throws(()=>act(s,'planning.receive',{partId,...p}));assert.deepEqual(s.snapshot(),before);}const individual=act(s,'part.save',{data:{name:'Individual',quantity:0,tracking:'individual'}});act(s,'planning.receive',{partId:individual,quantity:1,confirmed:true});assert.throws(()=>act(s,'planning.receive',{partId:individual,quantity:1,confirmed:true}),/one item/);});
test('job checklist, waiting status and before-after photos protect completion and remain private',()=>{const {s,carId,jobId}=fixture();act(s,'planning.job.save',{jobId,priority:'High',targetDate:'2026-12-01',waiting:true,checklist:[{text:'Clean braids'}]});act(s,'planning.job.photo',{jobId,stage:'Before',name:'PRIVATE bench',data:image});assert.throws(()=>act(s,'job.complete',{id:jobId,confirmed:true}),/Waiting/);act(s,'planning.job.save',{jobId,priority:'High',targetDate:'2026-12-01',waiting:false,checklist:s.data.planning.jobs[0].checklist});assert.throws(()=>act(s,'job.complete',{id:jobId,confirmed:true}),/checklist/);act(s,'planning.job.check',{jobId,id:s.data.planning.jobs[0].checklist[0].id,done:true});act(s,'planning.job.photo',{jobId,stage:'After',name:'Finished',data:image});act(s,'job.complete',{id:jobId,confirmed:true});assert.equal(s.data.jobs[0].status,'completed');assert.equal(s.data.planning.jobs[0].photos.length,2);assert.throws(()=>act(s,'planning.job.save',{jobId}),/active/);assert.equal(JSON.stringify(makePackage(s.data,[carId])).includes('PRIVATE'),false);});
test('job plan validates dates, repeated step IDs and photo limits atomically',()=>{const {s,jobId}=fixture();for(const p of [{priority:'Urgent'},{targetDate:'2026-02-31'},{waiting:'yes'},{checklist:[{id:'x',text:'a'},{id:'x',text:'b'}]},{checklist:Array.from({length:51},()=>({text:'a'}))}]){const before=s.snapshot();assert.throws(()=>act(s,'planning.job.save',{jobId,priority:'Normal',targetDate:'',waiting:false,checklist:[],...p}));assert.deepEqual(s.snapshot(),before);}assert.throws(()=>act(s,'planning.job.photo',{jobId,stage:'During',name:'x',data:image}));assert.throws(()=>act(s,'planning.job.photo',{jobId,stage:'Before',name:'x',data:'data:image/svg+xml;base64,xxxx'}));for(let i=0;i<8;i++)act(s,'planning.job.photo',{jobId,stage:'Before',name:'Photo',data:image});assert.throws(()=>act(s,'planning.job.photo',{jobId,stage:'Before',name:'Ninth',data:image}),/eight/);});
test('shelves and focal points validate identities and survive restart and backup',t=>{const {s,carId}=fixture(),second=act(s,'car.save',{data:{name:'Second'}});const id=act(s,'planning.shelf.save',{name:'Club shelf',carIds:[second,carId]});act(s,'planning.focus',{carId,photoKey:'main',x:75,y:30});for(const bad of [{carId:'missing',photoKey:'main',x:50,y:50},{carId,photoKey:'unknown',x:50,y:50},{carId,photoKey:'main',x:101,y:50}])assert.throws(()=>act(s,'planning.focus',bad));assert.throws(()=>act(s,'planning.shelf.save',{id,name:'Shelf',carIds:[carId,carId]}));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sf-planning-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const restored=new Store(path.join(dir,'database.json'));restored.restore(s.snapshot(),0);const reopened=new Store(restored.file);assert.deepEqual(reopened.data.planning,s.data.planning);assert.deepEqual(reopened.data.planning.shelves[0].carIds,[second,carId]);const c=s.data.cars.find(c=>c.id===carId);act(s,'car.save',{id:carId,revision:c.revision,data:{picture:''}});assert.equal(s.data.planning.focus.length,0);});
test('failed persistence rolls back receipt counters and stock together',()=>{const {s,partId}=fixture(),id=act(s,'planning.shopping.add',{partId,quantity:3}),before=s.snapshot();s.persist=()=>{throw Error('Disk full');};assert.throws(()=>act(s,'planning.receive',{partId,shoppingId:id,quantity:2,confirmed:true}),/Disk full/);assert.deepEqual(s.snapshot(),before);});
test('comparison aggregates repeated lots by fitting location without mutating historical snapshots',()=>{const a={technical:{motor:'Old',weight:'80'},installations:[{partId:'p',position:'Rear',quantity:1,name:'Old tyre'},{partId:'p',position:'Rear',quantity:1,name:'Old tyre'}]},b={technical:{motor:'New',weight:'80',pinion:'9'},installations:[{partId:'p',position:'Rear',quantity:2,name:'Tyre'},{partId:'p',position:'Front',quantity:2,name:'Tyre'}]},before=structuredClone(a),r=comparison.compare(a,b);assert.equal(r.changes,3);assert.equal(r.parts[0].changed,false);assert.equal(r.parts[1].before,0);assert.deepEqual(a,before);});
test('print reports escape labels, exclude private data by default and require explicit purchase opt-in',()=>{const {s,carId}=fixture();for(const kind of ['cards','setup','scrutineering','inventory']){const r=reports.render(s.data,{kind,ids:[carId]});assert.ok(r.body.includes('Car &lt;script&gt;'));assert.equal(r.body.includes('Private seller'),false);assert.equal(r.body.includes('Private note'),false);}assert.ok(reports.render(s.data,{kind:'inventory',ids:[carId],purchase:true}).body.includes('Private seller'));assert.equal(reports.render(s.data,{kind:'inventory',ids:[carId],purchase:'true'}).body.includes('Private seller'),false);assert.ok(reports.render(s.data,{kind:'cards',ids:[carId]}).body.includes('3.00:1'));});
test('reports validate selected car and setup identities and generate bounded desktop-only QR links',()=>{const {s,carId}=fixture();act(s,'setup.save',{carId,name:'Old setup'});const setup=s.data.setups[0];for(const p of [{ids:[]},{ids:[carId,carId]},{ids:['missing']},{setupId:'missing'},{kind:'unknown'}])assert.throws(()=>reports.render(s.data,{kind:'setup',ids:[carId],...p}));assert.ok(reports.render(s.data,{kind:'setup',ids:[carId],setupId:setup.id}).body.includes('Old setup'));assert.deepEqual(reports.parseLink(reports.link(s.data,s.data.cars[0])),{databaseId:s.data.id,carId});for(const url of ['https://car/a/b','slotforge-paddock://car/a/b?path=bad','slotforge-paddock://car/a/b/extra','slotforge-paddock://user@car/a/b','slotforge-paddock://car/a/%2e%2e'])assert.equal(reports.parseLink(url),null);});

test('missing historical inventory stays unknown instead of creating false removals',()=>{const r=comparison.compare({technical:{motor:'A'}},{technical:{motor:'A'},installations:[{partId:'p',quantity:1}]});assert.equal(r.inventoryKnown,false);assert.equal(r.changes,0);assert.deepEqual(r.parts,[]);});
test('stale print previews cannot silently export a different revision',()=>{const {s,carId}=fixture();assert.throws(()=>reports.render(s.data,{kind:'cards',ids:[carId],revision:s.data.revision-1}),/changed/);});

test('old setup reports never substitute currently fitted inventory for a missing snapshot',()=>{const {s,carId,partId}=fixture();act(s,'setup.save',{carId,name:'Legacy'});const setup=s.data.setups[0];act(s,'planning.receive',{partId,quantity:1,confirmed:true});act(s,'part.install',{carId,partId,quantity:1,field:'motor'});const data=s.snapshot();delete data.setups.find(x=>x.id===setup.id).installations;const report=reports.render(data,{kind:'setup',ids:[carId],setupId:setup.id});assert.ok(report.body.includes('no tracked-inventory snapshot'));assert.equal(report.body.includes('Motor × 1'),false);});

test('current setup reports use corrected part names while saved reports retain captured names',()=>{
  const {s,carId,partId}=fixture();act(s,'planning.receive',{partId,quantity:1,confirmed:true});act(s,'part.install',{carId,partId,quantity:1,position:'Motor mount'});act(s,'setup.save',{carId,name:'Before correction'});const setupId=s.data.setups[0].id;
  act(s,'part.save',{id:partId,data:{...s.data.parts[0],name:'Corrected motor'}});
  assert.match(reports.render(s.data,{kind:'setup',ids:[carId]}).body,/Corrected motor × 1/);
  assert.match(reports.render(s.data,{kind:'setup',ids:[carId],setupId}).body,/Motor × 1/);
});

test('comparison retains both historical and current names without counting a rename as a physical replacement',()=>{
  const a={technical:{},installations:[{partId:'p',name:'Original name',quantity:1,position:'Rear'}]},b={technical:{},installations:[{partId:'p',name:'Corrected name',quantity:1,position:'Rear'}]};
  const r=comparison.compare(a,b);assert.equal(r.changes,0);assert.equal(r.parts[0].beforeName,'Original name');assert.equal(r.parts[0].afterName,'Corrected name');
});

test('imported public setups do not imply that no inventory was fitted',()=>{
  const {s,carId,partId}=fixture();act(s,'setup.save',{carId,name:'Shared baseline'});
  const recipient=new Store(),pack=makePackage(s.data,[carId],{setups:true}),subId=act(recipient,'submission.add',{package:pack});
  act(recipient,'submission.review',{id:subId,carId,revision:0,decision:'accept',includeSetups:true});
  const setup=recipient.data.setups[0];assert.ok(setup.sourceId);
  const r=comparison.compare(setup,{technical:setup.technical,installations:[{partId,quantity:1,name:'Motor'}]});assert.equal(r.inventoryKnown,false);assert.equal(r.changes,0);
  assert.match(reports.render(recipient.data,{kind:'setup',ids:[carId],setupId:setup.id}).body,/no tracked-inventory snapshot/);
});

test('shopping rejects purchases that cannot fit an individual identity or dedicated assembly lot',()=>{
  const {s,partId}=fixture(),individual=act(s,'part.save',{data:{name:'Serialised motor',tracking:'individual',quantity:0}});
  const unchanged=fn=>{const before=s.snapshot();assert.throws(fn);assert.deepEqual(s.snapshot(),before);};
  unchanged(()=>act(s,'planning.shopping.add',{partId:individual,quantity:2}));
  const line=act(s,'planning.shopping.add',{partId:individual,quantity:1});
  unchanged(()=>act(s,'planning.shopping.add',{partId:individual,quantity:1}));
  act(s,'planning.receive',{partId:individual,shoppingId:line,quantity:1,confirmed:true});
  unchanged(()=>act(s,'planning.shopping.add',{partId:individual,quantity:1}));
  act(s,'planning.receive',{partId,quantity:3,confirmed:true});act(s,'assembly.create',{name:'Ready motor',components:[{partId,quantity:1,position:'Motor'}]});
  const dedicated=s.data.assemblies[0].components[0].partId;
  assert.throws(()=>act(s,'planning.shopping.add',{partId:dedicated,quantity:1}),/assembly.*catalogue/i);
  assert.throws(()=>act(s,'planning.receive',{partId:dedicated,quantity:1,confirmed:true}),/assembly.*catalogue/i);
  act(s,'planning.receive',{partId,quantity:1,confirmed:true});assert.equal(s.data.parts.find(p=>p.id===dedicated).quantity,1);
});

test('planning numeric and checklist inputs reject implicit boolean or array conversion',()=>{
  const {s,carId,partId,jobId}=fixture();
  for(const quantity of [true,[1],null,''])for(const action of ['planning.shopping.add','planning.receive']){const before=s.snapshot();assert.throws(()=>act(s,action,{partId,quantity,confirmed:true}));assert.deepEqual(s.snapshot(),before);}
  for(const x of [true,[50],null,''])assert.throws(()=>act(s,'planning.focus',{carId,photoKey:'main',x,y:50}));
  assert.throws(()=>act(s,'planning.job.save',{jobId,priority:'Normal',targetDate:'',waiting:false,checklist:[{text:'Step',done:'false'}]}));
});

test('an additional photo named main has separate framing from the main photograph',()=>{
  const {s,carId}=fixture(),extra='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
  act(s,'car.save',{id:carId,revision:s.data.cars[0].revision,data:{photos:[{id:'main',name:'Imported detail',data:extra}]}});
  act(s,'planning.focus',{carId,photoKey:'main',x:20,y:30});
  act(s,'planning.focus',{carId,photoKey:'photo:main',x:80,y:60});
  assert.equal(s.data.planning.focus.length,2);
  act(s,'car.save',{id:carId,revision:s.data.cars[0].revision,data:{photos:[]}});
  assert.deepEqual(s.data.planning.focus.map(f=>[f.photoKey,f.x]),[['main',20]]);
});
