(function(root){
  const numbers={ratedRpm:['No-load motor RPM',10000000],ratedVoltage:['RPM measured at (V)',1000],motorTorque:['Motor torque (gf·cm)',1000000],torqueVoltage:['Torque measured at (V)',1000],rearDiameter:['Rear tyre diameter (mm)',1000]};
  const choices={motorType:['Unknown','Brushed DC','Brushless'],torqueType:['Unknown','Stall','Rated running']};
  const keys=[...Object.keys(numbers),...Object.keys(choices)];
  const blank=()=>Object.fromEntries(keys.map(k=>[k,choices[k]?'Unknown':'']));
  function positive(value,max=Number.MAX_VALUE){
    if(typeof value!=='string'||!/^\d*\.?\d+$/.test(value.trim()))return null;
    const n=Number(value);return Number.isFinite(n)&&n>0&&n<=max?n:null;
  }
  function clean(input){
    if(input===undefined)return blank();
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid performance inputs.');
    const out=blank();
    for(const key of keys){const value=input[key]===undefined?out[key]:input[key];if(typeof value!=='string'||value.length>32)throw Error('Invalid '+(numbers[key]?.[0]||key)+'.');out[key]=value.trim();
      if(numbers[key]&&out[key]!==''&&positive(out[key],numbers[key][1])===null)throw Error('Enter a positive number for '+numbers[key][0]+'.');
      if(choices[key]&&!choices[key].includes(out[key]))throw Error('Choose a valid '+(key==='motorType'?'motor type.':'torque type.'));
    }
    return out;
  }
  function baseline(input){
    if(input==null)return null;
    const out=clean(input);
    for(const key of ['pinion','gear']){const v=input[key];if(typeof v!=='string'||v.length>16||(v!==''&&(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v))||Number(v)<1)))throw Error('Invalid comparison tooth count.');out[key]=v;}
    return out;
  }
  const finite=value=>Number.isFinite(value)?value:null;
  function calculate(input={}){
    const v=Object.fromEntries(Object.entries(numbers).map(([k,[,max]])=>[k,positive(input[k],max)]));
    const teeth=k=>typeof input[k]==='string'&&/^\d+$/.test(input[k])&&Number.isSafeInteger(Number(input[k]))&&Number(input[k])>0?Number(input[k]):null;
    const p=teeth('pinion'),g=teeth('gear'),ratio=p&&g?g/p:null;
    const rpm=v.ratedRpm,torqueNm=v.motorTorque===null?null:v.motorTorque*0.0000980665,radius=v.rearDiameter===null?null:v.rearDiameter/2000;
    const knownTorque=['Stall','Rated running'].includes(input.torqueType),axleRpm=rpm&&ratio?finite(rpm/ratio):null;
    const axleTorque=knownTorque&&torqueNm&&ratio?finite(torqueNm*ratio):null;
    const rollout=radius&&ratio?finite(2*Math.PI*radius*1000/ratio):null;
    const speedKmh=axleRpm&&radius?finite(axleRpm*2*Math.PI*radius*60/1000):null;
    const forceN=axleTorque&&radius?finite(axleTorque/radius):null;
    const reasons=[];
    if(input.motorType!=='Brushed DC')reasons.push('Choose Brushed DC to use the linear motor model.');
    if(input.torqueType!=='Stall')reasons.push('Confirm that the torque figure is stall torque.');
    if(!rpm||!torqueNm)reasons.push('Enter no-load RPM and motor torque.');
    if(!v.ratedVoltage||!v.torqueVoltage)reasons.push('Enter the test voltage for both RPM and torque.');
    else if(Math.abs(v.ratedVoltage-v.torqueVoltage)>1e-9)reasons.push('RPM and torque test voltages must match; no voltage scaling is assumed.');
    const potentialPower=torqueNm!==null&&rpm!==null?finite(torqueNm*rpm*2*Math.PI/60/4):null;
    if(!reasons.length&&!(potentialPower>0))reasons.push('These ratings are too small to calculate a usable power curve.');
    const curveReady=!reasons.length;
    const peakPowerW=curveReady?potentialPower:null;
    return {...v,ratio,axleRpm,rollout,speedKmh,torqueNm,axleTorque,forceN,curveReady,reasons,peakPowerW,peakMotorRpm:curveReady?rpm/2:null,torqueType:input.torqueType||'Unknown'};
  }
  function point(input,percent){
    const m=calculate(input);if(!m.curveReady||!Number.isFinite(percent)||percent<0||percent>100)return null;
    const rpm=m.ratedRpm*percent/100,torqueNm=m.torqueNm*(1-percent/100);
    return {rpm,torqueGfCm:torqueNm/0.0000980665,powerW:torqueNm*rpm*2*Math.PI/60,axleRpm:m.ratio?rpm/m.ratio:null,forceN:m.ratio&&m.rearDiameter?finite(torqueNm*m.ratio/(m.rearDiameter/2000)):null,speedKmh:m.ratio&&m.rearDiameter?rpm/m.ratio*Math.PI*m.rearDiameter*60/1000000:null};
  }
  const api={numbers,choices,keys,blank,positive,clean,baseline,calculate,point};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PerformanceModel=api;
})(globalThis);
