const test=require('node:test'),assert=require('node:assert/strict'),{ThumbnailCache}=require('../src/thumbnail-cache.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
test('thumbnail requests deduplicate, limit active decoders and evict encoded cache bytes',async()=>{
 const sent=[],cache=new ThumbnailCache(job=>sent.push(job),async()=>({bytes:new Uint8Array([1]),mime:'image/png'}),{limit:4}),a=cache.get('a','a'),duplicate=cache.get('a','a'),b=cache.get('b','b'),c=cache.get('c','c');assert.equal(a,duplicate);await tick();assert.equal(sent.length,2);
 cache.receive(sent[0].id,{mime:'image/png',bytes:new Uint8Array([1,2,3])});await a;await tick();assert.equal(sent.length,3);
 cache.receive(sent[1].id,{mime:'image/png',bytes:new Uint8Array([4,5,6])});cache.receive(sent[2].id,{mime:'image/png',bytes:new Uint8Array([7,8])});await Promise.all([b,c]);assert.ok(cache.bytes<=4);assert.equal(cache.cache.has('a'),false);cache.clear();
});
test('reload discards pending replies and invalid thumbnail payloads never enter the cache',async()=>{
 const sent=[],cache=new ThumbnailCache(j=>sent.push(j),async()=>({bytes:new Uint8Array([1]),mime:'image/png'}));const a=cache.get('a','a');await tick();cache.clear();assert.equal(await a,null);cache.receive(sent[0].id,{mime:'image/png',bytes:new Uint8Array([1])});assert.equal(cache.cache.size,0);
 const b=cache.get('b','b');await tick();cache.receive(sent[1].id,{mime:'text/html',bytes:new Uint8Array([1])});assert.equal(await b,null);assert.equal(cache.cache.size,0);
});
