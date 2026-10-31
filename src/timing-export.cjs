const {createHash}=require('node:crypto');
const {makePackage}=require('./store.cjs');
const {gearRatio}=require('../renderer/domain.js');
const identity=(...parts)=>'paddock-'+createHash('sha256').update(JSON.stringify(parts)).digest('hex');

// Timing's version-1 file importer creates new copies and remaps class IDs.
// Only explicitly supported public fields cross this boundary; no live-link data.
function timingExport(db,ids,options={}){
  const pack=makePackage(db,ids,{photos:options.photos===true}),classes=new Map();
  const slotcars=pack.cars.map(car=>{
    const t=car.technical||{},label=(car.raceClass||'').trim();
    if(label&&!classes.has(label))classes.set(label,{id:identity('class',db.id,label),name:label,color:'#63b9db',icon:'car'});
    const row={id:identity('car',db.id,car.id),name:car.name,brand:car.maker||'',manufacturer:car.marque||'',model:car.model||car.name,scale:car.scale||'',raceClass:label?classes.get(label).id:'',motor:t.motor||'',tyres:t.rearTyres||'',gearing:gearRatio(t.pinion,t.gear)!==null?`${Number(t.pinion)}/${Number(t.gear)}`:'',weight:t.weight||'',picture:car.picture||'',extraPictures:(car.photos||[]).map(p=>p.data),custom:{}};
    return row;
  });
  return {format:'slotforge-timing-export',fileVersion:1,app:'SlotForge Paddock',appVersion:require('../package.json').version,exported:new Date().toISOString(),items:{raceclasses:[...classes.values()],slotcars},customFields:{}};
}
module.exports={timingExport};
