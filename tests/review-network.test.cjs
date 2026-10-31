const test=require('node:test');
const assert=require('node:assert/strict');
const {Store,makePackage}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
test('paged collection reads include every car while older clients still receive the complete small collection',async()=>{
  const store=new Store();for(let n=0;n<61;n++)store.mutate('car.save',{data:{name:'Car '+n}});
  const host=new Network(store),client=new Network(new Store());try{
    const status=await host.start(),address='127.0.0.1:'+status.port;
    const read=await client.connect(address,status.code);assert.equal(read.data.cars.length,61);assert.equal(new Set(read.data.cars.map(c=>c.id)).size,61);
    const legacy=await fetch('http://'+address+'/v1/collection',{headers:{Authorization:'Bearer '+status.code}});assert.equal((await legacy.json()).cars.length,61);
    assert.deepEqual(read.data.assemblies,[]);
  }finally{await host.stop();}
});
test('a collection that changes between pages is rejected without replacing an existing connection',async()=>{
  const store=new Store();for(let n=0;n<26;n++)store.mutate('car.save',{data:{name:'Car '+n}});
  const host=new Network(store),client=new Network(new Store());try{
    const status=await host.start(),address='127.0.0.1:'+status.port;await client.connect(address,status.code);const original=client.remote;
    const request=client.request.bind(client);let count=0;client.request=async(...args)=>{const response=await request(...args);if(++count===1)store.mutate('settings.save',{name:'Changed during transfer'});return response;};
    await assert.rejects(client.refresh(),/changed during transfer/);assert.deepEqual(client.remote,original);
  }finally{await host.stop();}
});
test('disconnecting during a connection attempt cannot reconnect in the background',async()=>{
  const store=new Store(),host=new Network(store),client=new Network(new Store());try{
    const status=await host.start();const request=client.request.bind(client);client.request=async(...args)=>{const response=await request(...args);client.disconnect();return response;};
    await assert.rejects(client.connect('127.0.0.1:'+status.port,status.code),/canceled/);assert.equal(client.remote,null);
  }finally{await host.stop();}
});
test('concurrent sharing starts return the same ready port, and stop resets status',async()=>{
  const host=new Network(new Store());try{const [a,b]=await Promise.all([host.start(),host.start()]);assert.ok(a.port>0);assert.equal(a.port,b.port);}finally{await host.stop();}assert.equal(host.status().sharing,false);assert.equal(host.status().port,0);
});
test('duplicate submissions keep the revision and trigger only one notification',async()=>{
  const member=new Store(),id=member.mutate('car.save',{data:{name:'Member car'}}).result,pack=makePackage(member.data,[id]);let notices=0;
  const store=new Store(),host=new Network(store,()=>{notices++;throw Error('UI closed');}),client=new Network(member);try{
    const status=await host.start(),address='127.0.0.1:'+status.port;assert.equal((await client.request(address,status.code,'/v1/submissions',pack)).ok,true);const revision=store.data.revision;
    assert.equal((await client.request(address,status.code,'/v1/submissions',pack)).duplicate,true);assert.equal(notices,1);assert.equal(store.data.revision,revision);
  }finally{await host.stop();}
});
test('photo collections larger than one response limit can be read in bounded pages',async()=>{
  const store=new Store();const picture='data:image/jpeg;base64,'+'A'.repeat(3*1024*1024);
  // Synthetic image payloads exercise protocol byte limits without shipping fixture photos.
  for(let n=0;n<12;n++)store.mutate('car.save',{data:{name:'Photo car '+n,picture}});
  const host=new Network(store),client=new Network(new Store());try{
    const status=await host.start(),read=await client.connect('127.0.0.1:'+status.port,status.code);assert.equal(read.data.cars.length,12);assert.equal(read.data.cars[11].picture,picture);
  }finally{await host.stop();}
});
test('oversized outgoing submissions fail before making a network request',async()=>{
  const client=new Network(new Store());await assert.rejects(client.request('127.0.0.1:1','unused','/v1/submissions',{text:'A'.repeat(32*1024*1024)}),/32 MB/);
});
