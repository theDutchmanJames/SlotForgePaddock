'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Retry=require('../renderer/save-retry.js'),{Store}=require('../src/store.cjs');
function memory(){const map=new Map();return {map,get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
const tracker=storage=>Retry.create({storage,crypto:crypto.webcrypto}),intent=['file','database','epoch','work.add',{title:'Work',carId:'car-a'}];
test('lost replies survive reload and canonical key ordering; acknowledged repeats are new',async()=>{
 const storage=memory();let first;await assert.rejects(tracker(storage).run(intent,async(v,id)=>{first=id;throw Error('Lost reply');}));
 const reordered=[...intent.slice(0,4),{carId:'car-a',title:'Work'}];await tracker(storage).run(reordered,async(v,id)=>assert.equal(id,first));assert.equal(storage.length,0);
 await tracker(storage).run(intent,async(v,id)=>assert.notEqual(id,first));
});
test('identical flights coalesce before hashing and snapshot caller values',async()=>{
 const storage=memory(),retry=tracker(storage),input=structuredClone(intent);let calls=0;const send=async(value)=>{calls++;assert.equal(value[4].title,'Work');return 7;};const a=retry.run(input,send),b=retry.run(input,send);input[4].title='Changed';assert.equal(a,b);assert.equal(await a,7);assert.equal(calls,1);
});
test('unavailable retry storage blocks dispatch; cleanup failure reports committed outcome and retains identity',async()=>{
 const storage=memory();let calls=0;const send=async()=>calls++;const set=storage.setItem;storage.setItem=()=>{throw Error('quota');};await assert.rejects(tracker(storage).run(intent,send),/No save was sent/);assert.equal(calls,0);storage.setItem=set;
 const remove=storage.removeItem;storage.removeItem=()=>{throw Error('locked');};let id;await assert.rejects(tracker(storage).run(intent,async(v,key)=>{id=key;}),/save succeeded/);storage.removeItem=remove;await tracker(storage).run(intent,async(v,key)=>assert.equal(key,id));assert.equal(storage.length,0);
});
test('only proven rejection clears tracking; unknown errors retain it',async()=>{
 const storage=memory(),retry=tracker(storage);await assert.rejects(retry.run(intent,async()=>{throw Error('unavailable');}));assert.equal(storage.length,1);
 await assert.rejects(retry.run(intent,async()=>{throw Object.assign(Error('Invalid car'),{definiteRejection:true});}));assert.equal(storage.length,0);
});
test('existing legacy identities are adopted and full journals allow retries without eviction',async()=>{
 const storage=memory(),id=crypto.randomUUID(),key='paddock-save-'+crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex');storage.setItem(key,id);
 for(let i=0;i<127;i++)storage.setItem('paddock-save-old'+i,crypto.randomUUID());await assert.rejects(tracker(storage).run([...intent.slice(0,4),{title:'New'}],async()=>assert.fail()),/Too many/);
 await tracker(storage).run(intent,async(v,saved)=>assert.equal(saved,id));assert.equal(storage.length,127);
});
test('database generations isolate identities and no payload values are stored',async()=>{
 const storage=memory();const ids=[];for(const epoch of ['epoch','replacement'])await assert.rejects(tracker(storage).run(['file','database',epoch,'work.add',{title:'Private data'}],async(v,id)=>{ids.push(id);throw Error('lost');}));assert.notEqual(ids[0],ids[1]);assert.equal(JSON.stringify([...storage.map]).includes('Private data'),false);
});
test('real durable receipts prevent duplicates after lost reply and renderer/store reopen',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-editor-retry-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let store=new Store(path.join(dir,'db.sqlite'));store.mutate('car.save',{data:{name:'A'}});store=await Store.open(store.file);const epoch=store.deferredState.token.epoch,storage=memory(),input=[store.file,store.data.id,epoch,'work.add',{carId:store.data.cars[0].id,title:'Once',type:'maintenance'}];
 const send=(v,id)=>store.mutateAsync(v[3],v[4],{commandId:id,epoch:v[2],databaseId:v[1],snapshot:false});
 await assert.rejects(tracker(storage).run(input,async(v,id)=>{await send(v,id);throw Error('Lost reply');}));store=await Store.open(store.file);const result=await tracker(storage).run(input,send);assert.equal(result.duplicate,true);assert.equal(new Store(store.file).data.events.filter(e=>e.title==='Once').length,1);
 const bad=[...input.slice(0,4),{carId:'missing',title:'Invalid',type:'maintenance'}];await assert.rejects(tracker(storage).run(bad,send),e=>e.definiteRejection===true);assert.equal(storage.length,0);
});
