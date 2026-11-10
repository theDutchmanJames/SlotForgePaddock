'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer/app.js'),'utf8'),snippet=source.slice(source.indexOf('const saveRetries='),source.indexOf('function toast('));
function renderer(storage,mutate,role='personal'){
 const c={SaveRetry:require('../renderer/save-retry.js'),TextEncoder,crypto:require('node:crypto').webcrypto,db:{id:'collection',revision:4,_view:{token:{epoch:'generation'}}},dataPath:'collection.sqlite',clubState:{active:false,role},localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},desiredView:()=>({page:'Cars'}),window:{slotforge:{mutate}},slotforgeSnapshot:{apply:()=>{throw Error('Broken patch');}}};vm.createContext(c);vm.runInContext(snippet,c);return c;
}
test('uncertain saves retain their identity across renderer reload; acknowledged repeats become new actions',async()=>{
 const storage=new Map(),sent=[],payload={carId:'car-a',title:'Repeated work',type:'maintenance'};
 const first=renderer(storage,async(a,p,known)=>{sent.push(known.commandId);return {error:'Lost acknowledgement',code:'WRITE_UNCERTAIN'};});await assert.rejects(first.api('mutate','work.add',payload),/Lost acknowledgement/);assert.equal(storage.size,1);
 const second=renderer(storage,async(a,p,known)=>{sent.push(known.commandId);return {ok:true,value:{result:'ok'}};});await second.api('mutate','work.add',payload);assert.equal(sent[1],sent[0]);assert.equal(storage.size,0);
 await second.api('mutate','work.add',payload);assert.notEqual(sent[2],sent[1]);
});
test('transport and snapshot errors retain pending identity; definitive rejection clears it',async()=>{
 const storage=new Map(),c=renderer(storage,async()=>{throw Error('Transport lost');});await assert.rejects(c.api('mutate','work.add',{}),/Transport lost/);assert.equal(storage.size,1);
 c.window.slotforge.mutate=async()=>({ok:true,value:{dataPatch:{databaseId:'collection',revision:4,dataPath:'collection.sqlite',changes:[]}}});await assert.rejects(c.api('mutate','work.add',{}),/Broken patch/);assert.equal(storage.size,1);
 c.window.slotforge.mutate=async()=>({error:'Unconfirmed validation error',code:'INVALID_COMMAND'});await assert.rejects(c.api('mutate','work.add',{}),/Unconfirmed/);assert.equal(storage.size,1);
 c.window.slotforge.mutate=async()=>({value:{result:'not acknowledged'}});await assert.rejects(c.api('mutate','work.add',{}),/acknowledgement was lost/);assert.equal(storage.size,1);
 c.window.slotforge.mutate=async()=>({error:'No stock',code:'INVALID_COMMAND',definiteRejection:true});await assert.rejects(c.api('mutate','work.add',{}),/No stock/);assert.equal(storage.size,0);
});
test('Dealership saves receive durable command identities on owners and members',async()=>{
 const storage=new Map(),sent=[],c=renderer(storage,async(a,p,known)=>{sent.push(known);return {ok:true,value:{queued:true}};},'coordinator');await c.api('mutate','work.add',{});c.clubState={active:true,role:'member'};await c.api('mutate','work.add',{});assert.ok(sent.every(k=>/^[a-f0-9-]{36}$/.test(k.commandId)));assert.notEqual(sent[0].commandId,sent[1].commandId);assert.equal(storage.size,0);
});
