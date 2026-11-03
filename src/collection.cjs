const {randomUUID}=require('node:crypto');
const DEFAULT_COLUMNS=['name','maker','scale','usage','location','availability'];
const CHOICE_FIELDS=['maker','marque','model','scale','livery','colours','team','drivers','event','edition','origin','owner','ownership','condition','packaging','location','availability','acquisitionMethod','seller','currency','disposalMethod','category','raceClass','usage','tags','track','driver'];
const BULK_FIELDS=['owner','location','ownership','availability','raceClass','category','condition','packaging'];
const check=(ok,message)=>{if(!ok)throw Error(message);};
const {cloneJSON:clone}=require('./json-data.cjs');
const title=key=>key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
function metadata(db,context){
  const custom=db.customFields.filter(f=>f.type==='choice').map(f=>({key:'custom_'+f.id,label:f.label,group:'Custom choices'}));
  const choices=[...CHOICE_FIELDS.map(key=>({key,label:title(key),group:['track','driver'].includes(key)?'Tracks and drivers':'Car details'})),...context.techFields.filter(k=>!['technicalNotes','measuredDate'].includes(k)).map(k=>({key:'tech_'+k,label:title(k),group:'Technical values'})),...custom];
  const columns=[...context.textFields.map(key=>({key,label:title(key),group:'Car details'})),...['usage','tags','picture'].map(key=>({key,label:title(key),group:'Car details'})),...context.techFields.map(key=>({key:'tech_'+key,label:title(key),group:'Technical specifications'})),...db.customFields.map(f=>({key:'custom_'+f.id,label:f.label,group:'Custom fields'}))];
  return {choices,columns,bulkFields:BULK_FIELDS,defaultColumns:DEFAULT_COLUMNS};
}
function canonical(db,field,value){const alias=db.choiceAliases.find(a=>a.field===field&&a.from===value);return alias?alias.to:value;}
function valueAt(car,key){if(key.startsWith('tech_'))return car.technical[key.slice(5)];if(key.startsWith('custom_'))return car.custom[key.slice(7)];return car[key];}
function setValue(car,key,value){if(key.startsWith('tech_'))car.technical[key.slice(5)]=value;else if(key.startsWith('custom_'))car.custom[key.slice(7)]=value;else car[key]=value;}
function rememberValue(db,key,value){if(typeof value==='string'&&value.trim())db.choices[key]=[...new Set([...(db.choices[key]||[]),canonical(db,key,value)])];}
function rememberChoices(db,car,context){for(const field of metadata(db,context).choices){const value=valueAt(car,field.key);for(const v of Array.isArray(value)?value:[value])rememberValue(db,field.key,v);if(field.key.startsWith('tech_'))rememberValue(db,field.key,car.factory[field.key.slice(5)]);}}
function valuesFor(db,field){
  const values=[...(db.choices[field]||[])];
  for(const c of db.cars){const v=valueAt(c,field);values.push(...(Array.isArray(v)?v:[v]));if(field.startsWith('tech_'))values.push(c.factory[field.slice(5)]);}
  if(field==='track')values.push(...db.setups.map(s=>s.track),...db.tests.map(t=>t.track));
  if(field==='driver')values.push(...db.tests.map(t=>t.driver));
  return [...new Set(values.filter(v=>typeof v==='string'&&v.trim()).map(v=>canonical(db,field,v)))].sort((a,b)=>a.localeCompare(b));
}
function catalogue(db,context){
  const meta=metadata(db,context);
  return {...meta,revision:db.revision,values:Object.fromEntries(meta.choices.map(f=>[f.key,valuesFor(db,f.key).map(value=>({value,cars:db.cars.filter(c=>{const v=valueAt(c,f.key);return (Array.isArray(v)?v:[v]).some(x=>x&&canonical(db,f.key,x)===value);}).length,aliases:db.choiceAliases.filter(a=>a.field===f.key&&a.to===value).map(a=>a.from)}))]))};
}
function validateColumns(db,columns,context){const allowed=new Set(metadata(db,context).columns.map(c=>c.key));check(Array.isArray(columns)&&columns.length>=1&&columns.length<=16&&new Set(columns).size===columns.length&&columns.includes('name')&&columns.every(c=>allowed.has(c)),'Choose 1–16 unique columns, including Name.');return columns;}
function validateCollection(db,context){
  validateColumns(db,db.settings.columns,context);for(const view of db.views)validateColumns(db,view.columns,context);
  check(Array.isArray(db.choiceAliases)&&db.choiceAliases.length<=20000,'Invalid choice aliases.');const allowed=new Set(metadata(db,context).choices.map(f=>f.key)),seen=new Set();
  for(const a of db.choiceAliases){check(a&&allowed.has(a.field)&&typeof a.from==='string'&&typeof a.to==='string'&&a.from.trim()&&a.to.trim()&&a.from.length<=20000&&a.to.length<=20000&&a.from!==a.to,'Invalid choice alias.');const key=JSON.stringify([a.field,a.from]);check(!seen.has(key),'Duplicate choice alias.');seen.add(key);}
  for(const a of db.choiceAliases)check(!seen.has(JSON.stringify([a.field,a.to])),'Choice aliases must point directly to a current value.');
}
function ensureRevision(db,p){check(db.revision===p.revision,'The database changed. Reopen this action and review the current records.');}
function journal(db,car,title,notes,changes){car.revision++;car.updated=new Date().toISOString();db.events.unshift({id:randomUUID(),carId:car.id,type:'correction',title,notes,date:car.updated,...(changes?{changes:clone(changes)}:{})});}
function renameChoice(db,p,context,preview=false){
  ensureRevision(db,p);check(metadata(db,context).choices.some(f=>f.key===p.field),'Unknown choice field.');
  check(typeof p.from==='string'&&valuesFor(db,p.field).includes(p.from),'That choice no longer exists.');
  check(typeof p.to==='string'&&p.to.trim()&&p.to.length<=160,'Enter a choice of 1–160 characters.');const requested=p.to.trim(),prior=db.choiceAliases.find(a=>a.field===p.field&&a.from===requested),to=prior?.to===p.from?requested:canonical(db,p.field,requested);check(to!==p.from,'Choose a different value.');check(!['usage','tags'].includes(p.field)||!to.includes(','),'Usage labels and tags cannot contain commas.');
  if(!preview)check(p.confirmed===true,'Confirm the reviewed choice change.');
  const merging=valuesFor(db,p.field).includes(to),sources=new Set([p.from,...db.choiceAliases.filter(a=>a.field===p.field&&a.to===p.from).map(a=>a.from)].filter(v=>v!==to)),rows=[],skipped=[];
  if(p.updateCars===true)for(const c of db.cars){const before=valueAt(c,p.field);if(!(Array.isArray(before)?before:[before]).some(v=>sources.has(v)))continue;
    if(p.field.startsWith('tech_')&&db.installations.some(i=>i.carId===c.id&&!i.removed&&i.field===p.field.slice(5))){skipped.push({id:c.id,name:c.name,reason:'Managed by installed inventory; correct the stock part in Parts.'});continue;}
    const after=Array.isArray(before)?[...new Set(before.map(v=>sources.has(v)?to:v))]:to;setValue(c,p.field,after);rows.push({id:c.id,name:c.name,before:clone(before),after:clone(after)});const summary=value=>{const text=JSON.stringify(value);return text.length>200?text.slice(0,200)+'…':text;};journal(db,c,'Reusable choice corrected',p.field+': '+summary(before)+' → '+summary(after),[{key:p.field,before,after}]);
  }
  if(p.updateCars===true&&p.field==='usage')for(const view of db.views)view.usage=[...new Set(view.usage.map(v=>sources.has(v)?to:v))];
  db.choiceAliases=db.choiceAliases.filter(a=>!(a.field===p.field&&a.from===to));for(const a of db.choiceAliases)if(a.field===p.field&&sources.has(a.to))a.to=to;
  db.choiceAliases.push({field:p.field,from:p.from,to});
  db.choices[p.field]=[...new Set([...(db.choices[p.field]||[]).filter(v=>!sources.has(v)),to])];
  return {field:p.field,from:p.from,to,merging,rows,skipped,updateCars:p.updateCars===true};
}
function applyBulk(db,p,preview=false){
  ensureRevision(db,p);check(Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=1000&&new Set(p.ids).size===p.ids.length,'Select 1–1,000 different cars.');
  const updates=p.updates||{},labels=p.labels||{};check(updates&&typeof updates==='object'&&!Array.isArray(updates)&&labels&&typeof labels==='object'&&!Array.isArray(labels),'Invalid bulk changes.');
  check(Object.keys(updates).length+Object.keys(labels).length>0,'Choose at least one change.');
  for(const [key,value]of Object.entries(updates))check(BULK_FIELDS.includes(key)&&typeof value==='string'&&value.length<=200,'Invalid bulk field or value.');
  for(const [key,edit]of Object.entries(labels))check(['usage','tags'].includes(key)&&edit&&['add','remove','replace'].includes(edit.mode)&&Array.isArray(edit.values)&&edit.values.length<=100&&edit.values.every(v=>typeof v==='string'&&v.trim()&&v.length<=160)&&(edit.mode==='replace'||edit.values.length>0),'Invalid label change.');
  if(!preview)check(p.confirmed===true,'Confirm the reviewed bulk changes.');
  const rows=[];
  for(const id of p.ids){const c=db.cars.find(c=>c.id===id);check(c,'A selected car no longer exists.');const changes=[];
    for(const [key,after]of Object.entries(updates)){const before=c[key]||'';if(before!==after){c[key]=after;changes.push({key,before,after});}}
    for(const [key,edit]of Object.entries(labels)){const before=clone(c[key]),values=[...new Set(edit.values.map(v=>v.trim()))],after=edit.mode==='add'?[...new Set([...before,...values])]:edit.mode==='remove'?before.filter(v=>!values.includes(v)):values;check(after.length<=100,'A car cannot have more than 100 labels.');if(JSON.stringify(before)!==JSON.stringify(after)){c[key]=after;changes.push({key,before,after});}}
    if(changes.length){rows.push({id:c.id,name:c.name,changes});const describe=v=>Array.isArray(v)?v.length+' label(s)':JSON.stringify(v);journal(db,c,'Bulk details updated',changes.map(x=>x.key+': '+describe(x.before)+' → '+describe(x.after)).join('\n'),changes);}
  }
  return {selected:p.ids.length,changed:rows.length,rows};
}
function mutateCollection(db,action,p,context){
  if(action==='car.bulk')return applyBulk(db,p);
  if(action==='choice.rename')return renameChoice(db,p,context);
  ensureRevision(db,p);
  if(action==='choice.add'){check(metadata(db,context).choices.some(f=>f.key===p.field),'Unknown choice field.');check(typeof p.value==='string'&&p.value.trim()&&p.value.length<=160,'Enter a choice of 1–160 characters.');const value=canonical(db,p.field,p.value.trim());check(!['usage','tags'].includes(p.field)||!value.includes(','),'Usage labels and tags cannot contain commas.');db.choices[p.field]=[...new Set([...(db.choices[p.field]||[]),value])];return value;}
  if(action==='columns.save'){db.settings.columns=clone(validateColumns(db,p.columns,context));return;}
  throw Error('Unknown collection operation.');
}
module.exports={DEFAULT_COLUMNS,metadata,catalogue,canonical,valuesFor,rememberValue,rememberChoices,validateColumns,validateCollection,renameChoice,applyBulk,mutateCollection};
