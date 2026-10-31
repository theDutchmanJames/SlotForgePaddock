const {createHash}=require('node:crypto');
const {validatePackage}=require('./store.cjs');

const digest=value=>createHash('sha256').update(value).digest('hex');
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
function assert(ok,message){if(!ok)throw Error(message);}
function text(value,label,max=20000){
  if(value===undefined||value===null)return '';
  assert(['string','number','boolean'].includes(typeof value),`Invalid Timing ${label}.`);
  const result=String(value).trim();assert(result.length<=max,`Timing ${label} is too long.`);return result;
}
function timingCarId(id){assert(typeof id==='string'&&id.trim()&&id.length<=200,'A Timing car needs an ID.');return 'timing-'+digest(id);}

// Convert file imports into the existing selective review flow. Never mutate a collection here.
function timingPackage(input){
  assert(record(input)&&input.format==='slotforge-timing-export','Choose a SlotForge Timing export.');
  assert(input.fileVersion===1,'Unsupported Timing export version. This app supports file version 1.');
  assert(record(input.items)&&Array.isArray(input.items.slotcars)&&input.items.slotcars.length>0&&input.items.slotcars.length<=1000,'The Timing export must contain 1–1,000 slotcars.');
  const classes=new Map(),seen=new Set();
  if(input.items.raceclasses!==undefined){
    assert(Array.isArray(input.items.raceclasses)&&input.items.raceclasses.length<=10000,'Invalid Timing racing classes.');
    for(const row of input.items.raceclasses){assert(record(row)&&typeof row.id==='string'&&!classes.has(row.id),'Invalid or duplicate Timing racing class.');classes.set(row.id,text(row.name,'racing class',200));}
  }
  const definitions=input.customFields?.slotcars;
  assert(definitions===undefined||Array.isArray(definitions),'Invalid Timing custom field definitions.');
  const customLabels=new Map((definitions||[]).filter(record).map(f=>[f.id,text(f.label||f.id,'custom field label',200)]));
  const cars=input.items.slotcars.map((row,index)=>{
    assert(record(row),`Invalid Timing car ${index+1}.`);
    const id=timingCarId(row.id);assert(!seen.has(id),'Duplicate Timing car ID.');seen.add(id);
    const car={id,technical:{}},notes=[`SlotForge Timing reference · car ID: ${row.id}`];
    for(const [from,to] of [['brand','maker'],['manufacturer','marque'],['model','model'],['scale','scale']]){const value=text(row[from],from);if(value)car[to]=value;}
    car.name=text(row.name,'car name',200)||[car.marque,car.model].filter(Boolean).join(' ')||car.maker||'Timing car';
    assert(car.name.length<=200,'Timing car name is too long.');
    const motor=text(row.motor,'motor');if(motor)car.technical.motor=motor;
    const gearing=text(row.gearing,'gearing'),teeth=gearing.match(/^(\d+)\s*[/:]\s*(\d+)$/);
    if(teeth&&teeth.slice(1).every(n=>Number.isSafeInteger(Number(n))&&Number(n)>0)){
      car.technical.pinion=String(Number(teeth[1]));car.technical.gear=String(Number(teeth[2]));
    }else if(gearing)notes.push('Gearing (unparsed): '+gearing);
    const weight=text(row.weight,'weight'),grams=weight.match(/^(\d+(?:[.,]\d+)?)\s*(?:g|gr|grams?)?$/i);
    if(grams)car.technical.weight=grams[1].replace(',','.');else if(weight)notes.push('Weight (unparsed): '+weight);
    const raceClass=text(row.raceClass,'racing class reference',200);
    if(raceClass){if(classes.get(raceClass))car.raceClass=classes.get(raceClass);else notes.push('Racing class ID (definition not exported): '+raceClass);}
    const tyres=text(row.tyres,'rear tyres');if(tyres)car.technical.rearTyres=tyres;
    for(const [key,label] of [['tyreCompound','Timing tyre compound'],['lapsDriven','Lifetime laps'],['lapsSinceService','Laps since service'],['serviceInterval','Service interval (laps)'],['serviceDate','Last serviced'],['servicesDone','Services completed'],['damageFactor','Timing damage factor'],['failureFactor','Timing failure factor']]){
      const value=text(row[key],key);if(value)notes.push(label+': '+value);
    }
    if(row.custom!==undefined){assert(record(row.custom)&&Object.keys(row.custom).length<=100,'Invalid Timing custom values.');for(const [key,value] of Object.entries(row.custom)){const v=text(value,'custom value');if(v)notes.push('Custom · '+(customLabels.get(key)||text(key,'custom field ID',200))+': '+v);}}
    car.technical.technicalNotes=notes.join('\n');assert(car.technical.technicalNotes.length<=20000,'Timing reference notes exceed 20,000 characters.');
    if(row.picture){assert(typeof row.picture==='string','Invalid Timing main photograph.');car.picture=row.picture;}
    if(row.extraPictures!==undefined){assert(Array.isArray(row.extraPictures)&&row.extraPictures.length<=40,'Maximum 40 additional Timing photos per car.');if(row.extraPictures.length)car.photos=row.extraPictures.map((data,i)=>({id:'timing-photo-'+digest(row.id+'|'+i),name:'Timing photo '+(i+1),data}));}
    return car;
  });
  const payload={format:'slotforge-car-package',version:1,source:'slotforge-timing',sender:'SlotForge Timing',created:text(input.exported,'export date',100),cars};
  return validatePackage({...payload,packageId:'timing-'+digest(JSON.stringify(payload))});
}
module.exports={timingPackage,timingCarId};
