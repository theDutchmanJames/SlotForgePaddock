'use strict';
// Phase 2 domain implementation, deliberately not registered with Store, the
// shared engine, IPC, or either public integration. See car-merge-storage.cjs.
const {cloneJSON:clone}=require('./json-data.cjs'),A=require('./car-merge-archive.cjs');
const lazy=require('./lazy-assets.cjs'),w=require('./workshop.cjs');
const collections=['documents','setups','tests','jobs','events'];
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const check=(ok,message,code='MERGE_SELECTION_CONFLICT')=>{if(!ok)fail(code,message);};
const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&!Object.hasOwn(Object.prototype,id)&&id!=='prototype';
const same=(a,b)=>A.digest(a)===A.digest(b);
const car=(db,id)=>{const c=db.cars.find(c=>c.id===id);if(!c)fail('CAR_NOT_FOUND','Car no longer exists.');return c;};
const historyKey=(source,session,participant)=>JSON.stringify([source,session,participant]);
function init(db){
 if(db.mergeMeta)return;
 db.mergeMeta={version:1,revision:0};
 for(const key of ['mergeProposals','mergeMappings','mergeInclusions','mergeArchives','mergeChunks','mergeCompanions'])db[key]??=[];
}
function resolve(db,id,recoveryId){
 car(db,id);const path=[],seen=new Set();let current=id;
 while(true){check(!seen.has(current),'Merge identity cycle.','MERGE_LINEAGE_CONFLICT');seen.add(current);const edge=(db.mergeMappings||[]).find(m=>m.retiredCarId===current);if(!edge)break;path.push(edge.id);current=edge.mainCarId;car(db,current);}
 return {version:1,databaseId:db.id,recoveryId,mergeRevision:db.mergeMeta?.revision||0,requestedCarId:id,canonicalCarId:current,state:path.length?'merged':'current',mergeIds:path};
}
function assertWritable(db,id){const edge=(db.mergeMappings||[]).find(m=>m.retiredCarId===id);if(edge)fail('CAR_MERGED','This car was merged. Reopen its main car; do not rewrite a queued command.');}
function contributions(db){
 const rows=[];
 for(const record of db.timing.sessions){
  const race=record.format==='history-v1'?record.bundle?.race:record.payload;
  const source=record.sourceId||record.payload?.source?.id,session=record.sessionId||record.payload?.sessionId;
  if(!race||!source||!session)continue;
  for(const p of race.participants||[]){if(!p.carId)continue;
   rows.push({key:historyKey(source,session,p.id),sourceId:source,sessionId:session,participantId:p.id,carId:p.carId,record,participant:p,format:record.format||'timing-v1',
    withdrawn:(record.state||record.payload?.state)==='withdrawn',virtual:p.kind==='virtual'});
  }
 }
 for(const origin of db.libraryOrigins||[]){
  if(origin.entity!=='session'||origin.projectionStatus!=='raw-only')continue;
  const extra=(db.libraryExtras||[]).find(e=>e.namespace==='timing.historyOriginals'&&e.sourceId===origin.sourceId&&e.originalId===origin.originalId);
  check(extra,'Original-only session has lost its evidence.');
  const raw=require('./shared-library-evidence.cjs').decode(extra),counts=new Map((origin.carIds||[]).map(id=>[id,0]));
  for(const lap of raw.laps||[]){if(lap.virtual||lap.virtualRival)continue;const id=counts.has(lap.carId)?lap.carId:(db.libraryOrigins||[]).find(o=>o.entity==='car'&&o.sourceId===origin.sourceId&&o.originalId===lap.carId)?.carId;if(counts.has(id))counts.set(id,counts.get(id)+1);}
  for(const [carId,count]of counts){const participantId='raw-car-'+A.digest(carId).slice(0,48);rows.push({key:historyKey(origin.sourceId,origin.sessionId,participantId),sourceId:origin.sourceId,sessionId:origin.sessionId,participantId,carId,record:{origin,extra},participant:null,format:'raw-only',rawOnly:true,lapCount:count,startedAt:origin.startedAt||require('./shared-library-lap-counts.cjs').startedAt(raw),withdrawn:origin.state==='withdrawn',virtual:false});}
 }
 return rows;
}
function disposition(db,row,target){
 if((db.mergeInclusions||[]).some(i=>i.key===row.key&&(i.originalCarId!==row.carId||i.format!==row.format)))return 'conflict';
 let id=row.carId;const seen=new Set();
 while(id!==target){
  if(seen.has(id))fail('MERGE_LINEAGE_CONFLICT','Merge identity cycle.');seen.add(id);
  const edge=(db.mergeMappings||[]).find(m=>m.retiredCarId===id);if(!edge)return 'unrelated';
  const decision=(db.mergeInclusions||[]).find(i=>i.mergeId===edge.id&&i.key===row.key);
  if(!decision||decision.status==='pending')return 'pending';
  if(decision.status!=='included')return 'excluded';id=edge.mainCarId;
 }
 return row.withdrawn?'withdrawn':row.virtual?'virtual':'included';
}
function contains(value,ids){
 if(typeof value==='string')return ids.has(value);
 if(!value||typeof value!=='object')return false;
 return Object.keys(value).some(k=>!lazy.property(value,k)&&contains(value[k],ids));
}
function graph(db,id){
 const original=car(db,id),ids=new Set([id]);
 for(const m of db.mergeMappings||[])if(resolve(db,m.retiredCarId,'graph').canonicalCarId===id)ids.add(m.retiredCarId);
 const jobs=db.jobs.filter(j=>ids.has(j.carId)),jobIds=new Set(jobs.map(j=>j.id));
 const sessions=db.timing.sessions.filter(s=>s.carIds?.some(id=>ids.has(id))||contributions({timing:{sessions:[s]}}).some(r=>ids.has(r.carId)));
 const origins=(db.libraryOrigins||[]).filter(o=>ids.has(o.carId)||o.carIds?.some(id=>ids.has(id)));
 const originals=new Set(origins.filter(o=>o.entity==='car').map(o=>JSON.stringify([o.sourceId,o.originalId])));
 const sessionIds=new Set(sessions.map(s=>JSON.stringify([s.sourceId||s.payload?.source?.id,s.sessionId||s.payload?.sessionId])));
 const originalSessions=new Set(origins.filter(o=>o.entity==='session').map(o=>JSON.stringify([o.sourceId,o.originalId])));
 const extras=(db.libraryExtras||[]).filter(e=>e.namespace==='timing.carExtras'?originals.has(JSON.stringify([e.sourceId,e.originalId])):e.namespace==='timing.historyOriginals'&&(sessionIds.has(JSON.stringify([e.sourceId,e.originalId]))||originalSessions.has(JSON.stringify([e.sourceId,e.originalId]))));
 const installations=db.installations.filter(i=>ids.has(i.carId)),assemblies=db.assemblies.filter(a=>ids.has(a.carId)||installations.some(i=>i.assemblyId===a.id));
 const partIds=new Set([...installations.map(i=>i.partId),...assemblies.flatMap(a=>a.components.map(c=>c.partId)),...db.setups.filter(s=>ids.has(s.carId)).flatMap(s=>(s.installations||[]).map(i=>i.partId))]);
 return {car:original,...Object.fromEntries(collections.map(k=>[k,db[k].filter(r=>ids.has(r.carId))])),installations,assemblies,parts:db.parts.filter(p=>partIds.has(p.id)),
  stockUsage:db.installations.filter(i=>partIds.has(i.partId)),stockReservations:db.assemblies.filter(a=>a.components.some(c=>partIds.has(c.partId))),
  plans:db.planning.jobs.filter(p=>jobIds.has(p.jobId)),shopping:db.planning.shopping.filter(s=>ids.has(s.buildCarId)||jobIds.has(s.jobId)),
  shelves:db.planning.shelves.filter(s=>s.carIds.some(c=>ids.has(c))),focus:db.planning.focus.filter(f=>ids.has(f.carId)),featured:ids.has(db.settings.showroomFeaturedId)?db.settings.showroomFeaturedId:null,
  drafts:db.buildDrafts.filter(d=>contains(d,ids)||contains(d,jobIds)),sessions,origins,extras,audit:(db.timing.audit||[]).filter(a=>sessionIds.has(JSON.stringify([a.sourceId,a.sessionId]))||contains(a,ids)),
  submissions:db.submissions.filter(s=>contains(s,ids)),clubProposals:(db.club?.proposals||[]).filter(p=>contains(p,ids)),
  imports:(db.timing.imports||[]).filter(i=>contains(i,ids)),mappings:(db.mergeMappings||[]).filter(m=>ids.has(m.retiredCarId)||ids.has(m.mainCarId)),
  inclusions:(db.mergeInclusions||[]).filter(i=>ids.has(i.originalCarId)),companions:(db.mergeCompanions||[]).filter(i=>ids.has(i.carId)),definitions:db.customFields};
}
function token(db,mainId,retiredId){return A.digest([graph(db,mainId),graph(db,retiredId)]);}
function paths(value,prefix=[],out=[]){
 if(value&&typeof value==='object'&&!Array.isArray(value)){for(const key of Object.keys(value))paths(value[key],[...prefix,key],out);}
 else out.push(prefix);return out;
}
const get=(o,path)=>path.reduce((v,k)=>v?.[k],o);
function put(o,path,v){let ref=o;for(const k of path.slice(0,-1)){if(!ref[k]||typeof ref[k]!=='object')ref[k]={};ref=ref[k];}Object.defineProperty(ref,path.at(-1),{value:clone(v),enumerable:true,writable:true,configurable:true});}
function editable(c){const {TEXT_FIELDS}=require('./store.cjs'),result={};for(const k of [...TEXT_FIELDS,'favourite','usage','tags','technical','factory','custom','realHistory'])if(Object.hasOwn(c,k))result[k]=c[k];if(result.realHistory){result.realHistory={...result.realHistory};delete result.realHistory.photos;}return result;}
function photos(c){const out=[];if(lazy.property(c,'picture')||c.picture)out.push({key:'picture',owner:c,field:'picture',name:'Original cover'});for(const p of c.photos)out.push({key:'photo:'+p.id,owner:p,field:'data',name:p.name});for(const p of c.realHistory?.photos||[])out.push({key:'research:'+p.id,owner:p,field:'data',name:p.name||'Research photo',research:true});return out;}
function defaultChoices(db,mainId,retiredId){
 const main=car(db,mainId),old=car(db,retiredId),fields={};
 for(const path of paths(editable(old))){const a=get(main,path),b=get(old,path);fields[JSON.stringify(path)]=(a===undefined||a===''||a===null||Array.isArray(a)&&!a.length)&&b!==''&&b!==null?'take':'keep';}
 const rows=contributions(db).filter(r=>disposition(db,r,retiredId)==='included');
 return {fields,settings:require('./car-merge-settings.cjs').defaults(db,mainId,retiredId),photos:Object.fromEntries(photos(old).map(p=>[p.key,true])),cover:'keep',
  records:Object.fromEntries(collections.map(k=>[k,Object.fromEntries(db[k].filter(r=>r.carId===retiredId).map(r=>[r.id,true]))])),
  history:Object.fromEntries(rows.map(r=>[r.key,true])),installations:Object.fromEntries(w.active(db).filter(i=>[mainId,retiredId].includes(i.carId)&&!i.assemblyId).map(i=>[i.id,{action:i.carId===mainId?'retain':'transfer'}])),
  assemblies:Object.fromEntries(w.liveAssemblies(db).filter(a=>[mainId,retiredId].includes(a.carId)).map(a=>[a.id,a.carId===mainId?'retain':'transfer'])),service:'keep'};
}
function checkPair(db,mainId,retiredId){
 check(validId(mainId)&&validId(retiredId)&&mainId!==retiredId,'Choose two different cars.');assertWritable(db,mainId);assertWritable(db,retiredId);
 const a=car(db,mainId),b=car(db,retiredId);check(!a.archived,'The main car must be active.');
 check(!a.rebuild&&!b.rebuild&&!db.buildDrafts.some(d=>[mainId,retiredId].includes(d.data.rebuild?.carId)), 'Resolve rebuild ancestry or its draft before merging.','MERGE_LINEAGE_CONFLICT');
}
function preview(db,p){return {proposal:clone(p),needsRefresh:p.dependencyToken!==token(db,p.mainCarId,p.retiredCarId),defaults:defaultChoices(db,p.mainCarId,p.retiredCarId)};}
function proposal(db,id,expected,recovery,refresh=false){const p=db.mergeProposals.find(p=>p.id===id);check(p,'Merge proposal not found.');check(refresh||p.recoveryId===recovery,'Refresh this proposal after library recovery.','RECOVERY_CHANGED');check(p.status==='pending','This review has already been decided.');check(p.revision===expected,'Another reviewer changed the selections.','MERGE_REVIEW_STALE');return p;}
function validateChoices(db,p,choices){
 const defaults=defaultChoices(db,p.mainCarId,p.retiredCarId);
 check(choices&&same(Object.keys(choices).sort(),Object.keys(defaults).sort()),'Unknown or missing selection groups.');
 for(const k of ['fields','photos','history','installations','assemblies']){
  check(choices[k]&&same(Object.keys(choices[k]).sort(),Object.keys(defaults[k]).sort()),'Refresh the '+k+' choices before saving.');
 }
 check(choices.records&&same(Object.keys(choices.records).sort(),collections.slice().sort()),'Unknown record selection group.');
 for(const k of collections)check(choices.records[k]&&same(Object.keys(choices.records[k]).sort(),Object.keys(defaults.records[k]).sort()),'Refresh the '+k+' choices.');
 for(const v of Object.values(choices.fields))check(['keep','take'].includes(v),'Choose keep or take for a field.');
 require('./car-merge-settings.cjs').validateChoices(db,p,choices.settings);
 for(const map of [choices.photos,choices.history,...Object.values(choices.records)])for(const v of Object.values(map))check(typeof v==='boolean','Selections must be true or false.');
 check(choices.cover==='keep'||Object.hasOwn(choices.photos,choices.cover)&&choices.photos[choices.cover],'The cover must be an included photo.');check(['keep','take'].includes(choices.service),'Choose which service baseline to keep.');check(choices.service!=='take'||car(db,p.retiredCarId).service,'The incoming car has no service baseline to take.');
 for(const [id,v]of Object.entries(choices.installations)){
  check(v&&['retain','transfer','return','same'].includes(v.action)&&Object.keys(v).every(k=>['action','with'].includes(k)),'Invalid installation choice.');
  const i=db.installations.find(i=>i.id===id);check(v.action!=='retain'||i.carId===p.mainCarId,'A retired installation must be resolved.');check(v.action!=='transfer'||i.carId===p.retiredCarId,'Transfer belongs to the incoming car.');
  check(v.action==='same'?validId(v.with):!Object.hasOwn(v,'with'),'Same physical part needs its retained installation.');
 }
 for(const [id,v]of Object.entries(choices.assemblies)){check(['retain','transfer','return'].includes(v),'Choose transfer or return for an assembly; component deduplication requires separate reconciliation.');check(v!=='retain'||db.assemblies.find(a=>a.id===id).carId===p.mainCarId,'Resolve the retired assembly.');}
}
function validateDependencies(db,p){
 const choices=p.choices,old=p.retiredCarId;
 for(const j of db.jobs.filter(j=>j.carId===old&&j.status==='active'))check(choices.records.jobs[j.id],'Transfer this active job, or cancel it in Workshop before refreshing review.');
 for(const k of ['jobs','tests'])for(const r of db[k].filter(r=>r.carId===old))for(const link of ['setupId','jobId']){
  if(!r[link])continue;const bucket=link==='setupId'?'setups':'jobs';check(choices.records[k][r.id]===choices.records[bucket][r[link]],'Linked '+k+' and '+bucket+' must stay together.');
 }
 const ids=new Set([p.mainCarId,old]);
 check(!db.submissions.some(s=>s.status==='pending'&&contains(s,ids))&&!db.club?.proposals?.some(s=>s.status==='pending'&&contains(s,ids))&&!(db.timing.imports||[]).some(i=>i.status==='pending'&&contains(i,ids)), 'Resolve pending incoming changes for these cars before merging.');
 // A session cannot award both aliases as one physical entry without an
 // explicit later reconciliation UI. Preserve both original participants.
 const sessions=new Set(contributions(db).filter(r=>disposition(db,r,p.mainCarId)==='included'&&!r.virtual).map(r=>JSON.stringify([r.sourceId,r.sessionId])));
 for(const r of contributions(db).filter(r=>choices.history[r.key]))check(!sessions.has(JSON.stringify([r.sourceId,r.sessionId])),'Both cars participate in this session. Exclude its incoming contribution or reconcile it first.');
}
function applyStock(db,p,stamp){
 const main=car(db,p.mainCarId),old=car(db,p.retiredCarId),pairs=new Set();
 // Resolve returns before transfers so a reviewed replacement frees its slot.
 for(const [id,v]of Object.entries(p.choices.installations).filter(([,v])=>v.action==='return'))w.returnPart(db,db.installations.find(i=>i.id===id));
 for(const [id,v]of Object.entries(p.choices.assemblies).filter(([,v])=>v==='return'))w.detachAssembly(db,db.assemblies.find(a=>a.id===id),'Used spares');
 for(const [id,v]of Object.entries(p.choices.installations)){
  const i=db.installations.find(i=>i.id===id);
  if(v.action==='same'){
   const kept=db.installations.find(i=>i.id===v.with),part=db.parts.find(x=>x.id===i.partId);
   check(i.carId===old.id&&kept?.carId===main.id&&!kept.removed&&!kept.assemblyId&&kept.partId===i.partId&&kept.quantity===i.quantity&&p.choices.installations[kept.id]?.action==='retain'&&!pairs.has(kept.id),'Same physical part requires one matching retained installation, stock record and quantity.');pairs.add(kept.id);
   const before=w.available(db,part);w.endInstallation(db,i,'duplicate physical record');part.quantity-=i.quantity;part.updated=stamp;check(w.available(db,part)===before,'Physical deduplication changed available stock.');
   w.event(db,main.id,'Merge stock correction','Confirmed duplicate installation; owned and fitted quantities reduced together.',{mergeId:p.id,partId:part.id,quantity:-i.quantity,duplicateInstallationId:i.id,retainedInstallationId:kept.id});
  }else if(v.action==='transfer'){
   check(!i.field||!w.active(db).some(x=>x.carId===main.id&&x.field===i.field),'Two parts occupy '+i.field+'. Choose which to retain.');
   // Preserve the historical installation; start a new association.
   w.endInstallation(db,i,'merge transfer');w.addInstallation(db,main.id,i.partId,i.quantity,i.field,i.position);
  }
 }
 for(const [id,v]of Object.entries(p.choices.assemblies))if(v==='transfer')w.installAssembly(db,db.assemblies.find(a=>a.id===id),main.id);
 // Installed specifications cannot be overwritten by a scalar merge choice.
 for(const i of w.active(db).filter(i=>i.carId===main.id&&i.field))check(main.technical[i.field]===db.parts.find(p=>p.id===i.partId).name,'A selected specification contradicts the retained '+i.field+' part.');
}
function includeMedia(db,p){
 const main=car(db,p.mainCarId),old=car(db,p.retiredCarId),selected=photos(old).filter(x=>p.choices.photos[x.key]);
 const keys=new Map();
 for(const photo of selected){
  const id='merge-photo-'+A.digest([p.id,photo.key]).slice(0,48),record={id,name:photo.name};lazy.copyProperty(record,'data',photo.owner,photo.field);
  // Research photos retain their provenance fields in the research gallery.
  if(photo.research){main.realHistory??={};main.realHistory.photos??=[];main.realHistory.photos.push({...clone(photo.owner),id});keys.set(photo.key,'research:'+id);}
  else {main.photos.push(record);keys.set(photo.key,id);}
 }
 if(p.choices.cover!=='keep'){
  const selected=photos(old).find(x=>x.key===p.choices.cover);
  if(lazy.property(main,'picture')||main.picture){const preserved={id:'merge-cover-'+A.digest(p.id).slice(0,48),name:'Previous main photo'};lazy.copyProperty(preserved,'data',main,'picture');main.photos.push(preserved);}
  lazy.copyProperty(main,'picture',selected.owner,selected.field);
 }
 for(const f of db.planning.focus.filter(f=>f.carId===old.id)){
  const key=f.photoKey==='main'?'picture':'photo:'+(f.photoKey==='photo:main'?'main':f.photoKey),mapped=keys.get(key);
  if(mapped)db.planning.focus.push({...clone(f),carId:main.id,photoKey:mapped});
 }
 // A changed cover needs the incoming framing, never the previous cover crop.
 if(p.choices.cover!=='keep'){
  db.planning.focus=db.planning.focus.filter(f=>!(f.carId===main.id&&f.photoKey==='main'));
  const key=p.choices.cover==='picture'?'main':p.choices.cover.startsWith('photo:')?p.choices.cover.slice(6):null;
  const focus=db.planning.focus.find(f=>f.carId===old.id&&f.photoKey===(key==='main'&&p.choices.cover!=='picture'?'photo:main':key));if(focus)db.planning.focus.push({...clone(focus),carId:main.id,photoKey:'main'});
 }
}
function archive(db,p,side){const id='archive-'+A.digest([p.id,side]),snapshot=graph(db,side==='main'?p.mainCarId:p.retiredCarId),saved=A.freeze(snapshot,id);db.mergeChunks.push(...saved.chunks);db.mergeArchives.push({id,mergeId:p.id,side,created:p.approvedAt,tree:saved.tree,digest:saved.digest});return id;}
function serviceCounts(db,id,from){return contributions(db).filter(r=>disposition(db,r,id)==='included').reduce((n,r)=>{const started=r.rawOnly?r.startedAt:(r.record.bundle?.race||r.record.payload)?.startedAt;return from&&started&&started<from?n:n+(r.rawOnly?r.lapCount:r.participant.laps.length);},0);}
function preflight(db,input,recoveryId){const p=proposal(db,input.id,input.expectedRevision,recoveryId);checkPair(db,p.mainCarId,p.retiredCarId);check(p.dependencyToken===token(db,p.mainCarId,p.retiredCarId),'Related information changed. Refresh the comparison.','MERGE_REVIEW_STALE');validateChoices(db,p,p.choices);validateDependencies(db,p);return p;}
function approve(db,p,stamp,backup){
 preflight(db,{id:p.id,expectedRevision:p.revision},p.recoveryId);
 check(backup?.verified===true&&backup.databaseId===db.id&&backup.recoveryId===p.recoveryId&&backup.dependencyToken===p.dependencyToken,'A verified current recovery backup is required.','MERGE_BACKUP_FAILED');
 p.approvedAt=stamp;const archives={main:archive(db,p,'main'),retired:archive(db,p,'retired')};
 const main=car(db,p.mainCarId),old=car(db,p.retiredCarId);
 // Service observations need merge-aware history readers before activation.
 // Rebase via the explicit counter projection supplied by the storage adapter.
 const service=clone(p.choices.service==='take'?old.service:main.service),serviceCarId=p.choices.service==='take'?old.id:main.id;
 const serviceBefore=service?{total:serviceCounts(db,serviceCarId),since:serviceCounts(db,serviceCarId,service.lastServicedAt)}:null;
 for(const [path,choice]of Object.entries(p.choices.fields))if(choice==='take')put(main,JSON.parse(path),get(old,JSON.parse(path)));
 require('./car-merge-settings.cjs').apply(db,p);
 includeMedia(db,p);applyStock(db,p,stamp);
 for(const k of collections)for(const row of db[k])if(row.carId===old.id&&p.choices.records[k][row.id]){
  row.carId=main.id;
  // A setup job's target must still refer to its selected setup. Only relink
  // ownership; its technical values and recorded physical snapshots stay exact.
  if(k==='jobs'&&row.target)row.target.carId=main.id;
 }
 for(const s of db.planning.shopping)if(s.buildCarId===old.id)s.buildCarId=main.id;
 for(const s of db.planning.shelves)s.carIds=[...new Set(s.carIds.map(id=>id===old.id?main.id:id))];
 if(db.settings.showroomFeaturedId===old.id)db.settings.showroomFeaturedId=main.id;
 db.mergeMappings.push({id:p.id,retiredCarId:old.id,mainCarId:main.id,revision:++db.mergeMeta.revision,date:stamp,archives});
 const historyRows=new Map(contributions(db).map(r=>[r.key,r]));
 for(const [key,include]of Object.entries(p.choices.history)){const row=historyRows.get(key);db.mergeInclusions.push({id:'inclusion-'+A.digest([p.id,key]),mergeId:p.id,key,originalCarId:row.carId,format:row.format,status:include?'included':'excluded',revision:1,late:false,evidenceHash:A.digest(row.record)});}
 if(service){main.service={...service,revision:(main.service?.revision||0)+1,lifetimeBaseline:Math.max(0,(service.lifetimeBaseline??serviceBefore.total)+serviceBefore.total-(service.observedLifetime??serviceBefore.total)),observedLifetime:serviceCounts(db,main.id),sinceBaseline:Math.max(0,(service.sinceBaseline??serviceBefore.since)+serviceBefore.since-(service.observedSince??serviceBefore.since)),observedSince:serviceCounts(db,main.id,service.lastServicedAt)};}
 old.archived=true;old.merge={mergeId:p.id,mainCarId:main.id,archiveId:archives.retired};old.revision++;old.updated=stamp;main.revision++;main.updated=stamp;
 p.status='approved';p.revision++;p.backup={path:backup.path,digest:backup.digest};p.archives=archives;
 w.event(db,main.id,'Merged duplicate: '+old.name,'Selected information included; the complete original is preserved in its merge archive.',{mergeId:p.id,retiredCarId:old.id});
 db.catalogueRevision++;
 return {proposalId:p.id,status:'approved',mainCarId:main.id,retiredCarId:old.id,archives,mergeRevision:db.mergeMeta.revision};
}
function reconcileHistory(db){
 return reconcileRows(db,contributions(db));
}
function reconcileRows(db,rows){
 let changed=false;
 for(const row of rows){
  let id=row.carId;const seen=new Set();
  while(true){check(!seen.has(id),'Merge identity cycle.','MERGE_LINEAGE_CONFLICT');seen.add(id);const edge=db.mergeMappings.find(m=>m.retiredCarId===id);if(!edge)break;
   let item=db.mergeInclusions.find(i=>i.mergeId===edge.id&&i.key===row.key),hash=A.digest(row.record);
   if(!item){item={id:'inclusion-'+A.digest([edge.id,row.key]),mergeId:edge.id,key:row.key,originalCarId:row.carId,format:row.format,status:'pending',revision:1,late:true,evidenceHash:hash};db.mergeInclusions.push(item);changed=true;}
   else if(item.evidenceHash!==hash){item.evidenceHash=hash;item.revision++;changed=true;}
   if(item.status!=='included')break;id=edge.mainCarId;
  }
 }
 if(changed)db.mergeMeta.revision++;return changed;
}
function prepare(before,command,{recoveryId,stamp=new Date().toISOString(),backup}={}){
 const payloadKeys={create:['mainCarId','retiredCarId'],save:['id','expectedRevision','choices'],refresh:['id','expectedRevision'],approve:['id','expectedRevision'],reject:['id','expectedRevision'],cancel:['id','expectedRevision'],reconcileHistory:[],includeHistory:['id','expectedRevision','include']};
 check(command&&typeof command==='object'&&!Array.isArray(command)&&Object.keys(command).every(k=>['databaseId','recoveryId','sourceId','operationId','action','payload'].includes(k))&&Object.hasOwn(payloadKeys,command.action),'Invalid merge command.','INVALID_COMMAND');
 check(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp))&&new Date(stamp).toISOString()===stamp,'Invalid command timestamp.','INVALID_COMMAND');
 check(command.payload&&typeof command.payload==='object'&&!Array.isArray(command.payload)&&Object.keys(command.payload).every(k=>payloadKeys[command.action].includes(k)),'Unknown merge command field.','INVALID_COMMAND');
 check(command.databaseId===before.id,'This command belongs to another collection.','DATABASE_MISMATCH');check(command.recoveryId===recoveryId,'The collection was restored. Reconcile this operation.','RECOVERY_CHANGED');
 check(validId(command.operationId)&&validId(command.sourceId),'Invalid operation identity.');
 const db=clone(before);init(db);const input=command.payload||{};let result;
 if(command.action==='create'){
  checkPair(db,input.mainCarId,input.retiredCarId);const id='merge-'+A.digest([command.sourceId,command.operationId]);
  check(!db.mergeProposals.some(p=>p.id===id),'Operation already exists.','OPERATION_CONFLICT');
  const p={id,mainCarId:input.mainCarId,retiredCarId:input.retiredCarId,status:'pending',revision:1,recoveryId,author:command.sourceId,created:stamp,updated:stamp,dependencyToken:token(db,input.mainCarId,input.retiredCarId),choices:defaultChoices(db,input.mainCarId,input.retiredCarId)};
  db.mergeProposals.push(p);result=clone(p);
 }else if(command.action==='reconcileHistory'){reconcileHistory(db);result={pending:db.mergeInclusions.filter(i=>i.status==='pending').map(i=>i.id)};
 }else if(command.action==='includeHistory'){
  const i=db.mergeInclusions.find(i=>i.id===input.id);check(i?.status==='pending'&&i.revision===input.expectedRevision,'History review changed.','MERGE_REVIEW_STALE');check(typeof input.include==='boolean','Choose include or exclude.');
  const row=contributions(db).find(r=>r.key===i.key);
  if(row){check(A.digest(row.record)===i.evidenceHash,'Historical evidence changed; refresh it first.','MERGE_REVIEW_STALE');check(row.carId===i.originalCarId&&row.format===i.format,'Historical participant identity changed; reconcile the source result.');}
  if(input.include)check(row&&!row.withdrawn,'This session was withdrawn or its original participant is no longer present. It can only be kept excluded.');
  const edge=db.mergeMappings.find(m=>m.id===i.mergeId);
  if(input.include)check(!contributions(db).some(r=>r.key!==row.key&&r.sourceId===row.sourceId&&r.sessionId===row.sessionId&&disposition(db,r,edge.mainCarId)==='included'),'Reconcile multiple physical entries in the same session first.');
  i.status=input.include?'included':'excluded';i.revision++;db.mergeMeta.revision++;reconcileHistory(db);result=clone(i);
 }else{
  const p=proposal(db,input.id,input.expectedRevision,recoveryId,command.action==='refresh');
  if(command.action==='approve')result=approve(db,p,stamp,backup);
  else if(command.action==='save'){check(p.dependencyToken===token(db,p.mainCarId,p.retiredCarId),'Related information changed; refresh the review.','MERGE_REVIEW_STALE');validateChoices(db,p,input.choices);p.choices=clone(input.choices);p.revision++;p.updated=stamp;result=clone(p);}
  else if(command.action==='refresh'){
   checkPair(db,p.mainCarId,p.retiredCarId);const fresh=defaultChoices(db,p.mainCarId,p.retiredCarId);
   for(const k of ['fields','settings','photos','history','installations','assemblies'])for(const id of Object.keys(fresh[k]))if(Object.hasOwn(p.choices[k]||{},id))fresh[k][id]=p.choices[k][id];
   for(const k of collections)for(const id of Object.keys(fresh.records[k]))if(Object.hasOwn(p.choices.records[k],id))fresh.records[k][id]=p.choices.records[k][id];
   fresh.service=p.choices.service;fresh.cover=p.choices.cover==='keep'||fresh.photos[p.choices.cover]?p.choices.cover:'keep';p.choices=fresh;p.dependencyToken=token(db,p.mainCarId,p.retiredCarId);p.recoveryId=recoveryId;p.revision++;p.updated=stamp;result=clone(p);
  }else if(['reject','cancel'].includes(command.action)){p.status=command.action==='reject'?'rejected':'cancelled';p.revision++;p.updated=stamp;result=clone(p);}
  else fail('INVALID_COMMAND','Unknown merge command.');
 }
 db.revision++;validate(db,before);return {data:db,result};
}
function validate(db,before){
 if(!db.mergeMeta)return;check(db.mergeMeta.version===1&&Number.isSafeInteger(db.mergeMeta.revision)&&db.mergeMeta.revision>=0,'Invalid merge metadata.');
 for(const k of ['mergeProposals','mergeMappings','mergeInclusions','mergeArchives','mergeChunks','mergeCompanions']){check(Array.isArray(db[k]),'Missing merge collection.');const ids=db[k].map(r=>r.id);check(ids.every(validId)&&new Set(ids).size===ids.length,'Duplicate or invalid merge identities.');}
 require('./car-merge-settings.cjs').validate(db);
 for(const p of db.mergeProposals){check(validId(p.mainCarId)&&validId(p.retiredCarId)&&p.mainCarId!==p.retiredCarId&&Number.isSafeInteger(p.revision)&&p.revision>=1&&['pending','approved','rejected','cancelled'].includes(p.status)&&typeof p.recoveryId==='string'&&/^[a-f0-9]{64}$/.test(p.dependencyToken)&&p.choices&&typeof p.choices==='object','Invalid merge proposal.');car(db,p.mainCarId);car(db,p.retiredCarId);if(p.status==='approved')check(db.mergeMappings.some(m=>m.id===p.id),'Approved review has no identity mapping.');}
 const retired=new Set();for(const m of db.mergeMappings){check(!retired.has(m.retiredCarId)&&m.mainCarId!==m.retiredCarId&&Number.isSafeInteger(m.revision)&&m.revision>0&&m.revision<=db.mergeMeta.revision,'Duplicate retirement or invalid merge revision.');retired.add(m.retiredCarId);check(car(db,m.retiredCarId).archived&&car(db,m.retiredCarId).merge?.mergeId===m.id,'Retired car was restored or changed.');resolve(db,m.retiredCarId,'validate');check(db.mergeProposals.some(p=>p.id===m.id&&p.status==='approved'),'Missing approved merge.');for(const side of ['main','retired'])check(db.mergeArchives.some(a=>a.id===m.archives?.[side]&&a.mergeId===m.id&&a.side===side),'Missing merge recovery archive.');}
 const keys=new Set();for(const i of db.mergeInclusions){const key=JSON.stringify([i.mergeId,i.key]);check(!keys.has(key)&&validId(i.originalCarId)&&['timing-v1','history-v1','raw-only'].includes(i.format)&&Number.isSafeInteger(i.revision)&&i.revision>0&&typeof i.late==='boolean'&&['included','excluded','pending'].includes(i.status)&&db.mergeMappings.some(m=>m.id===i.mergeId),'Invalid inclusion decision.');let tuple;try{tuple=JSON.parse(i.key);}catch{}check(Array.isArray(tuple)&&tuple.length===3&&tuple.every(validId),'Invalid contribution identity.');keys.add(key);}
 for(const a of db.mergeArchives){check(db.mergeMappings.some(m=>m.id===a.mergeId)&&['main','retired'].includes(a.side),'Orphan merge archive.');A.thaw(a,db.mergeChunks);}
 check(db.mergeChunks.every(c=>db.mergeArchives.some(a=>a.id===c.archiveId)),'Orphan merge archive chunk.');
 if(before?.mergeMeta){check(db.mergeMeta.revision>=before.mergeMeta.revision,'Merge generation went backwards.');for(const k of ['mergeArchives','mergeChunks','mergeMappings'])for(const row of before[k])check(same(row,db[k].find(r=>r.id===row.id)),'Frozen merge records cannot be changed.');for(const p of before.mergeProposals.filter(p=>p.status!=='pending'))check(same(p,db.mergeProposals.find(r=>r.id===p.id)),'Completed merge decisions are immutable.');for(const m of before.mergeMappings)check(same(car(before,m.retiredCarId),car(db,m.retiredCarId)),'Retired cars are read-only.');}
}
function mappingPage(db,recoveryId,input={}){
 check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(k=>['limit','cursor'].includes(k)),'Invalid mapping query.','INVALID_QUERY');
 const limit=input.limit??50;check(Number.isInteger(limit)&&limit>=1&&limit<=100,'Choose 1–100 mappings per page.','INVALID_QUERY');let offset=0;
 const snapshot={databaseId:db.id,recoveryId,mergeRevision:db.mergeMeta?.revision||0};
 if(input.cursor){let cursor;try{check(typeof input.cursor==='string'&&input.cursor.length<=2048,'Invalid mapping cursor.','INVALID_QUERY');cursor=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));}catch{fail('INVALID_QUERY','Invalid mapping cursor.');}check(same(cursor.snapshot,snapshot),'Merge mapping snapshot changed; restart pagination.','SNAPSHOT_CHANGED');check(Number.isSafeInteger(cursor.offset)&&cursor.offset>=0,'Invalid mapping offset.','INVALID_QUERY');offset=cursor.offset;}
 const mappings=db.mergeMappings||[];check(offset<=mappings.length,'Invalid mapping offset.','INVALID_QUERY');const rows=mappings.slice(offset,offset+limit).map(m=>({id:m.id,retiredCarId:m.retiredCarId,mainCarId:m.mainCarId,revision:m.revision}));
 return {...snapshot,rows,nextCursor:offset+rows.length<mappings.length?Buffer.from(JSON.stringify({snapshot,offset:offset+rows.length})).toString('base64url'):null};
}
module.exports={init,prepare,preflight,validate,graph,token,defaultChoices,preview,resolve,assertWritable,contributions,disposition,reconcileHistory,reconcileRows,historyKey,serviceCounts,mappingPage};
