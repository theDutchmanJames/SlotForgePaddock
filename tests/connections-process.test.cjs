const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {fork}=require('node:child_process');
function peer(t){const child=fork(path.join(__dirname,'support','network-peer.cjs'),[],{stdio:['ignore','ignore','inherit','ipc'],windowsHide:true});let seq=0;const pending=new Map();
  child.on('message',m=>{const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error)):p.resolve(m.value);});
  child.on('exit',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Test peer exited'));}pending.clear();});
  t.after(()=>{if(child.connected)child.disconnect();});
  return (action,options={})=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Peer timeout: '+action));},15000);pending.set(id,{resolve,reject,timer});child.send({id,action,...options});});
}
test('independent processes discover, connect, refresh, submit once after a lost acknowledgement and enforce revoked access',async t=>{
  const host=peer(t),client=peer(t),sharing=await host('start');await host('add',{name:'Club process car'});const memberId=await client('add',{name:'Member process car'});
  const hostId=(await host('inspect')).database.id,found=await client('discover');assert.ok(found.some(h=>h.id===hostId));
  const read=await client('connect',{address:'127.0.0.1:'+sharing.port,code:sharing.code});assert.equal(read.data.cars[0].name,'Club process car');assert.equal(read.data.cars[0].privateNotes,undefined);
  await host('add',{name:'Added while connected'});assert.equal((await client('poll')).data.cars.length,2);
  await assert.rejects(client('submit',{carId:memberId,dropAck:true}),/retry copy/);assert.equal((await client('retry')).duplicate,true);assert.equal((await host('inspect')).database.submissions.length,1);
  await host('controls',{options:{rotate:true}});assert.equal((await client('poll')).status.remote.state,'access-required');assert.equal((await client('inspect')).database.cars.length,1);
  await host('stop');
});
