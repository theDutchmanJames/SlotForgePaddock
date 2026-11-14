const {randomUUID}=require('node:crypto');
const w=require('./workshop.cjs');
const Model=require('../renderer/build-model.js');
const Performance=require('../renderer/performance-model.js');
const purchasing=require('./purchasing.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max)=>typeof v==='string'&&v.length<=max;
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)&&!Object.hasOwn(Object.prototype,v)&&v!=='prototype';
function validateData(d){
  check(object(d),'Invalid build.');
  require('./rebuild.cjs').validatePlan(d.rebuild);
  for(const [k,max] of [['name',200],['maker',200],['scale',200],['notes',20000]])check(text(d[k],max),'Invalid build '+k+'.');
  check(typeof d.saveSetup==='boolean','Invalid setup preference.');
  Performance.clean(d.performance);Performance.baseline(d.performanceBaseline);
  if(d.gearing!==undefined){check(object(d.gearing),'Invalid build gearing.');for(const key of ['pinion','gear'])check(d.gearing[key]===''||(text(d.gearing[key],16)&&Model.toothCount(d.gearing[key])), 'Enter a positive whole tooth count for '+(key==='pinion'?'the pinion.':'the crown / axle gear.'));}
  check(Array.isArray(d.usage)&&d.usage.length<=100&&d.usage.every(v=>text(v,160)),'Invalid build usage labels.');
  check(Array.isArray(d.parts)&&d.parts.length<=100&&Array.isArray(d.assemblies)&&d.assemblies.length<=25,'Choose at most 100 part assignments and 25 assemblies.');
  const keys=new Set(),slots=new Set();
  for(const row of d.parts){
    check(object(row)&&id(row.key)&&!keys.has(row.key)&&id(row.partId),'Invalid build part identity.');keys.add(row.key);
    check(Number.isSafeInteger(row.quantity)&&row.quantity>0,'Choose a positive whole quantity.');
    check(row.slot===''||Model.slots.some(s=>s.id===row.slot),'Invalid build position.');
    if(row.slot){check(!slots.has(row.slot),'Choose one assignment per diagram position.');slots.add(row.slot);}
    check(text(row.position,160)&&text(row.name,200),'Invalid build part description.');
  }
  const assemblies=new Set();
  for(const a of d.assemblies){check(object(a)&&id(a.id)&&!assemblies.has(a.id)&&text(a.name,200)&&text(a.signature,100000),'Invalid build assembly.');assemblies.add(a.id);}
  return d;
}
function cleanData(input){
  validateData(input);
  return {name:input.name.trim(),maker:input.maker.trim(),scale:input.scale.trim(),notes:input.notes,usage:[...new Set(input.usage.map(v=>v.trim()).filter(Boolean))],saveSetup:input.saveSetup,...(input.rebuild?{rebuild:require('./json-data.cjs').cloneJSON(input.rebuild)}:{}),
    gearing:{pinion:input.gearing?.pinion.trim()||'',gear:input.gearing?.gear.trim()||''},
    performance:Performance.clean(input.performance),performanceBaseline:Performance.baseline(input.performanceBaseline),
    parts:input.parts.map(r=>Object.fromEntries(['key','partId','quantity','slot','position','name'].map(k=>[k,r[k]]))),
    assemblies:input.assemblies.map(a=>({id:a.id,name:a.name,signature:a.signature}))};
}
function validateDrafts(db){
  check(Array.isArray(db.buildDrafts)&&db.buildDrafts.length<=100,'Invalid build drafts.');const ids=new Set();
  for(const draft of db.buildDrafts){check(object(draft)&&id(draft.id)&&!ids.has(draft.id)&&text(draft.created,100)&&text(draft.updated,100),'Invalid build draft.');ids.add(draft.id);validateData(draft.data);}
  // Drafts are plans: missing or no-longer-available inventory is checked when building, not on unrelated edits.
}
function plan(db,p){
  const data=cleanData(p.data);check(data.name,'Enter a name for your new car.');
  if(p.draftId){const draft=db.buildDrafts.find(d=>d.id===p.draftId);check(draft,'This draft no longer exists. Start a new build or reload a saved draft.');check((draft.data.rebuild?.jobId||null)===(data.rebuild?.jobId||null)&&(draft.data.rebuild?.carId||null)===(data.rebuild?.carId||null),'This draft belongs to a different build or rebuild job. Reopen the correct draft.');}
  const rebuild=require('./rebuild.cjs').plan(db,data);
  check(data.parts.length||data.assemblies.length||rebuild?.rows.length,'Choose at least one inventory part, reused part or assembly.');
  const rows=[],claimed=new Set(),totals=new Map();
  const claim=field=>{if(field){check(!claimed.has(field),'More than one selection occupies '+(Model.slots.find(s=>s.field===field)?.label||field)+'. Remove the overlapping assignment or assembly.');claimed.add(field);}};
  for(const row of rebuild?.rows||[]){claim(row.field);rows.push(row);}
  for(const selected of data.assemblies){
    const a=db.assemblies.find(a=>a.id===selected.id&&!a.dismantled);check(a,'An assembly is missing or dismantled. Remove it from the build.');
    check(!a.carId,a.name+' is already installed on a car. Only stored assemblies can be used.');
    check(Model.signature(a)===selected.signature,a.name+' has changed. Remove and select it again to review its current components.');
    for(const component of a.components){
      const part=db.parts.find(p=>p.id===component.partId);check(part,'An assembly component is missing.');claim(component.field);
      rows.push({partId:part.id,name:part.name,quantity:component.quantity,field:component.field,position:component.position,assemblyId:a.id,assemblyName:a.name});
    }
  }
  for(const selected of data.parts){
    const part=db.parts.find(p=>p.id===selected.partId);check(part,(selected.name||'Selected part')+' no longer exists. Remove or replace it.');
    check(!w.assemblyForPart(db,part.id),part.name+' belongs to an assembly. Select the complete assembly or dismantle it first.');
    const slot=Model.slots.find(s=>s.id===selected.slot),field=slot?.field||'';claim(field);
    totals.set(part.id,(totals.get(part.id)||0)+selected.quantity);
    check(totals.get(part.id)<=w.available(db,part),part.name+' has insufficient available stock for this build.');
    rows.push({partId:part.id,name:part.name,quantity:selected.quantity,field,position:slot?.label||selected.position||'Additional part'});
  }
  const gearing=Model.gearing({...data,parts:[...data.parts,...(rebuild?.rows||[]).filter(r=>['pinionPart','gearPart'].includes(r.field)).map(r=>({partId:r.partId,slot:r.field}))]},db);
  return {revision:db.revision,data,rows,...(rebuild?{rebuild:{name:rebuild.car.name,returnedPieces:w.active(db).filter(i=>i.carId===rebuild.car.id&&!data.rebuild.reuse.includes(i.id)&&!data.rebuild.assemblies.includes(i.assemblyId)).reduce((n,i)=>n+i.quantity,0)}}:{}),gearing:{pinion:gearing.pinion.value,gear:gearing.gear.value},pieces:rows.reduce((n,r)=>n+r.quantity,0)};
}
function mutate(db,action,p,remember){
  check(p.revision===db.revision,'The database changed. Refresh stock and review this build again; your selections are kept.');
  if(action==='build.draft.delete'){check(db.buildDrafts.some(d=>d.id===p.id),'Draft not found.');check(!db.buildDrafts.find(d=>d.id===p.id).data.rebuild,'Cancel this rebuild from its Workshop job.');purchasing.cancelBuild(db,p.id,new Date().toISOString());db.buildDrafts=db.buildDrafts.filter(d=>d.id!==p.id);return p.id;}
  if(action==='build.draft.save'){
    const data=cleanData(p.data),stamp=new Date().toISOString();
    const draft=p.id?db.buildDrafts.find(d=>d.id===p.id):{id:randomUUID(),created:stamp};check(draft,'Draft not found.');
    check(!data.rebuild||db.jobs.some(j=>j.id===data.rebuild.jobId&&j.carId===data.rebuild.carId&&j.status==='active'&&j.kind==='general'&&j.category==='rebuild'),'This rebuild job is closed or missing.');
    check(!draft.data||(draft.data.rebuild?.jobId||null)===(data.rebuild?.jobId||null)&&(draft.data.rebuild?.carId||null)===(data.rebuild?.carId||null),'A saved draft cannot become an unrelated build or rebuild.');
    check(!data.rebuild||!db.buildDrafts.some(d=>d.id!==draft.id&&d.data.rebuild?.jobId===data.rebuild.jobId),'This rebuild already has a draft. Open that draft before saving.');
    Object.assign(draft,{data,updated:stamp});if(!p.id)db.buildDrafts.unshift(draft);
    syncShopping(db,draft,stamp);return draft.id;
  }
  check(action==='build.create','Unknown build action.');check(p.confirmed===true,'Review and confirm the parts to fit before saving.');
  const preview=plan(db,p),d=preview.data,stamp=new Date().toISOString();
  const car={id:randomUUID(),revision:1,created:stamp,updated:stamp,name:d.name,maker:d.maker,scale:d.scale,privateNotes:d.notes,usage:d.usage,tags:[],technical:{},factory:{},photos:[],custom:{},ownership:'Owned',availability:'Available'};
  db.cars.push(car);
  require('./rebuild.cjs').complete(db,preview,car);
  for(const a of d.assemblies)w.installAssembly(db,db.assemblies.find(item=>item.id===a.id),car.id);
  for(const r of preview.rows.filter(r=>!r.assemblyId&&!r.reuse))w.addInstallation(db,car.id,r.partId,r.quantity,r.field,r.position);
  for(const key of ['pinion','gear'])if(preview.gearing[key])car.technical[key]=preview.gearing[key];
  if(Performance.keys.some(key=>d.performance[key]&&d.performance[key]!=='Unknown'))for(const key of Performance.keys)if(d.performance[key])car.technical[key]=d.performance[key];
  const installations=w.active(db).filter(i=>i.carId===car.id).map(i=>({partId:i.partId,name:db.parts.find(p=>p.id===i.partId).name,quantity:i.quantity,field:i.field,position:i.position,...(i.assemblyId?{assemblyId:i.assemblyId,assemblyName:db.assemblies.find(a=>a.id===i.assemblyId).name}:{})}));
  const event=(type,title)=>db.events.unshift({id:randomUUID(),carId:car.id,type,title,date:stamp,notes:'',technical:require('./json-data.cjs').cloneJSON(car.technical),installations:require('./json-data.cjs').cloneJSON(installations)});
  event('created','Built from scratch');
  if(d.saveSetup){db.setups.unshift({id:randomUUID(),carId:car.id,name:'As built',date:stamp,track:'',notes:'',technical:require('./json-data.cjs').cloneJSON(car.technical),installations:require('./json-data.cjs').cloneJSON(installations)});event('setup','Saved As built');}
  remember(car);
  for(const line of db.planning.shopping.filter(s=>s.buildId===p.draftId||d.rebuild&&s.buildId&&s.jobId===d.rebuild.jobId)){line.buildCarId=car.id;line.buildName=car.name;}
  for(const draft of db.buildDrafts.filter(draft=>draft.id===p.draftId||d.rebuild&&draft.data.rebuild?.jobId===d.rebuild.jobId))require('./shopping-requirements.cjs').build(db,draft,stamp,'completed');
  if(p.draftId)db.buildDrafts=db.buildDrafts.filter(d=>d.id!==p.draftId);
  if(d.rebuild)db.buildDrafts=db.buildDrafts.filter(draft=>draft.data.rebuild?.jobId!==d.rebuild.jobId);
  return car.id;
}
function syncShopping(db,draft,stamp){
 for(const row of draft.data.parts){const part=db.parts.find(p=>p.id===row.partId);check(part,'A selected part no longer exists. Remove it from the plan.');check(!w.assemblyForPart(db,part.id),'Choose the complete assembly rather than its component stock.');}
 require('./shopping-requirements.cjs').build(db,draft,stamp);
}
module.exports={validateDrafts,plan,mutate};
