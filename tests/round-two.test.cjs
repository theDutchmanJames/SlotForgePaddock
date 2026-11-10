'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,migrate,makePackage}=require('../src/store.cjs'),{view}=require('../src/view-query.cjs'),lazy=require('../src/lazy-assets.cjs');
const pdf=()=>{const bytes=Buffer.from('%PDF-1.4\nreference fixture\n%%EOF');return {name:'reference.pdf',mime:'application/pdf',size:bytes.length,data:bytes.toString('base64')};};
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-guides-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return new Store(path.join(dir,'database.json'));}
const part=(s,name,quantity=0)=>act(s,'part.save',{data:{name,quantity,tracking:'quantity',maker:'NSR',category:'Motors & motor parts',partType:'Motor'}});
test('guides preserve original bytes through edits, restart, reassignment and backup restore',t=>{
 let s=fixture(t);const carId=act(s,'car.save',{data:{name:'Car'}}),original=pdf(),id=act(s,'guide.add',{title:'Catalogue',carId:null,document:original});
 act(s,'guide.edit',{id,title:'Exploded view',carId});s=new Store(s.file);let doc=s.data.documents[0];assert.equal(doc.data,original.data);assert.equal(doc.title,'Exploded view');assert.equal(doc.carId,carId);
 assert.equal(JSON.stringify(makePackage(s.data,[carId])).includes(original.data),false);
 const restored=new Store();restored.restore(s.snapshot(),0);assert.deepEqual(restored.snapshot().documents,s.snapshot().documents);
 act(s,'guide.edit',{id,title:'General guide',carId:null});assert.equal(s.data.documents[0].carId,null);act(s,'guide.remove',{id});assert.equal(s.data.documents.length,0);assert.equal(new Store(s.file).data.documents.length,0);
});
test('guide validation and stale edits roll back without damaging ordinary documents',t=>{
 const s=fixture(t),carId=act(s,'car.save',{data:{name:'Car'}});s.mutate('document.add',{carId,revision:s.data.cars[0].revision,document:pdf(),title:'Receipt'});
 for(const payload of [{title:''},{carId:'missing'},{revision:-1},{document:{...pdf(),mime:'text/plain',name:'x.txt'}},{document:{...pdf(),size:40*1024*1024}},{picture:'data:image/svg+xml;base64,YQ=='}]){const before=s.snapshot();assert.throws(()=>act(s,'guide.add',{title:'Valid',carId:null,document:pdf(),...payload}));assert.deepEqual(s.snapshot(),before);}
 const id=act(s,'guide.add',{title:'Guide',carId,document:pdf()}),before=s.snapshot();assert.throws(()=>act(s,'guide.edit',{id,revision:s.data.revision-1,title:'Stale',carId:null}),/changed/);assert.deepEqual(s.snapshot(),before);
 const broken=s.snapshot();broken.documents[0].carId=null;assert.throws(()=>migrate(broken),/Orphan/);
 const saved=s.persist;s.persist=()=>{throw Error('disk full');};assert.throws(()=>act(s,'guide.remove',{id}),/disk full/);assert.deepEqual(s.snapshot(),before);s.persist=saved;
});
test('guide gallery pages and editors exclude originals and filter by title, filename and car',t=>{
 const s=fixture(t),carId=act(s,'car.save',{data:{name:'Car'}});act(s,'guide.add',{title:'Seed',carId:null,document:pdf()});s.transact(db=>{const d=db.documents[0];db.documents=Array.from({length:53},(_,i)=>({...d,id:'guide-'+i,title:'Guide '+String(i).padStart(2,'0'),carId:i%2?carId:null}));});
 lazy.clearCache();const first=view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides'});assert.equal(first.documents.length,24);assert.equal(first._view.list.total,53);assert.ok(first.documents.every(d=>!Object.hasOwn(d,'data')));assert.equal(lazy.stats().reads,0);
 const next=view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides',offset:24});assert.equal(next.documents[0].id,'guide-24');
 assert.equal(view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides',guides:{query:'Guide 52'}}).documents[0].id,'guide-52');
 assert.equal(view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides',guides:{carId:'general'}})._view.list.total,27);
 assert.equal(view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides',guides:{carId}})._view.list.total,26);
 const editor=view(s,{page:'Workshop',toolboxTab:'Manuals and Part Guides',editor:{action:'guide-edit',id:'guide-52'}});assert.ok(editor.documents.every(d=>!Object.hasOwn(d,'data')));assert.equal(lazy.stats().reads,0);
});
test('catalogue filters and pagination preserve manufacturer spelling and all matching entries',t=>{
 const s=fixture(t);part(s,'Seed');s.transact(db=>{const p=db.parts[0];db.parts=Array.from({length:91},(_,i)=>({...p,id:'part-'+i,name:'Part '+String(i).padStart(2,'0'),quantity:i%2}));});
 const first=view(s,{page:'Library',libraryTab:'parts',catalogue:{scope:'unowned',maker:'NSR'}});assert.equal(first.parts.length,40);assert.equal(first._view.list.total,46);assert.deepEqual(first._view.catalogueMakers,['NSR']);assert.equal(first.cars.length,0);
 const second=view(s,{page:'Library',libraryTab:'parts',catalogue:{scope:'unowned',maker:'nsr'},offset:40});assert.equal(second.parts.length,6);assert.equal(view(s,{page:'Library',libraryTab:'parts',catalogue:{query:'Part 90'}}).parts[0].id,'part-90');
});
test('bulk deletion preserves owned stock and saved build drafts and rechecks atomically',t=>{
 let s=fixture(t);const free=part(s,'Free'),draftPart=part(s,'Draft'),owned=part(s,'Owned',2);const build=require('../renderer/build-model.js').blank();build.name='Planned car';build.parts=[{key:'row',partId:draftPart,slot:'motor',quantity:1,position:'Motor',name:'Draft'}];act(s,'build.draft.save',{data:build});
 const plan=s.plan('part.deleteMany',{ids:[free,draftPart,owned]});assert.deepEqual(plan.eligible.map(p=>p.id),[free]);assert.ok(plan.blocked.find(p=>p.id===draftPart).reasons.includes('saved build drafts'));assert.ok(plan.blocked.find(p=>p.id===owned).reasons.includes('owned stock'));
 s=new Store(s.file);assert.ok(s.plan('part.delete',{id:draftPart}).reasons.includes('saved build drafts'));const before=s.snapshot();assert.throws(()=>act(s,'part.deleteMany',{ids:[free,draftPart],confirmed:true}),/linked/);assert.deepEqual(s.snapshot(),before);assert.throws(()=>act(s,'part.delete',{id:draftPart}),/draft/);
 assert.throws(()=>act(s,'part.deleteMany',{ids:[free,free],confirmed:true}),/unique/);assert.throws(()=>act(s,'part.deleteMany',{ids:[free]}),/Confirm/);act(s,'part.deleteMany',{ids:[free],confirmed:true});assert.equal(new Store(s.file).data.parts.some(p=>p.id===free),false);assert.equal(s.data.parts.find(p=>p.id===owned).quantity,2);
});
test('bulk deletion with installation history cannot delete a referenced zero-stock record',()=>{
 const s=new Store(),carId=act(s,'car.save',{data:{name:'Car'}}),p=part(s,'Used',1),free=part(s,'Unused');act(s,'part.install',{carId,partId:p,quantity:1,field:'motor'});act(s,'part.remove',{id:s.data.installations[0].id,destination:'discarded'});
 const plan=s.plan('part.deleteMany',{ids:[p,free]});assert.ok(plan.blocked.find(r=>r.id===p).reasons.includes('car installation history'));assert.deepEqual(plan.eligible.map(r=>r.id),[free]);
});
