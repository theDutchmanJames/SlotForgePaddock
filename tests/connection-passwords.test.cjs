const test=require('node:test'),assert=require('node:assert/strict');
const {Network}=require('../src/network.cjs'),{Store}=require('../src/store.cjs');
async function hostFor(t){const host=new Network(new Store());await host.start();t.after(()=>host.stop());return {host,address:'127.0.0.1:'+host.port,client:new Network(new Store())};}
test('custom passwords replace only their access code and retain separate permissions',async t=>{
  const {host,address,client}=await hostFor(t),old=host.status();
  host.controls({access:'browse',password:'club visitors'});
  host.controls({access:'submit',password:'club members'});
  host.controls({access:'timing',password:'race night 2026!'});
  for(const [password,submit,timingResults]of [['club visitors',false,false],['club members',true,false],['race night 2026!',false,false]]){
    const response=await client.request(address,password,'/v1/status');assert.deepEqual(response.permissions,{browse:true,submit,timingResults});
  }
  host.controls({allowTimingResults:true});assert.equal((await client.request(address,'race night 2026!','/v1/status')).permissions.timingResults,true);
  await client.connect(address,'club visitors');assert.equal(client.remote.permissions.submit,false);
  for(const key of [old.code,old.browseCode,old.timingCode,'Club visitors'])await assert.rejects(client.request(address,key,'/v1/status'),e=>e.httpStatus===401);
  assert.equal(JSON.stringify(host.store.snapshot()).includes('club visitors'),false);
  assert.equal(JSON.stringify(client.status()).includes('club visitors'),false);
  host.controls({allowSubmissions:false});assert.equal(host.access('club members').submit,false);
});
test('password validation is atomic and prevents permission collisions',async t=>{
  const {host}=await hostFor(t);host.controls({access:'browse',password:'Visitors 2026'});const before=host.status();
  for(const change of [{access:'submit',password:'Visitors 2026'},{access:'bogus',password:'Valid pass'},{access:'__proto__',password:'Valid pass'},{access:'browse',password:'short'},{access:'browse',password:' leading spaces'},{access:'browse',password:'trailing spaces '},{access:'browse',password:'newline\npassword'},{access:'browse',password:'é'.repeat(10)},{access:'browse',password:'a'.repeat(129)},{access:'browse',password:null},{access:'browse',password:'Valid pass',rotate:true},{access:'browse',password:'Valid pass',allowTimingResults:'yes'}]){
    assert.throws(()=>host.controls({allowSubmissions:false,...change}));assert.deepEqual(host.status(),before);
  }
  host.controls({access:'browse',password:'a'.repeat(128)});assert.ok(host.access('a'.repeat(128)));
});
test('revocation and restarting sharing reset custom passwords',async t=>{
  const {host}=await hostFor(t);host.controls({access:'submit',password:'Club password'});host.controls({rotate:true});assert.equal(host.access('Club password'),null);
  host.controls({access:'submit',password:'Club password'});await host.stop();assert.equal(host.status().code,'');await host.start();assert.equal(host.access('Club password'),null);assert.match(host.code,/^[a-f0-9]{24}$/);
});
test('repeated failed authentication is limited per peer and expires',async t=>{
  const {host,address,client}=await hostFor(t);host.controls({access:'browse',password:'Club password'});
  for(let i=0;i<10;i++)await assert.rejects(client.request(address,'wrong','/v1/status'),e=>e.httpStatus===401);
  await assert.rejects(client.request(address,'Club password','/v1/status'),e=>e.httpStatus===429);
  for(const entry of host.authAttempts.values())entry.until=Date.now()-1;
  await client.connect(address,'Club password');assert.equal(host.authAttempts.size,0);
  await assert.rejects(client.request(address,'wrong','/v1/status'));host.controls({access:'browse',password:'Updated password'});assert.equal(host.authAttempts.size,0);
});
