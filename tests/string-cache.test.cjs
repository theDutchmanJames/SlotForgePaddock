const test=require('node:test'),assert=require('node:assert/strict'),{StringCache}=require('../src/string-cache.cjs');
test('sampled string cache retains exact keys, insertion order and Map update/delete semantics',()=>{
 const cache=new StringCache(),a='A'.repeat(10000),b=a.slice(0,1000)+'B'+a.slice(1001);
 assert.equal(cache.key(a),cache.key(b));cache.set(a,1).set(b,2).set('short',3);assert.equal(cache.size,3);assert.equal(cache.get(a),1);assert.equal(cache.get(b),2);
 cache.set(a,4);assert.deepEqual([...cache],[[a,4],[b,2],['short',3]]);assert.equal(cache.delete(a),true);assert.equal(cache.has(a),false);assert.equal(cache.get(b),2);assert.equal(cache.delete(a),false);cache.clear();assert.equal(cache.size,0);assert.equal(cache.buckets.size,0);
});
test('photo validation never trusts a matching sampled cache key',()=>{
 const encoding=require('../src/json-encoding.cjs'),good='data:image/png;base64,'+'A'.repeat(10000),bad=good.slice(0,1000)+'!'+good.slice(1001);
 assert.equal(new StringCache().key(good),new StringCache().key(bad));assert.equal(encoding.isPhoto(good),true);assert.equal(encoding.isPhoto(bad),false);for(const value of [42,true,{},[]])assert.equal(encoding.isPhoto(value),false);assert.equal(encoding.stringify({good,bad}),JSON.stringify({good,bad}));
});
