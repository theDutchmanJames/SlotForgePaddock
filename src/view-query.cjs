'use strict';
const queries=require('./sqlite-query.cjs'),{cloneJSON}=require('./json-data.cjs');
const arrays=['buildDrafts','supplies','jobs','cars','parts','assemblies','installations','setups','events','tests','submissions','choiceAliases','documents','views','customFields'];
function shell(db){return {schema:db.schema,id:db.id,revision:db.revision,catalogueRevision:db.catalogueRevision,settings:cloneJSON(db.settings),choices:cloneJSON(db.choices),customFields:cloneJSON(db.customFields),views:cloneJSON(db.views),choiceAliases:cloneJSON(db.choiceAliases),...Object.fromEntries(arrays.filter(k=>!['customFields','views','choiceAliases'].includes(k)).map(k=>[k,[]])),planning:{shopping:[],jobs:[],shelves:[],focus:[]},timing:{key:null,sessions:[]},club:db.club?{id:db.club.id,replica:db.club.replica,proposals:[]}:null};}
// Pages and editor contexts are projected independently. A visible page is
// never treated as the complete collection for selectors or stock checks.
function view(store,request={}){
 if(!request||typeof request!=='object'||typeof request.page!=='string')throw queries.fault('INVALID_QUERY','Choose a page.');
 const pages=['Overview','Cars','Review','Parts','Build from Scratch','Workshop','Showroom','Library','Connections','Import & Export','Settings'];
 if(!pages.includes(request.page))throw queries.fault('INVALID_QUERY','Unknown page.');
 for(const value of [request.offset,...Object.values(request.detailOffsets||{})])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw queries.fault('INVALID_QUERY','Invalid page offset.');
 if(request.build){for(const key of ['types','partIds','assemblyIds'])if(request.build[key]!==undefined&&(!Array.isArray(request.build[key])||request.build[key].length>1000||request.build[key].some(v=>typeof v!=='string')))throw queries.fault('INVALID_QUERY','Invalid build selection.');}
 if(request.editor)for(const key of ['selected','matchIds'])if(request.editor[key]!==undefined&&(!Array.isArray(request.editor[key])||request.editor[key].length>1000||request.editor[key].some(v=>typeof v!=='string')))throw queries.fault('INVALID_QUERY','Invalid editor selection.');
 if(!store.file||store.expectedIdentity===null)return {...store.snapshot(),_view:{request,compatibility:true}};
 return queries.read(store,request.token,r=>{
  const {token,...viewRequest}=request;const db=store.data,data=shell(db),info={request:viewRequest,token:r.token};data._view=info;
  if(request.page==='Settings'&&!request.editor)info.storage=store.storageUsage(r.db);
  const summary=r.summary();info.review={incoming:summary.incoming,jobs:summary.jobs,due:summary.due,maintenance:summary.maintenance,club:store.pendingClubReviews()};
  info.resultInbox=store.resultInbox?.read(r,request.page==='Review'&&request.reviewTab==='Race results'?(request.offset||0):null);
  info.historyImports=require('./history-imports.cjs').inbox(r,request.page==='Review'&&request.reviewTab==='Historical imports'?(request.offset||0):null);
  info.timingCollection=require('./timing-collection-review.cjs').inbox(r,request.page==='Review'&&request.reviewTab==='Timing collection');
  if(require('./car-merge-storage.cjs').enabled()&&!db.club?.replica){
   const pending=bucket=>r.db.prepare(`SELECT count(*) n FROM records r JOIN record_fields f ON f.record=r.key AND f.path='["status"]' AND f.json='"pending"' WHERE r.bucket=?`).get(JSON.stringify([bucket])).n;
   const proposals=pending('mergeProposals'),history=pending('mergeInclusions');info.carMerges={proposals,history,total:proposals+history};
  }
  const addCar=id=>{if(id&&!data.cars.some(c=>c.id===id)){const c=r.one('cars',id);if(c)data.cars.push(c);}};
  if(require('./view-context.cjs').extraView(db,data,r,request)){
   // Page-specific context supplied above.
  }else if(request.page==='Overview'){
   data.cars=r.list('cars',{archived:false,sort:'updated',limit:3}).rows;data.events=r.list('events',{limit:4}).rows;data.jobs=r.list('jobs',{status:'active',limit:3}).rows;data.jobs.forEach(j=>addCar(j.carId));
   info.stats=summary;
  }else if(request.page==='Parts'){
   const owned=request.stockScope==='owned',groups=r.db.prepare("SELECT json_extract(aux,'$.category') category,count(*) count,sum(json_extract(aux,'$.quantity')) quantity FROM query_records WHERE bucket=? "+(owned?"AND json_extract(aux,'$.quantity')>0 ":'')+'GROUP BY category').all('["parts"]');
   const used=new Map();for(const row of r.db.prepare("SELECT json_extract(aux,'$.partId') id,sum(json_extract(aux,'$.quantity')) n FROM query_records WHERE bucket='[\"installations\"]' AND json_extract(aux,'$.removed')=0 GROUP BY id").all())used.set(row.id,row.n);
   for(const row of r.db.prepare("SELECT json_extract(c.value,'$.partId') id,sum(json_extract(c.value,'$.quantity')) n FROM query_records q,json_each(q.aux,'$.components') c WHERE q.bucket='[\"assemblies\"]' GROUP BY id").all())used.set(row.id,(used.get(row.id)||0)+row.n);
   const categories=new Map(r.db.prepare("SELECT identity,json_extract(aux,'$.category') category FROM records r JOIN query_records q ON q.key=r.key WHERE r.bucket='[\"parts\"]'").all().map(p=>[p.identity.slice(3),p.category]));
   info.groups=groups.map(g=>({...g,available:g.quantity-[...used].filter(([id])=>categories.get(id)===g.category).reduce((n,[id,q])=>n+q,0)}));
   info.assemblies=r.db.prepare("SELECT count(*) n FROM query_records WHERE bucket='[\"assemblies\"]' AND json_extract(aux,'$.dismantled')=0").get().n;
   info.partTypes=r.db.prepare("SELECT DISTINCT json_extract(aux,'$.partType') type FROM query_records WHERE bucket='[\"parts\"]' AND (?='' OR json_extract(aux,'$.category')=?) ORDER BY type").all(request.partCategory||'',request.partCategory||'').map(x=>x.type).filter(Boolean);
   if(request.partCategory||request.partQuery?.trim()){
    const result=r.list('parts',{owned,category:request.partCategory||undefined,partType:request.partType||undefined,query:request.partQuery?.trim()||'',offset:request.offset||0,limit:50});data.parts=result.rows;info.partIds=result.rows.map(p=>p.id);info.available=Object.fromEntries(data.parts.map(p=>[p.id,p.quantity-(used.get(p.id)||0)]));info.list={total:result.total,nextOffset:result.nextOffset,offset:request.offset||0,limit:50};
   }
  }else if(request.page==='Review'){
   const offset=request.offset||0,limit=20;if(!Number.isSafeInteger(offset)||offset<0)throw queries.fault('INVALID_QUERY','Invalid review page.');
   const tab=request.reviewTab||'Incoming cars';let total=0;
   if(tab==='Timing collection'){total=0;}
   else if(tab==='Historical imports'){total=info.historyImports.count;}
   else if(tab==='Race results'){total=info.resultInbox?.total||0;for(const row of info.resultInbox?.rows||[])row.cars.slice(0,5).forEach(addCar);}
   else if(tab==='Club changes'){
    const all=db.club?.proposals||[],pending=all.filter(p=>request.reviewHistory?p.status!=='pending':p.status==='pending');info.reviewedCount=all.filter(p=>p.status!=='pending').length;total=pending.length;data.club.proposals=cloneJSON(pending.slice(offset,offset+limit));info.proposalContexts={};
    for(const p of data.club.proposals){const context=require('../renderer/review-model.js').proposalContext(db,p);info.proposalContexts[p.id]=context;addCar(context.carId);}
   }else if(tab==='Incoming cars'){
    const pending=db.submissions.filter(s=>s.status==='pending').flatMap(s=>s.package.cars.filter(c=>!s.outcomes[c.id]).map(c=>({s,c})));total=pending.length;
    for(const {s,c}of pending.slice(offset,offset+limit)){let sub=data.submissions.find(x=>x.id===s.id);if(!sub){sub={...Object.fromEntries(Object.entries(s).filter(([k])=>k!=='package'&&k!=='outcomes').map(([k,v])=>[k,cloneJSON(v)])),package:{...s.package,cars:[]},outcomes:{}};data.submissions.push(sub);}sub.package.cars.push(cloneJSON(c));addCar(c.id);}
    for(const c of data.cars){const installed=r.list('installations',{carId:c.id,removed:false,hasField:true,limit:200}).rows.filter(i=>!i.removed);data.installations.push(...installed);for(const i of installed)if(!data.parts.some(p=>p.id===i.partId)){const p=r.one('parts',i.partId);if(p)data.parts.push(p);}}
   }else if(tab==='Workshop jobs'){const result=r.list('jobs',{status:'active',offset,limit});total=result.total;data.jobs=result.rows;data.jobs.forEach(j=>addCar(j.carId));data.planning.jobs=cloneJSON(db.planning.jobs.filter(p=>data.jobs.some(j=>j.id===p.jobId)));}
   else if(tab==='Maintenance'){const reminders=r.reminders();total=reminders.length;data.events=reminders.slice(offset,offset+limit).map(x=>r.record(x.key));data.events.forEach(e=>addCar(e.carId));data.jobs=db.jobs.filter(j=>j.status==='active'&&data.cars.some(c=>c.id===j.carId)).map(cloneJSON);}
   else throw queries.fault('INVALID_QUERY','Unknown review section.');
   info.list={offset,limit,total,nextOffset:offset+limit<total?offset+limit:null};
  }else if(request.page==='Cars'&&!request.carId){
   const result=r.list('cars',{query:request.query||'',usage:request.usage||[],matchAll:!!request.matchAll,archived:!!request.archived,sort:request.sort||'name',direction:request.sortDirection,offset:request.offset||0,limit:48});data.cars=result.rows;info.list={total:result.total,nextOffset:result.nextOffset,offset:request.offset||0,limit:48};info.activeCars=r.count('cars',{archived:false});
   info.usage=r.db.prepare("SELECT DISTINCT u.value FROM query_records q,json_each(q.usage) u WHERE q.bucket=? ORDER BY u.value").all('["cars"]').map(x=>x.value);
  }else if(request.page==='Cars'){
   addCar(request.carId);if(!data.cars.length)throw queries.fault('CAR_NOT_FOUND','This car no longer exists.');
   const section=request.section||'Overview';
   if(section==='Overview'){const c=data.cars.find(c=>c.id===request.carId);info.rebuildLinks={};for(const kind of ['from','to']){const edge=c?.rebuild?.[kind];if(edge){const related=r.one('cars',edge.id);if(related){const entry={id:related.id,name:related.name};if(Object.hasOwn(related,'picture'))require('./lazy-assets.cjs').copyProperty(entry,'picture',related);info.rebuildLinks[kind]=entry;}}}data.jobs=r.list('jobs',{carId:request.carId,status:'active',limit:1}).rows;info.maintenance=r.list('events',{carId:request.carId,types:['maintenance'],limit:2}).rows;}
   if(section==='Performance'){
    info.originalHistoryCount=require('./shared-library-originals.cjs').count(r,request.carId);
    const timing=request.historyView?{records:[],lanes:[],background:true}:require('./query-timing.cjs').page(r,request.carId,request.sessionOffset||0);info.timing=timing;data.timing.sessions=timing.records;
    const tests=r.list('tests',{carId:request.carId,offset:request.offset||0,limit:20});data.tests=tests.rows;data.setups=[...new Set(data.tests.map(t=>t.setupId).filter(Boolean))].map(id=>r.one('setups',id)).filter(Boolean);info.history={offset:request.offset||0,limit:20,total:tests.total,nextOffset:tests.nextOffset};
    const manual=require('../renderer/pace-model.js').laneRecords({...data,timing:{sessions:[]},tests:db.tests.filter(t=>t.carId===request.carId)},request.carId);info.lanes=[...timing.lanes,...manual].sort((a,b)=>a.kind.localeCompare(b.kind)||a.track.localeCompare(b.track)||a.trackKey.localeCompare(b.trackKey)||a.lane.localeCompare(b.lane,undefined,{numeric:true}));
    info.timing={...timing,records:undefined,lanes:undefined};
   }
   if(['Overview','History','Maintenance'].includes(section)){const result=r.list('events',{carId:request.carId,types:section==='Maintenance'?['maintenance','modification','installation','removal']:undefined,offset:request.offset||0,limit:section==='Overview'?8:50});data.events=result.rows;if(section!=='Overview')info.history={total:result.total,nextOffset:result.nextOffset,offset:request.offset||0,limit:50};}
   if(section==='Setups'){const result=r.list('setups',{carId:request.carId,offset:request.offset||0,limit:24});data.setups=result.rows;info.history={...result,rows:undefined,offset:request.offset||0,limit:24};}
   if(section==='Photos & documents'){const result=r.list('documents',{carId:request.carId,limit:50,offset:request.offset||0});data.documents=result.rows.map(d=>Object.fromEntries(Object.keys(d).filter(k=>k!=='data').map(k=>[k,d[k]])));info.history={total:result.total,nextOffset:result.nextOffset,offset:request.offset||0,limit:50};}
  }
  if(request.page==='Parts'&&request.partsTab==='Stock'&&request.stockScope!=='shopping'&&request.partId){const h=require('./view-context.cjs').helpers(db,data,r);h.add('parts',request.partId);const result=r.list('installations',{partId:request.partId,offset:request.detailOffsets?.partHistory||0,limit:50});data.installations=result.rows;info.partHistory={pager:'partHistory',offset:request.detailOffsets?.partHistory||0,limit:50,total:result.total,nextOffset:result.nextOffset};data.installations.forEach(i=>addCar(i.carId));data.assemblies=db.assemblies.filter(a=>!a.dismantled&&a.components.some(c=>c.partId===request.partId)).map(a=>r.one('assemblies',a.id));data.planning.shopping=cloneJSON(db.planning.shopping.filter(s=>s.partId===request.partId));}
  require('./view-context.cjs').editor(db,data,r,request);
  data.planning.jobs=cloneJSON(db.planning.jobs.filter(p=>data.jobs.some(j=>j.id===p.jobId)));const ids=new Set(data.cars.map(c=>c.id));data.planning.focus=cloneJSON(db.planning.focus.filter(f=>ids.has(f.carId)));return data;
 }).value;
}
module.exports={view,shell};
