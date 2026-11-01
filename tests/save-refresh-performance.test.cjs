const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const encoding=require('../src/json-encoding.cjs'),{Store}=require('../src/store.cjs');
const {SnapshotTransfer}=require('../src/snapshot-transfer.cjs'),{apply}=require('../renderer/snapshot-patch.js');
test('cached JSON encoding retains native bytes, hashes and escaping for database JSON',()=>{
 const long='photo-like 😀\n\t"\\\ud800'.repeat(1000),samples=[null,true,5,-0,NaN,Infinity,'',long,[],[undefined,,NaN],{optional:undefined,ignored:()=>{},nested:{long},again:long},JSON.parse('{"__proto__":{"value":1},"1":"one","0":"zero"}'),{date:new Date('2026-01-01'),omit:{toJSON(){return undefined;}},key:{toJSON(key){return key;}}},[new Number(4),new String('text'),new Boolean(false),{toJSON(){return undefined;}}]];
 for(const value of samples)for(let n=0;n<2;n++){
  const json=JSON.stringify(value);assert.equal(encoding.stringify(value),json);assert.equal(encoding.byteLength(value),Buffer.byteLength(json));assert.equal(encoding.hash(value),crypto.createHash('sha256').update(json).digest('hex'));
 }
 const cycle={};cycle.self=cycle;assert.throws(()=>encoding.stringify(cycle),/circular/);assert.throws(()=>encoding.stringify({big:1n}),/BigInt/);
});
test('image validation caching never accepts changed, malformed or oversized image data',()=>{
 const s=new Store(),picture='data:image/jpeg;base64,'+'A'.repeat(8192);
 s.mutate('car.save',{data:{name:'Valid',picture}});s.mutate('car.save',{data:{name:'Same image',picture}});
 for(const value of [picture+'!',picture.replace('jpeg','svg+xml'),'data:image/png;base64,'+'A'.repeat(12*1024*1024)])assert.throws(()=>s.mutate('car.save',{data:{name:'Invalid',picture:value}}));
 assert.equal(s.data.cars.length,2);
});
test('small edits transfer only changes and reconstruct exact snapshots without copying photos',()=>{
 const s=new Store(),t=new SnapshotTransfer(),path='personal',photo='data:image/jpeg;base64,'+'A'.repeat(1024*1024);
 s.mutate('car.save',{data:{name:'Before',picture:photo}});const before=s.snapshot(),known={databaseId:before.id,revision:before.revision,dataPath:path};
 assert.deepEqual(t.encode({data:before},undefined,path),{data:before});
 s.mutate('car.save',{id:s.data.cars[0].id,revision:1,data:{name:'After'}});
 const result=t.encode({data:s.snapshot(),result:'saved'},known,path);
 assert.equal(result.data,null);assert.ok(Buffer.byteLength(JSON.stringify(result))<3000);assert.equal(result.result,'saved');
 const restored=apply(before,result.dataPatch.changes);assert.deepEqual(restored,s.data);assert.equal(before.cars[0].name,'Before');assert.equal(restored.cars[0].picture,photo);
 restored.cars[0].name='Isolated';assert.equal(before.cars[0].name,'Before');
});
test('patches preserve changed pictures, added/deleted records and record reordering',()=>{
 const s=new Store(),t=new SnapshotTransfer();for(const name of ['One','Two'])s.mutate('car.save',{data:{name}});
 const before=s.snapshot(),known={databaseId:before.id,revision:before.revision,dataPath:'one'};t.encode({data:before},undefined,'one');
 s.mutate('car.save',{data:{name:'Three',picture:'data:image/png;base64,AAAA'}});s.data.cars.reverse();
 const result=t.encode({data:s.snapshot()},known,'one');assert.deepEqual(apply(before,result.dataPatch.changes),s.data);
});
test('snapshot baselines are scoped to collection, storage path, revision and window lifetime',()=>{
 const t=new SnapshotTransfer(),s=new Store(),before=s.snapshot(),known={databaseId:before.id,revision:before.revision,dataPath:'a'};t.encode({data:before},undefined,'a');
 s.mutate('car.save',{data:{name:'Next'}});
 for(const k of [{...known,dataPath:'b'},{...known,databaseId:'other'},{...known,revision:99}])assert.ok(t.encode({data:s.snapshot()},k,'a').data);
 assert.ok(t.encode({data:s.snapshot()},known,'b').data);
 t.clear();assert.ok(t.encode({data:s.snapshot()},known,'a').data);
 for(let i=0;i<5;i++){s.mutate('car.save',{data:{name:'New '+i}});t.encode({data:s.snapshot()},undefined,'a');}
 assert.ok(t.encode({data:s.snapshot()},known,'a').data);assert.equal(t.history.length,4);
 assert.deepEqual(t.encode({data:null},known,'a'),{data:null});
});
test('out-of-order responses each use the requested baseline and do not mutate it',()=>{
 const s=new Store(),t=new SnapshotTransfer(),before=s.snapshot(),known={databaseId:before.id,revision:before.revision,dataPath:'a'};t.encode({data:before},undefined,'a');
 const responses=[];for(let i=0;i<2;i++){s.mutate('car.save',{data:{name:'Car '+i}});responses.push(t.encode({data:s.snapshot()},known,'a'));}
 const newer=apply(before,responses[1].dataPatch.changes),older=apply(before,responses[0].dataPatch.changes);
 assert.equal(newer.cars.length,2);assert.equal(older.cars.length,1);assert.equal(before.cars.length,0);
});
