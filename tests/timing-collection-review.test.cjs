'use strict';
require('./support/history-gates.cjs').install({rich:true,historical:true});
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store.cjs'),L=require('../src/local-library-api.cjs'),M=require('../src/timing-collection-review.cjs'),H=require('../src/history-imports.cjs'),Q=require('../src/sqlite-query.cjs');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sf-timing-first-')),file=path.join(root,'library.sqlite');const seed=new Store(file);seed.persist(seed.data);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return new Store(file,{deferred:true});}
function transfer(store,id='transfer-one',cars=[{id:'old-car',name:'Original Timing car',manufacturer:'NSR'}],targets){return L.receive(store,{version:1,databaseId:store.data.id,sourceId:'timing-first',transferId:id,export:{format:'slotforge-timing-export',fileVersion:1,items:{slotcars:cars}},...(targets?{targets}:{})});}
const view=s=>Q.read(s,null,r=>M.inbox(r,true)).value;
const request=(s,items=view(s).rows,action='approve')=>({databaseId:s.data.id,recoveryId:view(s).recoveryId,items,action,note:'Reviewed in Timing collection'});
const decide=(s,input)=>require('../src/domain-tasks.cjs').run(s,{kind:'timing-collection-review',input});
test('Timing-first cars are grouped, owner-approved and durable across lost replies/restart',async t=>{
 let s=setup(t);const receipt=transfer(s),v=view(s);assert.equal(v.total,1);assert.equal(v.rows[0].name,'Original Timing car');assert.equal(s.data.cars.length,0);
 const inspect=M.decide(s,{...v.rows[0],databaseId:s.data.id,recoveryId:v.recoveryId,action:'inspect'});assert.equal(inspect.fields.name,'Original Timing car');
 const input=request(s);assert.equal((await decide(s,input)).results[0].status,'approved');
 s=new Store(s.file,{deferred:true});assert.equal(view(s).total,0);const revision=s.data.revision;
 assert.equal((await decide(s,input)).results[0].status,'approved');assert.equal(s.data.revision,revision);assert.equal(s.data.cars.length,1);
 const polled=L.lookup(s,'timing-first','transfer-one');assert.equal(polled.cars[0].paddockCarId,receipt.cars[0].paddockCarId);assert.equal(polled.cars[0].status,'approved');
});
test('approved physical identity receives old laps with no invented configuration',async t=>{
 const s=setup(t);const carId=transfer(s).cars[0].paddockCarId;await decide(s,request(s));
 const b=JSON.parse(fs.readFileSync(path.join(__dirname,'./fixtures/contracts/shared-racing-history-v1/fixtures/historical-import.json')));
 b.databaseId=s.data.id;b.recoveryId=view(s).recoveryId;b.editor.installationId='timing-first';
 const p=b.items[0].bundle.race.participants[0];p.carId=carId;p.configuration=null;
 H.receive(s,b);const v=view(s);assert.equal(v.rows[0].sourceId,'timing-first');assert.equal(v.rows[0].laps,p.laps.length);assert.equal(v.rows[0].kind,'history');assert.equal(JSON.stringify(v).includes('durationMs'),false);
 const input=request(s);assert.equal((await decide(s,input)).results[0].status,'approved');await decide(s,input);
 const read=url=>require('../src/shared-history-read.cjs').read(s,'http://localhost/v1/shared-history/'+url);
 const stats=read('cars/'+carId+'/statistics');assert.equal(stats.historicalSessions,1);assert.equal(stats.personalRecordLaps,0);assert.equal(stats.trackRecordLaps,0);
 const sessions=read('sessions?carId='+carId);assert.equal(sessions.entries.length,1);
 const head=read('sessions/'+b.items[0].sourceId+'/'+b.items[0].sessionId);assert.equal(head.body.race.participants[0].carId,carId);assert.equal(head.body.race.participants[0].configuration,null);
 const laps=read('sessions/'+b.items[0].sourceId+'/'+b.items[0].sessionId+'/laps/'+p.id+'?token='+head.resultToken);assert.deepEqual(laps.laps,p.laps);assert.equal(s.data.timing.audit.length,1);
});
test('explicit links preserve existing fields; decisions cannot spill into new arrivals or other sources',async t=>{
 const s=setup(t);const existing=s.mutate('car.save',{data:{name:'Paddock original',reference:'KEEP'}},{snapshot:false}).result,car=s.data.cars.find(c=>c.id===existing);
 transfer(s,'link',[{id:'old-car',name:'Different Timing name'}],[{timingCarId:'old-car',paddockCarId:car.id,expectedRevision:car.revision}]);
 const frozen=request(s);transfer(s,'later',[{id:'later',name:'Not selected'}]);
 const bad=structuredClone(frozen);bad.items[0].sourceId='another-installation';assert.equal((await decide(s,bad)).results[0].status,'error');
 await decide(s,frozen);assert.equal(view(s).total,1);assert.equal(s.data.cars.length,1);assert.equal(s.data.cars[0].reference,'KEEP');assert.equal(s.data.cars[0].name,'Paddock original');
 const rejected=request(s,view(s).rows,'reject');await decide(s,rejected);await decide(s,rejected);assert.equal(view(s).total,0);assert.equal(s.data.cars.length,1);
 const opposite={...rejected,action:'approve'};assert.equal((await decide(s,opposite)).results[0].code,'REVISION_CONFLICT');
});
test('recovery identity rejects stale bulk decisions and cancellation is not approval',async t=>{
 const s=setup(t),receipt=transfer(s),input=request(s);L.cancel(s,'timing-first','transfer-one',{version:1,itemIds:[receipt.cars[0].itemId]});assert.equal((await decide(s,input)).results[0].code,'REVISION_CONFLICT');
 await assert.rejects(decide(s,{...input,recoveryId:'older-generation'}),e=>e.code==='RECOVERY_CHANGED');assert.equal(s.data.cars.length,0);
});
