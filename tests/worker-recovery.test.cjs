'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{Writer}=require('../src/sqlite-writer.cjs');
class Fake extends EventEmitter{ref(){}unref(){}postMessage(job){this.job=job;}terminate(){return Promise.resolve();}}
test('worker queue is bounded and preserves explicit domain error codes',async()=>{
 const fake=new Fake(),writer=new Writer(()=>fake,{maxQueue:1});const first=writer.write('file',{},null);
 await assert.rejects(writer.write('file',{},null),e=>e.code==='WORKER_BUSY');
 fake.emit('message',{id:fake.job.id,error:'No permission',apiCode:'TIMING_PERMISSION_REQUIRED',httpStatus:403});await assert.rejects(first,e=>e.apiCode==='TIMING_PERMISSION_REQUIRED'&&e.httpStatus===403);
 const next=writer.write('file',{},null);fake.emit('message',{id:fake.job.id,value:'ok'});assert.equal(await next,'ok');
});
test('timed-out work is uncertain and recovery waits until the old worker has stopped',async()=>{
 const first=new Fake(),second=new Fake();let finish,created=0;first.terminate=()=>new Promise(resolve=>{finish=resolve;});
 const writer=new Writer(()=>++created===1?first:second,{timeoutMs:20});
 await assert.rejects(writer.write('file',{},null),e=>e.code==='WRITE_UNCERTAIN');
 const recovery=writer.write('file',{},null);assert.equal(created,1);finish();await writer.stopping;assert.equal(created,2);
 second.emit('message',{id:second.job.id,value:'recovered'});assert.equal(await recovery,'recovered');
});
test('a crashed worker rejects all waiting jobs without starting them',async()=>{
 const fake=new Fake(),writer=new Writer(()=>fake);const a=writer.write('file',{},null),b=writer.write('file',{},null);fake.emit('exit',1);
 const results=await Promise.allSettled([a,b]);assert.ok(results.every(r=>r.status==='rejected'&&r.reason.code==='WRITE_UNCERTAIN'));await writer.stopping;
});
