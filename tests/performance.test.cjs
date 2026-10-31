const test=require('node:test'),assert=require('node:assert/strict');
const P=require('../renderer/performance-model.js'),B=require('../renderer/build-model.js');
const {Store,makePackage,migrate}=require('../src/store.cjs');
const example=()=>({...P.blank(),pinion:'9',gear:'27',ratedRpm:'21500',ratedVoltage:'12',motorTorque:'285',torqueVoltage:'12',torqueType:'Stall',motorType:'Brushed DC',rearDiameter:'20'});
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
const act=(s,a,p)=>s.mutate(a,{revision:s.data.revision,...p}).result;
function buildFixture(){const s=new Store(),part=act(s,'part.save',{data:{name:'Motor',tracking:'quantity',quantity:2}});return {s,data:{...B.blank(),name:'Performance build',parts:[{key:'motor',partId:part,name:'Motor',quantity:1,slot:'motor',position:'Motor'}],gearing:{pinion:'9',gear:'27'},performance:P.clean(example()),performanceBaseline:P.baseline(example())}};}

test('285 gf·cm example uses correct torque, force, rollout, speed and mechanical power units',()=>{
  const m=P.calculate(example());close(m.ratio,3);close(m.torqueNm,0.0279489525);close(m.axleTorque,0.0838468575);close(m.forceN,8.38468575);
  close(m.axleRpm,21500/3);close(m.rollout,Math.PI*20/3);close(m.speedKmh,21500/3*Math.PI*20*60/1000000);
  close(m.peakPowerW,15.73159010637414);close(m.peakMotorRpm,10750);
  close(P.calculate({...example(),motorTorque:'430'}).peakPowerW,23.735381564003088);
});
test('motor curves have zero power at stall and no load, maximum at half speed',()=>{
  const zero=P.point(example(),0),half=P.point(example(),50),full=P.point(example(),100);
  close(zero.torqueGfCm,285);close(zero.powerW,0);close(zero.rpm,0);close(zero.forceN,8.38468575);
  close(full.torqueGfCm,0);close(full.powerW,0);close(full.forceN,0);close(full.rpm,21500);
  close(half.torqueGfCm,142.5);close(half.powerW,P.calculate(example()).peakPowerW);close(half.speedKmh,P.calculate(example()).speedKmh/2);
  for(const percent of [-1,101,NaN,Infinity,'50'])assert.equal(P.point(example(),percent),null);
});
test('gear and tyre changes trade speed for force without creating motor power',()=>{
  const base=P.calculate(example()),lower=P.calculate({...example(),pinion:'8'}),smaller=P.calculate({...example(),rearDiameter:'19'});
  close(lower.axleRpm/base.axleRpm,8/9);close(lower.forceN/base.forceN,9/8);close(lower.peakPowerW,base.peakPowerW);
  close(smaller.speedKmh/base.speedKmh,19/20);close(smaller.forceN/base.forceN,20/19);close(smaller.peakPowerW,base.peakPowerW);
});
test('unknown and running torque, brushless motors and missing/mismatched voltages suppress curves and peak power',()=>{
  for(const change of [{torqueType:'Unknown'},{torqueType:'Rated running'},{motorType:'Brushless'},{motorType:'Unknown'},{ratedVoltage:''},{torqueVoltage:''},{torqueVoltage:'14'},{ratedRpm:'oops'},{motorTorque:'0'}]){
    const input={...example(),...change},m=P.calculate(input);assert.equal(m.curveReady,false);assert.equal(m.peakPowerW,null);assert.equal(P.point(input,50),null);assert.ok(m.reasons.length);
  }
  assert.equal(P.calculate({...example(),torqueType:'Unknown'}).forceN,null);
  close(P.calculate({...example(),torqueType:'Rated running'}).forceN,8.38468575);
});
test('partial input yields only supported calculations without NaN or infinity',()=>{
  const empty=P.calculate();for(const key of ['ratio','axleRpm','speedKmh','rollout','axleTorque','forceN','peakPowerW'])assert.equal(empty[key],null);
  const noTyre=P.calculate({...example(),rearDiameter:''});assert.ok(noTyre.axleRpm);assert.ok(noTyre.axleTorque);assert.equal(noTyre.forceN,null);assert.equal(noTyre.speedKmh,null);assert.equal(noTyre.rollout,null);
  const noGear=P.calculate({...example(),gear:''});assert.ok(noGear.peakPowerW);assert.equal(noGear.axleTorque,null);
  for(const value of ['-1','Infinity','1e6','0','abc',null,NaN,{},'1'.repeat(40)])assert.equal(P.calculate({...example(),ratedRpm:value}).axleRpm,null);
});
test('performance and comparison survive drafts/backups; car, setup, history and sharing retain motor specs',()=>{
  const {s,data}=buildFixture(),draft=act(s,'build.draft.save',{data});const restored=new Store();restored.restore(s.snapshot(),0);
  assert.deepEqual(restored.data.buildDrafts[0].data.performanceBaseline,data.performanceBaseline);
  const id=act(s,'build.create',{data:s.data.buildDrafts[0].data,draftId:draft,confirmed:true});
  const c=s.data.cars.find(c=>c.id===id),pack=makePackage(s.data,[id],{setups:true});
  for(const tech of [c.technical,s.data.setups[0].technical,pack.cars[0].technical,pack.cars[0].sharedSetups[0].technical,...s.data.events.filter(e=>e.carId===id).map(e=>e.technical)])for(const key of P.keys)assert.equal(tech[key],data.performance[key]);
  assert.equal(JSON.stringify(pack).includes('performanceBaseline'),false);
  act(s,'car.save',{id,revision:c.revision,data:{technical:{motorTorque:'430'}}});assert.equal(s.data.setups[0].technical.motorTorque,'285');
  const setup=s.data.setups[0];assert.equal(P.calculate({...setup.technical}).peakPowerW,P.calculate(example()).peakPowerW);
});
test('invalid performance or comparison data is rejected atomically; legacy drafts remain usable',()=>{
  const {s,data}=buildFixture();
  for(const change of [{performance:[]},{performance:{ratedRpm:'-1'}},{performance:{motorTorque:null}},{performance:{motorTorque:'Infinity'}},{performance:{motorType:'Turbo'}},{performanceBaseline:{...example(),pinion:'0'}},{performanceBaseline:[]}]){
    const before=s.snapshot();assert.throws(()=>act(s,'build.create',{data:{...data,...change},confirmed:true}));assert.deepEqual(s.snapshot(),before);
  }
  act(s,'build.draft.save',{data});const backup=s.snapshot();backup.buildDrafts[0].data.performance.torqueType='anything';assert.throws(()=>migrate(backup));
  delete data.performance;delete data.performanceBaseline;act(s,'build.create',{data,confirmed:true});assert.equal(s.data.cars[0].technical.motorTorque,undefined);
});
