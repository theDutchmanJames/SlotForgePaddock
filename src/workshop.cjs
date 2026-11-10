const {randomUUID}=require('node:crypto');
const {cloneJSON:clone}=require('./json-data.cjs');
const now=()=>new Date().toISOString();
function check(ok,message){if(!ok)throw new Error(message);}
function label(value,max=200){check(typeof value==='string'&&value.trim()&&value.length<=max,'Enter a valid name or location.');return value.trim();}
const active=db=>db.installations.filter(i=>!i.removed);
const liveAssemblies=db=>(db.assemblies||[]).filter(a=>!a.dismantled);
const partLabel=p=>p.name+(p.reference?' ['+p.reference+']':p.tracking==='individual'?' ['+p.id.slice(0,8)+']':'');
const assemblyForPart=(db,id)=>liveAssemblies(db).find(a=>a.components.some(c=>c.partId===id));
function available(db,part){
  const reserved=liveAssemblies(db).filter(a=>!a.carId).flatMap(a=>a.components).filter(c=>c.partId===part.id).reduce((n,c)=>n+c.quantity,0);
  return part.quantity-reserved-active(db).filter(i=>i.partId===part.id).reduce((n,i)=>n+i.quantity,0);
}
function touch(db,id){const c=db.cars.find(c=>c.id===id);check(c,'Car not found.');c.revision++;c.updated=now();return c;}
function event(db,carId,title,notes='',extra={}){db.events.unshift({id:randomUUID(),carId,type:'modification',title,notes,date:now(),...extra});}
function addInstallation(db,carId,partId,quantity,field,position,assemblyId){
  const c=db.cars.find(c=>c.id===carId),part=db.parts.find(p=>p.id===partId);
  check(c&&part,'Car or component no longer exists.');check(!c.rebuild?.to,'This original was rebuilt. Fit parts to its successor car.');
  check(!field||!active(db).some(i=>i.carId===carId&&i.field===field),'The '+field+' position is already occupied.');
  const i={id:randomUUID(),carId,partId,name:part.name,quantity,field:field||'',position:position||part.category,installed:now(),removed:null};
  if(assemblyId)i.assemblyId=assemblyId;
  db.installations.push(i);if(field)c.technical[field]=part.name;return i;
}
function endInstallation(db,i,destination){
  i.removed=now();i.destination=destination;
  const c=db.cars.find(c=>c.id===i.carId);if(i.field)c.technical[i.field]='';
}
function returnPart(db,i,location='Used spares'){
  check(!i.assemblyId,'Remove the complete assembly or dismantle it first.');
  const part=db.parts.find(p=>p.id===i.partId);endInstallation(db,i,'spares');
  if(part.tracking==='individual'){part.condition='Used';part.location=location;part.updated=now();}
  else{part.quantity-=i.quantity;db.parts.push({...clone(part),id:randomUUID(),sourcePartId:part.sourcePartId||part.id,quantity:i.quantity,condition:'Used',location,created:now(),updated:now()});}
}
function detachAssembly(db,a,location){
  const from=a.carId;check(from,'Assembly is already in storage.');
  for(const i of active(db).filter(i=>i.assemblyId===a.id))endInstallation(db,i,'assembly storage');
  for(const component of a.components){const p=db.parts.find(p=>p.id===component.partId);p.condition='Used';p.location=location;p.updated=now();}
  a.carId=null;a.location=location;a.updated=now();touch(db,from);event(db,from,'Removed assembly: '+a.name,'Kept together in '+location);
}
// A reviewed replacement releases just this component. Other assembly members
// remain fitted; the old installation keeps its assembly identity for history.
function returnReviewedPart(db,i){
  const a=i.assemblyId?liveAssemblies(db).find(a=>a.id===i.assemblyId):null;
  if(a){
    const before=clone(a.components),remaining=a.components.filter(c=>c.partId!==i.partId);
    check(before.length!==remaining.length,'Assembly component no longer exists.');
    if(remaining.length){a.components=remaining;(a.history??=[]).push({date:now(),before,after:clone(remaining),removedName:db.parts.find(p=>p.id===i.partId).name,installedName:'Returned to used stock'});}
    else {a.dismantled=now();a.carId=null;}
    a.updated=now();delete i.assemblyId;
  }
  returnPart(db,i);
  if(a)i.assemblyId=a.id;
  event(db,i.carId,'Review override: returned '+(i.name||db.parts.find(p=>p.id===i.partId).name)+' to stock',`${i.quantity} piece(s) returned to Used spares${a?' from '+a.name+(a.dismantled?'; assembly dismantled':'; other components stay fitted'):''}. Incoming value is an untracked specification.`);
}
function installAssembly(db,a,carId){
  const from=a.carId;check(from!==carId,'Assembly is already installed on this car.');
  if(from){for(const i of active(db).filter(i=>i.assemblyId===a.id))endInstallation(db,i,'transfer');touch(db,from);event(db,from,'Transferred assembly: '+a.name,'To '+db.cars.find(c=>c.id===carId)?.name);}
  for(const c of a.components)addInstallation(db,carId,c.partId,c.quantity,c.field,c.position,a.id);
  a.carId=carId;a.updated=now();touch(db,carId);event(db,carId,'Installed assembly: '+a.name,from?'Transferred from '+db.cars.find(c=>c.id===from)?.name:'From '+a.location);
}
function validateWorkshop(db,techFields){
  check(Array.isArray(db.assemblies)&&db.assemblies.length<=10000,'Invalid assemblies.');
  const ids=new Set(),reserved=new Map(),reservedQuantities=new Map(),used=new Map(),installedByPart=new Map();
  const parts=new Map(db.parts.map(p=>[p.id,p])),cars=new Set(db.cars.map(c=>c.id)),installed=active(db),assemblies=new Map(liveAssemblies(db).map(a=>[a.id,a]));
  for(const i of installed){used.set(i.partId,(used.get(i.partId)||0)+i.quantity);if(!installedByPart.has(i.partId))installedByPart.set(i.partId,[]);installedByPart.get(i.partId).push(i);}
  for(const a of db.assemblies){
    check(typeof a.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(a.id)&&!Object.hasOwn(Object.prototype,a.id)&&a.id!=='prototype'&&!ids.has(a.id),'Invalid assembly identity.');ids.add(a.id);label(a.name);
    check(typeof a.location==='string'&&a.location.length<=200&&typeof a.notes==='string'&&a.notes.length<=20000,'Invalid assembly details.');
    check(Array.isArray(a.components)&&a.components.length>0&&a.components.length<=100,'An assembly needs 1–100 components.');
    if(a.history!==undefined){check(Array.isArray(a.history),'Invalid assembly history.');for(const entry of a.history){check(entry&&typeof entry.date==='string'&&typeof entry.removedName==='string'&&entry.removedName.length<=200&&typeof entry.installedName==='string'&&entry.installedName.length<=200,'Invalid assembly history entry.');for(const rows of [entry.before,entry.after]){check(Array.isArray(rows)&&rows.length>0&&rows.length<=100,'Invalid assembly history components.');for(const c of rows)check(c&&parts.has(c.partId)&&Number.isSafeInteger(c.quantity)&&c.quantity>0&&typeof c.position==='string'&&c.position.length<=160&&typeof c.field==='string'&&(!c.field||techFields.includes(c.field)),'Invalid assembly history component.');}}}
    for(const c of a.components)check(c&&typeof c.position==='string'&&c.position.length<=160&&Number.isSafeInteger(c.quantity)&&c.quantity>0&&parts.has(c.partId),'Invalid assembly component.');
    if(a.dismantled){check(typeof a.dismantled==='string','Invalid dismantling record.');continue;}
    check(!a.carId||cars.has(a.carId),'Assembly car is missing.');
    const positions=new Set();
    for(const c of a.components){
      const part=parts.get(c.partId);
      check(part&&Number.isInteger(c.quantity)&&c.quantity>0&&c.quantity===part.quantity,'Assembly components must have dedicated stock.');
      check(!reserved.has(c.partId),'A component cannot belong to two assemblies.');reserved.set(c.partId,a.id);
      if(!a.carId)reservedQuantities.set(c.partId,c.quantity);
      check(!c.field||techFields.includes(c.field),'Invalid assembly component field.');
      if(c.field){check(!positions.has(c.field),'Assembly positions must be unique.');positions.add(c.field);}
      const installs=installedByPart.get(c.partId)||[];
      check(a.carId?installs.length===1&&installs[0].assemblyId===a.id&&installs[0].carId===a.carId&&installs[0].quantity===c.quantity&&installs[0].field===c.field:installs.length===0,'Assembly stock and installations disagree.');
    }
  }
  const slots=new Set();
  for(const i of installed){
    if(i.assemblyId){const a=assemblies.get(i.assemblyId);check(a&&a.carId===i.carId&&reserved.get(i.partId)===a.id,'Orphan assembly installation.');}
    if(i.field){check(techFields.includes(i.field),'Invalid installation field.');const slot=i.carId+':'+i.field;check(!slots.has(slot),'Two components occupy the same technical field.');slots.add(slot);}
  }
  for(const part of db.parts)check(part.quantity-(used.get(part.id)||0)-(reservedQuantities.get(part.id)||0)>=0,'Installed or reserved stock exceeds owned quantity.');
}
function requirements(setup){
  const result=[],groups=new Map();
  for(const [index,i] of (setup.installations||[]).entries()){
    if(i.assemblyId){let r=groups.get(i.assemblyId);if(!r){r={key:String(index),kind:'assembly',assemblyId:i.assemblyId,name:i.assemblyName||'Saved assembly',components:[]};groups.set(i.assemblyId,r);result.push(r);}r.components.push(i);}
    else result.push({key:String(index),kind:'part',name:i.name,...i});
  }
  return result;
}
function compatible(a,r){const shape=components=>components.map(c=>JSON.stringify([c.field||'',c.quantity,c.field?'':c.position])).sort().join('|');return shape(a.components)===shape(r.components);}
function setupOptions(db,id){
  const setup=db.setups.find(s=>s.id===id);check(setup,'Setup not found.');
  const preferredInstallations=new Set();
  const rows=requirements(setup).map(r=>{
    let choices=[],selected='';
    if(r.kind==='assembly'){
      choices=liveAssemblies(db).filter(a=>compatible(a,r)).map(a=>({value:'a:'+a.id,label:a.name+' · '+(a.carId?'on '+db.cars.find(c=>c.id===a.carId).name:a.location||'Storage')}));
      if(choices.some(c=>c.value==='a:'+r.assemblyId))selected='a:'+r.assemblyId;
    }else{
      choices=db.parts.filter(p=>available(db,p)>=r.quantity).map(p=>({value:'p:'+p.id,label:partLabel(p)+' · '+p.condition+' · '+available(db,p)+' free · '+(p.location||'No location')}));
      choices.push(...active(db).filter(i=>!i.assemblyId&&i.quantity===r.quantity).map(i=>({value:'i:'+i.id,label:partLabel(db.parts.find(p=>p.id===i.partId))+' · on '+db.cars.find(c=>c.id===i.carId).name+' · '+(i.field||i.position)})));
      const installed=active(db).find(i=>!preferredInstallations.has(i.id)&&i.carId===setup.carId&&!i.assemblyId&&i.partId===r.partId&&i.quantity===r.quantity&&i.field===r.field&&i.position===r.position);
      if(installed){selected='i:'+installed.id;preferredInstallations.add(installed.id);}
      else if(choices.some(c=>c.value==='p:'+r.partId))selected='p:'+r.partId;
    }
    return {...r,choices,selected};
  });
  return {revision:db.revision,setup:clone(setup),rows};
}
// This runs on a disposable draft for previews, and inside Store.transact for commits.
function applySetup(db,p,preview=false){
  check(p.revision===db.revision,'The database changed. Reopen Apply setup to review fresh stock.');
  const setup=db.setups.find(s=>s.id===p.id);check(setup,'Setup not found.');
  const car=db.cars.find(c=>c.id===setup.carId),before=clone(car.technical);
  check(!car.rebuild?.to,'This original was rebuilt. Apply new configurations to its successor car.');
  const reqs=requirements(setup),usedSources=new Set(),picked=[];
  const changes=[],transfers=[];
  for(const r of reqs){
    const value=p.selections?.[r.key];check(typeof value==='string'&&value,'Choose a component for '+r.name+'.');
    const [type,id]=value.split(':');
    check(type==='p'||!usedSources.has(value),'The same installed component or assembly was selected twice.');usedSources.add(value);
    if(r.kind==='assembly'){
      const a=liveAssemblies(db).find(a=>a.id===id);check(type==='a'&&a&&compatible(a,r),'Choose a compatible assembly for '+r.name+'.');
      if(a.carId&&a.carId!==car.id)transfers.push(a.name+' from '+db.cars.find(c=>c.id===a.carId).name);
      picked.push({r,a});
    }else{
      const i=type==='i'?active(db).find(i=>i.id===id&&!i.assemblyId):null;
      const part=db.parts.find(part=>part.id===(i?i.partId:id));
      check(part&&(type==='p'||i),'Component no longer available.');
      check(type==='p'?available(db,part)>=r.quantity:i.quantity===r.quantity,'Insufficient stock for '+r.name+'.');
      if(i&&i.carId!==car.id)transfers.push(partLabel(part)+' from '+db.cars.find(c=>c.id===i.carId).name);
      picked.push({r,i,part});
    }
  }
  if(!preview){check(p.confirmed===true,'Confirm that you have made the physical changes.');check(!transfers.length||p.allowTransfers===true,'Confirm the listed transfers from other cars.');}
  const keepAssemblies=new Set(picked.filter(x=>x.a).map(x=>x.a.id));
  for(const a of liveAssemblies(db).filter(a=>a.carId===car.id&&!keepAssemblies.has(a.id))){changes.push('Return assembly '+a.name+' to Used spares (kept together)');detachAssembly(db,a,'Used spares');}
  const keepInstalls=new Set(picked.filter(x=>x.i).map(x=>x.i.id));
  for(const i of active(db).filter(i=>i.carId===car.id&&!i.assemblyId&&!keepInstalls.has(i.id))){changes.push('Return '+i.quantity+' × '+db.parts.find(p=>p.id===i.partId).name+' to Used spares');returnPart(db,i);}
  // End selected loose installations first so swapping positions is atomic.
  for(const x of picked.filter(x=>x.i)){
    x.from=x.i.carId;x.keep=x.from===car.id&&x.i.field===x.r.field&&x.i.position===x.r.position;
    if(!x.keep)endInstallation(db,x.i,x.from===car.id?'setup reposition':'transfer');
    if(x.from!==car.id){touch(db,x.from);event(db,x.from,'Transferred '+x.part.name,'To '+car.name);}
  }
  car.technical=clone(setup.technical);
  for(const x of picked){
    if(x.a){
      changes.push((x.a.carId===car.id?'Keep assembly ':x.a.carId?'Transfer assembly ':'Install assembly ')+x.a.name+(x.a.id!==x.r.assemblyId?' (substitute for '+x.r.name+')':''));
      if(x.a.carId!==car.id)installAssembly(db,x.a,car.id);
      for(const c of x.a.components)if(c.field)car.technical[c.field]=db.parts.find(p=>p.id===c.partId).name;
    }else{
      if(x.keep){if(x.r.field)car.technical[x.r.field]=x.part.name;}
      else{check(available(db,x.part)>=x.r.quantity,'Selected stock is no longer available.');addInstallation(db,car.id,x.part.id,x.r.quantity,x.r.field,x.r.position);}
      changes.push((x.keep?'Keep ':x.from===car.id?'Reposition ':x.from?'Transfer ':'Install ')+x.r.quantity+' × '+partLabel(x.part)+(x.part.id!==x.r.partId?' (substitute for '+x.r.name+')':''));
    }
  }
  const fields=[...new Set([...Object.keys(before),...Object.keys(car.technical)])].filter(k=>(before[k]||'')!==(car.technical[k]||'')).map(key=>({key,before:before[key]||'',after:car.technical[key]||''}));
  const summary=changes.join('\n')||'Restored recorded settings.';
  touch(db,car.id);event(db,car.id,'Applied setup: '+setup.name,summary.length>20000?summary.slice(0,19999)+'…':summary,{setupId:setup.id,movements:clone(changes),technical:clone(car.technical),installations:clone(active(db).filter(i=>i.carId===car.id).map(i=>({...i,name:db.parts.find(p=>p.id===i.partId).name})))});
  return {revision:p.revision,changes,transfers,fields,carName:car.name,setupName:setup.name};
}
function mutateWorkshop(db,action,p,techFields){
  check(p.revision===db.revision,'The database changed. Reopen this workshop action before saving.');
  if(action==='setup.apply')return applySetup(db,p);
  if(action==='assembly.create'){
    check(Array.isArray(p.components)&&p.components.length>0&&p.components.length<=100,'Choose 1–100 components.');
    const a={id:randomUUID(),name:label(p.name),location:label(p.location||'Assembly storage'),notes:typeof p.notes==='string'?p.notes.slice(0,20000):'',components:[],carId:null,created:now(),updated:now()};
    const used=new Set();
    for(const c of p.components){
      const part=db.parts.find(x=>x.id===c.partId),quantity=Number(c.quantity);
      check(part&&(part.tracking==='quantity'||!used.has(part.id)),'An individual component can only be selected once.');used.add(part.id);
      check(Number.isInteger(quantity)&&quantity>0&&quantity<=available(db,part),'Not enough available stock.');
      check(!c.field||techFields.includes(c.field),'Invalid component field.');
      let dedicated=part;
      if(part.tracking==='quantity'){
        part.quantity-=quantity;dedicated={...clone(part),id:randomUUID(),sourcePartId:part.sourcePartId||part.id,quantity,location:a.location,created:now(),updated:now()};db.parts.push(dedicated);
      }
      dedicated.location=a.location;
      a.components.push({partId:dedicated.id,quantity,field:c.field||'',position:label(c.position||part.category,160)});
    }
    db.assemblies.push(a);return a.id;
  }
  const a=liveAssemblies(db).find(a=>a.id===p.id);check(a,'Assembly not found or already dismantled.');
  if(action==='assembly.install'){
    check(db.cars.some(c=>c.id===p.carId&&!c.archived),'Choose an active car.');
    check(!a.carId||p.allowTransfer===true,'Confirm the transfer from the current car.');installAssembly(db,a,p.carId);
  }else if(action==='assembly.replace'){
    check(p.confirmed===true,'Confirm the physical component replacement.');
    const index=a.components.findIndex(c=>c.partId===p.componentId);check(index>=0,'Assembly component no longer exists.');
    const old=clone(a.components[index]),part=db.parts.find(x=>x.id===p.partId);
    check(part&&part.id!==old.partId&&available(db,part)>=old.quantity,'Choose sufficient available replacement stock.');
    const previous=db.parts.find(x=>x.id===old.partId),before=clone(a.components);
    for(const i of active(db).filter(i=>i.assemblyId===a.id&&i.partId===old.partId))endInstallation(db,i,'assembly replacement');
    // The old dedicated lot is released intact; it must not be counted as new stock.
    previous.condition='Used';previous.location=label(p.location||'Used spares');previous.updated=now();
    let dedicated=part;
    if(part.tracking==='quantity'){part.quantity-=old.quantity;dedicated={...clone(part),id:randomUUID(),sourcePartId:part.sourcePartId||part.id,quantity:old.quantity,created:now(),updated:now()};db.parts.push(dedicated);}
    dedicated.location=a.location;dedicated.updated=now();
    a.components[index]={...old,partId:dedicated.id};a.updated=now();
    const record={date:now(),before,after:clone(a.components),removedName:previous.name,installedName:dedicated.name};
    (a.history??=[]).push(record);
    if(a.carId){addInstallation(db,a.carId,dedicated.id,old.quantity,old.field,old.position,a.id);touch(db,a.carId);event(db,a.carId,'Replaced component in '+a.name,previous.name+' → '+dedicated.name,{assemblyId:a.id,...clone(record)});}
  }else if(action==='assembly.remove')detachAssembly(db,a,label(p.location||'Used spares'));
  else if(action==='assembly.dismantle'){
    for(const i of active(db).filter(i=>i.assemblyId===a.id))delete i.assemblyId;
    if(a.carId){touch(db,a.carId);event(db,a.carId,'Dismantled assembly: '+a.name,'Components remain installed separately.');}
    a.dismantled=now();a.updated=now();
  }else throw new Error('Unknown workshop operation.');
}
module.exports={available,assemblyForPart,validateWorkshop,setupOptions,applySetup,mutateWorkshop,requirements,compatible,active,liveAssemblies,touch,event,addInstallation,endInstallation,returnPart,returnReviewedPart,detachAssembly,installAssembly};
