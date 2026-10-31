const test=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');

test('part edits reject missing or coerced quantities without losing existing stock',()=>{
  const s=new Store(),id=s.mutate('part.save',{data:{name:'Spare tyres',quantity:4,tracking:'quantity'}}).result;
  for(const quantity of ['', '   ', null, false, [], undefined, 1.5, Number.MAX_SAFE_INTEGER+1]){
    const before=s.snapshot();
    assert.throws(()=>s.mutate('part.save',{id,data:{name:'Spare tyres',quantity,tracking:'quantity'}}),/quantity|whole number/i,JSON.stringify(quantity));
    assert.deepEqual(s.snapshot(),before);
  }
  for(const quantity of [0,'0',3,'3']){
    s.mutate('part.save',{id,data:{name:'Spare tyres',quantity,tracking:'quantity'}});
    assert.equal(s.data.parts[0].quantity,Number(quantity));
  }
});

test('a status response must identify the paired database before marking it connected',async()=>{
  const client=new Network(new Store());
  const cached={id:'club-id',revision:1,settings:{name:'Club'},cars:[]};
  client.cached=cached;
  client.remote={id:cached.id,address:'http://127.0.0.1:1234',code:'test',name:'Club',state:'offline',autoRefresh:true,lastSync:'unchanged',permissions:{browse:true,submit:false}};
  for(const id of [undefined,null,'',false,0]){
    client.request=async()=>({id,protocol:2,revision:1,name:'Club',permissions:{browse:true,submit:true}});
    client.nextPoll=0;await client.poll();
    assert.equal(client.remote.state,'offline','Unverified identity: '+JSON.stringify(id));
    assert.equal(client.remote.lastSync,'unchanged');
    assert.equal(client.remote.permissions.submit,false);
    assert.equal(client.cached,cached);
  }
  client.request=async()=>({id:'other-club',protocol:2,revision:1,name:'Club',permissions:{browse:true,submit:true}});
  client.nextPoll=0;await client.poll();assert.equal(client.remote.state,'access-required');
  assert.equal(client.remote.identityChanged,true);
  client.disconnect();
});
