'use strict';
// V8 can sample the same prefix when hashing long strings. Photo variants with
// a common prefix then make a plain Map perform repeated full-string comparisons.
// Partition by length and distributed samples; always compare the complete key
// inside the bucket. Samples are an index, never an integrity/validation check.
class StringCache {
 constructor(){this.clear();}
 clear(){this.buckets=new Map();this.order=new Set();}
 key(value){if(typeof value!=='string'||value.length<4096)return value;const middle=Math.floor(value.length/2);return value.length+':'+value.slice(0,64)+value.slice(middle,middle+64)+value.slice(-128);}
 entry(value){return this.buckets.get(this.key(value))?.get(value);}
 get(value){return this.entry(value)?.value;}
 has(value){return !!this.entry(value);}
 set(key,value){const index=this.key(key);let bucket=this.buckets.get(index);if(!bucket)this.buckets.set(index,bucket=new Map());const previous=bucket.get(key);if(previous)previous.value=value;else{const entry={key,value};bucket.set(key,entry);this.order.add(entry);}return this;}
 delete(key){const index=this.key(key),bucket=this.buckets.get(index),entry=bucket?.get(key);if(!entry)return false;bucket.delete(key);if(!bucket.size)this.buckets.delete(index);this.order.delete(entry);return true;}
 get size(){return this.order.size;}
 *keys(){for(const entry of this.order)yield entry.key;}
 *entries(){for(const entry of this.order)yield [entry.key,entry.value];}
 [Symbol.iterator](){return this.entries();}
}
module.exports={StringCache};
