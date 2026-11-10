const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {cloneJSON}=require('../src/json-data.cjs'),{Store}=require('../src/store.cjs'),M=require('../src/club-model.cjs'),contract=require('../src/timing-schema.cjs');

test('photo-aware JSON copies isolate all mutable containers and preserve unsafe keys as own data',()=>{
 const input=JSON.parse('{"__proto__":{"polluted":true},"cars":[{"photos":[{"data":"data:image/png;base64,AAAA"}]}]}');
 const copied=cloneJSON(input);assert.deepEqual(copied,structuredClone(input));assert.equal(Object.getPrototypeOf(copied),Object.prototype);assert.equal({}.polluted,undefined);
 copied.cars[0].photos[0].data='changed';copied.__proto__.polluted=false;copied.cars.push({});
 assert.equal(input.cars[0].photos[0].data,'data:image/png;base64,AAAA');assert.equal(input.__proto__.polluted,true);assert.equal(input.cars.length,1);
});

test('snapshots and protected copies cannot mutate live data or leak the signing key',()=>{
 const s=new Store();s.mutate('car.save',{data:{name:'Car',technical:{motor:'Original'},picture:'data:image/png;base64,AAAA'}});
 s.transact(db=>{db.timing.key='1'.repeat(64);db.club={id:'club',proposals:[]};});
 const snapshot=s.snapshot(),shared=M.shared(s.data);snapshot.cars[0].technical.motor='Changed';shared.cars[0].picture='';
 assert.equal(s.data.cars[0].technical.motor,'Original');assert.equal(s.data.cars[0].picture,'data:image/png;base64,AAAA');
 assert.equal(shared.timing.key,null);assert.equal(shared.club.replica,true);assert.equal(s.data.timing.key,'1'.repeat(64));assert.equal(s.data.club.replica,undefined);
 assert.equal(M.digest(s.data),require('node:crypto').createHash('sha256').update(JSON.stringify((()=>{const db=structuredClone(s.data);delete db.club;delete db.revision;delete db.catalogueRevision;db.timing.key=null;return db;})())).digest('hex'));
});

test('transactions persist the exact validated data and keep failure rollback and previous revision',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-save-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const s=new Store(path.join(dir,'db.json'));
 const persist=s.persist.bind(s);let count=0;s.persist=db=>{count++;persist(db);assert.deepEqual(new Store(s.file).data,db);};
 s.mutate('car.save',{data:{name:'Original'}});const before=s.snapshot();s.mutate('car.save',{id:s.data.cars[0].id,revision:1,data:{name:'Updated'}});
 assert.deepEqual(s.previousSnapshot(),before);assert.deepEqual(new Store(s.file).data,s.data);assert.equal(count,2);
 const current=s.snapshot();s.persist=()=>{throw Error('disk full');};assert.throws(()=>s.transact(db=>db.cars[0].name='Rejected'),/disk full/);assert.deepEqual(s.data,current);assert.deepEqual(new Store(s.file).data,current);
});

test('fast string validation retains Unicode code-point limits, patterns and dates',()=>{
 for(const value of ['','a','ab','😀','😀a','😀😀','a😀b','\ud800'])for(let min=0;min<4;min++)for(let max=min;max<5;max++){
  const definition={type:'string',minLength:min,maxLength:max},valid=[...value].length>=min&&[...value].length<=max;
  if(valid)assert.doesNotThrow(()=>contract.validate(value,definition));else assert.throws(()=>contract.validate(value,definition));
 }
 contract.validate('data:image/jpeg;base64,'+'A'.repeat(1024*1024),{type:'string',maxLength:12*1024*1024});
 assert.throws(()=>contract.validate('wrong',{type:'string',pattern:'^[0-9]+$'}));
 assert.throws(()=>contract.validate('not-a-date',{type:'string',format:'date-time'}));
});

test('review approval performs one fresh simulation and still refuses a stale token',async t=>{
 const {Network}=require('../src/network.cjs'),{Club}=require('../src/club.cjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-review-perf-')),s=new Store(),net=new Network(s),club=new Club(s,net,dir);t.after(()=>{club.close();net.close();fs.rmSync(dir,{recursive:true,force:true});});
 s.mutate('car.save',{data:{name:'Original'}});club.enable('Main','Club test password');const id=s.data.cars[0].id;
 await club.propose('car.save',{id,revision:1,data:{name:'Proposed'}});const proposal=s.data.club.proposals[0].id,preview=club.preview(proposal);
 s.mutate('car.save',{id,revision:1,data:{name:'Intervening edit'}});assert.throws(()=>club.review({id:proposal,token:preview.token,decision:'accept'}),/changed again/);
 const current=club.preview(proposal);let calls=0,simulate=club.simulation.bind(club);club.simulation=(...args)=>{calls++;return simulate(...args);};
 club.review({id:proposal,token:current.token,decision:'accept',confirmConflict:true});assert.equal(calls,1);assert.equal(s.data.cars[0].name,'Proposed');
});
