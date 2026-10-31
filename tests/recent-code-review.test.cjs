const test=require('node:test'),assert=require('node:assert/strict');
const {Store,migrate}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
const timing=require('../src/timing-integration.cjs'),contract=require('../src/timing-schema.cjs');
const {fixtures}=require('./support/timing-fixtures.cjs');
const Performance=require('../renderer/performance-model.js');
const Results=require('../renderer/timing-results-model.js');

test('Timing accepts the full Unicode name length advertised by its schema',()=>{
  const f=fixtures();f.normal.name='🚗'.repeat(150);
  contract.validate(f.normal);
  timing.receive(f.store,f.normal);
  assert.equal(f.store.data.timing.sessions[0].lastName,f.normal.name);
  timing.receive(f.store,f.withdrawal);
  assert.equal(f.store.data.timing.sessions[0].lastName,f.normal.name);
});

test('Timing identifiers and signatures reject trailing line terminators at the schema boundary',()=>{
  for(const suffix of ['\n','\r','\u2028','\u2029'])for(const field of ['source','session','signature']){
    const p=fixtures().normal;
    if(field==='source')p.source.id+=suffix;
    if(field==='session')p.sessionId+=suffix;
    if(field==='signature')p.participants[0].configuration.signature+=suffix;
    assert.throws(()=>contract.validate(p),e=>e.apiCode==='INVALID_PAYLOAD',field+' '+JSON.stringify(suffix));
  }
});

test('a physical participant cannot double-count overlapping measured intervals across different heats',()=>{
  const f=fixtures(),s=f.normal,p=s.participants[0];
  s.heats.push({...s.heats[0],id:'heat-2'});
  p.stints[0].endedAtMs=10000;
  p.stints.push({...p.stints[0],id:'stint-2',heatId:'heat-2',startedAtMs:10000,endedAtMs:60000});
  p.laps=[p.laps[0],{...p.laps[1],number:1,stintId:'stint-2',durationMs:15000,endedAtMs:20000}];
  assert.throws(()=>timing.receive(f.store,s),/overlap/i);
  assert.equal(f.store.data.timing.sessions.length,0);
  p.laps[1].durationMs=10000;assert.equal(timing.receive(f.store,s).summaries[0].statistics.validLaps,2);
});

test('first configuration capture notifies the desktop of its persisted revision without claiming a submission',async t=>{
  const store=new Store(),changes=[];const id=store.mutate('car.save',{data:{name:'Car'}}).result;
  const network=new Network(store,change=>changes.push(change));t.after(()=>network.stop());await network.start();
  const read=()=>fetch('http://127.0.0.1:'+network.port+'/v1/timing/cars/'+id,{headers:{Authorization:'Bearer '+network.browseCode,'X-SlotForge-Database':store.data.id}});
  assert.equal((await read()).status,200);assert.deepEqual(changes,[{kind:'timing-capture'}]);
  assert.equal((await read()).status,200);assert.equal(changes.length,1);
});

test('performance calculations and curve points never expose non-finite values for underflowing dimensions',()=>{
  const input={motorType:'Brushed DC',torqueType:'Stall',ratedRpm:'21500',motorTorque:'285',ratedVoltage:'12',torqueVoltage:'12',pinion:'9',gear:'27',rearDiameter:'0.'+'0'.repeat(322)+'5'};
  for(const result of [Performance.calculate(input),Performance.point(input,50)])for(const value of Object.values(result))if(typeof value==='number')assert.ok(Number.isFinite(value));
  const underflow={...input,rearDiameter:'20',ratedRpm:input.rearDiameter};
  assert.equal(Performance.calculate(underflow).curveReady,false);
  assert.equal(Performance.point(underflow,50),null);
});

test('previously accepted cross-heat overlaps remain readable but contribute nothing until corrected',()=>{
  const f=fixtures();timing.receive(f.store,f.normal);
  const backup=f.store.snapshot(),record=backup.timing.sessions[0],s=record.payload,p=s.participants[0];
  s.heats.push({...s.heats[0],id:'heat-2'});p.stints[0].endedAtMs=10000;
  p.stints.push({...p.stints[0],id:'stint-2',heatId:'heat-2',startedAtMs:10000,endedAtMs:60000});
  p.laps=[p.laps[0],{...p.laps[1],number:1,stintId:'stint-2',durationMs:15000,endedAtMs:20000}];
  p.summary=Results.statistics(s,p,true);record.contentHash=timing.digest(s);
  f.store.data=migrate(backup);
  assert.deepEqual(f.store.data.timing.sessions[0].payload,s);
  assert.equal(Results.aggregate(f.store.data.timing.sessions,'car-a').distanceM,0);
  const receipt=timing.receipt(f.store.data,f.store.data.timing.sessions[0]);
  assert.deepEqual(receipt.warnings,[{code:'SESSION_REQUIRES_CORRECTION',carId:'car-a'}]);
  assert.equal(receipt.summaries[0].included,false);contract.validate(receipt,contract.schema.$defs.receipt);
  const fixed=structuredClone(s);fixed.revision=2;fixed.participants[0].laps[1].durationMs=10000;
  fixed.participants[0].summary=Results.statistics(fixed,fixed.participants[0]);
  timing.receive(f.store,fixed);assert.equal(Results.aggregate(f.store.data.timing.sessions,'car-a').validLaps,2);
  assert.deepEqual(timing.receipt(f.store.data,f.store.data.timing.sessions[0]).warnings,[]);
});
