'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),Types=require('../renderer/job-types.js');
test('completed work categories preserve legacy event types, reminders and original inventory',()=>{
 const s=new Store(),carId=s.mutate('car.save',{data:{name:'Workshop car'}}).result;
 const car=structuredClone(s.data.cars[0]);
 for(const {id}of Types.types.filter(t=>t.id!=='rebuild')){
  s.mutate('work.add',{carId,type:'modification',category:id,title:'Recorded '+id,performedDate:'2026-11-14',nextDue:'2026-12-01',task:'Service',notes:'Checked'});
  const e=s.data.events[0];assert.equal(e.workCategory,id);assert.equal(e.type,'maintenance');assert.ok(require('../renderer/domain.js').reminders(s.data.events).some(r=>r.id===e.id));assert.equal(e.performedDate,'2026-11-14');assert.equal(e.nextDue,'2026-12-01');assert.equal(e.task,'Service');
 }
 assert.deepEqual(s.data.cars[0],car);assert.equal(s.data.jobs.length,0);assert.equal(s.data.installations.length,0);
 s.mutate('work.add',{carId,type:'modification',category:'motor',title:'Motor change'});assert.equal(s.data.events[0].type,'modification');
 s.mutate('work.add',{carId,type:'maintenance',title:'Old client'});assert.equal(s.data.events[0].workCategory,undefined);assert.equal(s.data.events[0].type,'maintenance');
});
test('invalid work categories and rebuild journal entries cannot create misleading history',()=>{
 const s=new Store(),carId=s.mutate('car.save',{data:{name:'Workshop car'}}).result;
 for(const category of ['rebuild','unknown','',null,{},['motor']]){const before=s.snapshot();assert.throws(()=>s.mutate('work.add',{carId,type:'maintenance',category,title:'Bad entry'}),/category/);assert.deepEqual(s.snapshot(),before);}
});
test('scoped work writes persist categories without loading history and remain append-only',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-work-category-'));t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
 const s=new Store(path.join(dir,'db.sqlite')),carId=s.mutate('car.save',{data:{name:'Workshop car'}}).result;
 const d=new Store(s.file,{deferred:true}),revision=d.data.revision;
 await d.mutateAsync('work.add',{revision,carId,type:'modification',category:'motor',title:'Motor serviced'},{snapshot:false});
 assert.ok(!d.deferredState.stats.loadedSections.includes('events'));assert.ok(!d.deferredState.stats.loadedSections.includes('parts'));
 await d.mutateAsync('work.add',{carId,type:'modification',category:'braids',title:'Cleaned braids'},{snapshot:false});
 const saved=new Store(s.file);assert.equal(saved.data.events.filter(e=>e.workCategory==='motor').length,1);assert.equal(saved.data.events.filter(e=>e.workCategory==='braids').length,1);
 const before=saved.snapshot();saved.persist=()=>{throw Error('Disk full');};assert.throws(()=>saved.mutate('work.add',{carId,type:'maintenance',category:'maintenance',title:'Failed write'}),/Disk full/);assert.deepEqual(saved.snapshot(),before);
});
