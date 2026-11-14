'use strict';
const {randomUUID}=require('node:crypto'),w=require('./workshop.cjs'),{cloneJSON:clone}=require('./json-data.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
function validatePlan(p){if(p===undefined)return;check(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).every(k=>['carId','carRevision','jobId','reuse','assemblies','carrySpecifications','copyPhoto'].includes(k)),'Invalid rebuild plan.');check(id(p.carId)&&id(p.jobId)&&Number.isSafeInteger(p.carRevision)&&p.carRevision>0,'Invalid rebuild identity.');for(const key of ['reuse','assemblies'])check(Array.isArray(p[key])&&p[key].length<=100&&p[key].every(id)&&new Set(p[key]).size===p[key].length,'Invalid reused components.');check(typeof p.carrySpecifications==='boolean'&&typeof p.copyPhoto==='boolean','Choose rebuild copying options.');}
function validateCar(c){if(c.rebuild===undefined)return;check(c.rebuild&&typeof c.rebuild==='object'&&!Array.isArray(c.rebuild)&&Object.keys(c.rebuild).every(k=>['from','to'].includes(k)),'Invalid rebuild links.');for(const edge of Object.values(c.rebuild))check(edge&&id(edge.id)&&edge.id!==c.id&&typeof edge.name==='string'&&edge.name.length<=200&&typeof edge.date==='string'&&Number.isFinite(Date.parse(edge.date)),'Invalid rebuild link.');check(!c.rebuild.to||c.archived===true,'A rebuilt original must stay archived.');}
function context(db,carId){const car=db.cars.find(c=>c.id===carId);check(car,'Original car no longer exists.');return {carId:car.id,name:car.name,carRevision:car.revision,rebuilt:!!car.rebuild?.to,archived:!!car.archived,installations:w.active(db).filter(i=>i.carId===car.id&&!i.assemblyId).map(i=>({id:i.id,partId:i.partId,name:i.name||db.parts.find(p=>p.id===i.partId)?.name,quantity:i.quantity,field:i.field,position:i.position})),assemblies:w.liveAssemblies(db).filter(a=>a.carId===car.id).map(a=>({id:a.id,name:a.name,pieces:a.components.reduce((n,c)=>n+c.quantity,0)}))};}
function start(db,p){
 check(p.revision===db.revision,'The collection changed. Reopen Start rebuild.');const car=db.cars.find(c=>c.id===p.carId);check(require('./car-membership.cjs').active(car)&&!car.rebuild?.to,'Choose an active car that has not already been rebuilt.');
 let job=db.jobs.find(j=>j.carId===car.id&&j.status==='active');check(!job||job.category==='rebuild'&&job.kind==='general','Finish or cancel this car’s active job first.');
 const existing=job&&db.buildDrafts.find(d=>d.data.rebuild?.jobId===job.id);if(existing)return existing.id;
 if(!job){const jobId=require('./jobs.cjs').mutate(db,'job.start',{revision:db.revision,kind:'general',category:'rebuild',carId:car.id,name:p.name||('Rebuild '+car.name).slice(0,200),notes:p.notes||''},[]);job=db.jobs.find(j=>j.id===jobId);}
 const data={...require('../renderer/build-model.js').blank(),name:(car.name.slice(0,185)+' — rebuild'),maker:(car.maker||'').slice(0,200),scale:(car.scale||'').slice(0,200),usage:[...(car.usage||[])],rebuild:{carId:car.id,carRevision:car.revision,jobId:job.id,reuse:[],assemblies:[],carrySpecifications:true,copyPhoto:true}};
 const stamp=new Date().toISOString(),draft={id:randomUUID(),created:stamp,updated:stamp,data};db.buildDrafts.unshift(draft);return draft.id;
}
function plan(db,d){
 if(!d.rebuild)return null;const p=d.rebuild;validatePlan(p);const car=db.cars.find(c=>c.id===p.carId),job=db.jobs.find(j=>j.id===p.jobId);
 check(require('./car-membership.cjs').active(car)&&!car.rebuild?.to,'The original is missing, archived or already rebuilt.');check(car.revision===p.carRevision,'The original car changed. Refresh the original in the rebuild editor and review your choices.');check(job?.status==='active'&&job.kind==='general'&&job.category==='rebuild'&&job.carId===car.id,'The rebuild job is closed or changed.');
 const planning=db.planning?.jobs.find(j=>j.jobId===job.id);check(!planning?.waiting&&!planning?.checklist.some(s=>!s.done),'Finish the job checklist and clear Waiting for parts before completing the rebuild.');
 const rows=[];for(const key of p.reuse){const i=w.active(db).find(i=>i.id===key&&i.carId===car.id&&!i.assemblyId);check(i,'A reused part is no longer fitted. Refresh the original.');rows.push({partId:i.partId,name:db.parts.find(x=>x.id===i.partId).name,quantity:i.quantity,field:i.field,position:i.position,reuse:true,installationId:i.id});}
 for(const key of p.assemblies){const a=w.liveAssemblies(db).find(a=>a.id===key&&a.carId===car.id);check(a,'A reused assembly is no longer fitted. Refresh the original.');for(const c of a.components)rows.push({...c,name:db.parts.find(x=>x.id===c.partId).name,assemblyId:a.id,assemblyName:a.name,reuse:true});}
 return {car,job,rows};
}
function complete(db,preview,car){
 const d=preview.data,p=d.rebuild;if(!p)return;const old=db.cars.find(c=>c.id===p.carId),job=db.jobs.find(j=>j.id===p.jobId),stamp=new Date().toISOString(),before=require('./jobs.cjs').snapshot(db,old.id);
 // Freeze the old physical configuration before any inventory changes.
 db.setups.unshift({id:randomUUID(),carId:old.id,name:'Before rebuild',date:stamp,track:'',notes:'Original configuration before rebuilding as '+car.name,technical:clone(before.technical),installations:before.installations.map(i=>({partId:i.partId,name:i.name,quantity:i.quantity,field:i.field,position:i.position,...(i.assemblyId?{assemblyId:i.assemblyId,assemblyName:db.assemblies.find(a=>a.id===i.assemblyId).name}:{})}))});
 if(p.carrySpecifications){
  car.technical=clone(old.technical);for(const i of before.installations)if(i.field)delete car.technical[i.field];
  const changed=new Set([...before.installations.filter(i=>!p.reuse.includes(i.id)&&!p.assemblies.includes(i.assemblyId)).map(i=>i.field),...preview.rows.filter(r=>!r.reuse).map(r=>r.field)]);
  const dependent={motor:['ratedRpm','ratedVoltage','measuredRpm','measuredVoltage','measuredDate','motorTorque','torqueVoltage','motorType','torqueType'],pinionPart:['pinion'],gearPart:['gear'],rearTyres:['rearDiameter'],frontTyres:['frontDiameter']};
  for(const field of changed)for(const key of dependent[field]||[])delete car.technical[key];
 }
 for(const key of ['marque','model','reference','livery','raceClass','number'])if(old[key])car[key]=old[key];
 if(p.copyPhoto&&Object.hasOwn(old,'picture'))require('./lazy-assets.cjs').copyProperty(car,'picture',old);
 for(const a of w.liveAssemblies(db).filter(a=>a.carId===old.id)){if(p.assemblies.includes(a.id))w.installAssembly(db,a,car.id);else w.detachAssembly(db,a,'Used spares');}
 for(const i of w.active(db).filter(i=>i.carId===old.id&&!i.assemblyId)){if(p.reuse.includes(i.id)){w.endInstallation(db,i,'rebuild transfer');w.addInstallation(db,car.id,i.partId,i.quantity,i.field,i.position);}else w.returnPart(db,i,'Used spares');}
 old.technical=before.technical;old.archived=true;old.availability='Rebuilt';old.rebuild={...old.rebuild,to:{id:car.id,name:car.name,date:stamp}};car.rebuild={from:{id:old.id,name:old.name,date:stamp}};w.touch(db,old.id);
 job.status='completed';job.finished=stamp;job.updated=stamp;job.actual=before;job.log.push({date:stamp,action:'rebuild.complete',note:'Rebuilt as '+car.name,actual:clone(before)});
 w.event(db,old.id,'Rebuilt as '+car.name,'Original history and configuration preserved. Removed parts returned to stock; selected parts transferred.',{successorId:car.id});w.event(db,car.id,'Rebuilt from '+old.name,'New history starts here; earlier results remain with the original car.',{predecessorId:old.id});
}
const capability={version:1,car:'/v1/rebuilds/cars/{carId}',historicalResults:'original-car',newCaptures:'successor-car'};
function lifecycle(store,carId){const car=store.file&&store.expectedIdentity!==null?require('./sqlite-query.cjs').read(store,null,r=>r.one('cars',carId)).value:store.data.cars.find(c=>c.id===carId);if(!car)throw require('./timing-integration.cjs').fault('CAR_NOT_FOUND','Car not found.',404);return {version:1,databaseId:store.data.id,carId:car.id,archived:!!car.archived,predecessor:car.rebuild?.from||null,successor:car.rebuild?.to||null};}
module.exports={validatePlan,validateCar,context,start,plan,complete,capability,lifecycle};
