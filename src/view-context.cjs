'use strict';
// UI projections only. Mutations still run the authoritative domain checks.
const {cloneJSON}=require('./json-data.cjs');
const {fault}=require('./sqlite-query.cjs');
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,cloneJSON(value[k])]));
const carChoice=c=>pick(c,['id','name','number','maker','marque','model','reference','scale','archived','usage','tags','updated','favourite']);
const partChoice=p=>pick(p,['id','name','maker','reference','category','partType','location','condition','tracking','quantity','iconId','iconColour','scale','sourcePartId']);
function helpers(db,data,r){
 const add=(bucket,id)=>{if(!id)return null;const value=r.one(bucket,id);if(value){const i=data[bucket].findIndex(v=>v.id===id);if(i<0)data[bucket].push(value);else data[bucket][i]=value;}return value;};
 const chooseCars=()=>{const full=new Map(data.cars.map(c=>[c.id,c]));data.cars=db.cars.map(c=>full.get(c.id)||carChoice(c));};
 const stock=()=>{const full=new Map(data.parts.map(p=>[p.id,p]));data.parts=db.parts.map(p=>full.get(p.id)||partChoice(p));data.assemblies=db.assemblies.filter(a=>!a.dismantled).map(a=>pick(a,['id','name','carId','location','dismantled','components']));const used=new Map();for(const i of db.installations)if(!i.removed)used.set(i.partId,(used.get(i.partId)||0)+i.quantity);for(const a of data.assemblies)if(!a.carId)for(const c of a.components)used.set(c.partId,(used.get(c.partId)||0)+c.quantity);data._view.available=Object.fromEntries(db.parts.map(p=>[p.id,p.quantity-(used.get(p.id)||0)]));};
 const related=(bucket,carId)=>{data[bucket]=db[bucket].filter(v=>v.carId===carId).map(v=>r.one(bucket,v.id));};
 const installations=carId=>{data.installations=db.installations.filter(i=>i.carId===carId&&!i.removed).map(i=>r.one('installations',i.id));for(const i of data.installations){add('parts',i.partId);if(i.assemblyId)add('assemblies',i.assemblyId);}};
 const shopping=items=>{data.planning.shopping=cloneJSON(items);for(const line of data.planning.shopping)if(line.buildId)line.buildAvailable=db.buildDrafts.some(d=>d.id===line.buildId);for(const s of items){add('parts',s.partId);if(s.jobId){const j=add('jobs',s.jobId);if(j)add('cars',j.carId);}}};
 const slice=(items,limit=24,key='list')=>{const offset=data._view.request.offset||0;if(!Number.isSafeInteger(offset)||offset<0)throw fault('INVALID_QUERY','Invalid page.');data._view[key]={offset,limit,total:items.length,nextOffset:offset+limit<items.length?offset+limit:null};return items.slice(offset,offset+limit);};
 return {add,chooseCars,stock,related,installations,shopping,slice};
}
function extraView(db,data,r,request){
 const h=helpers(db,data,r),info=data._view;
 if(request.page==='Library'&&request.libraryTab==='parts'){
  const f=request.catalogue||{};if(f.scope&&!['all','unowned','owned'].includes(f.scope))throw fault('INVALID_QUERY','Invalid catalogue scope.');
  const result=r.list('parts',{query:f.query||'',category:f.category||undefined,maker:f.maker||undefined,owned:f.scope==='owned',unowned:f.scope==='unowned',sort:'name',offset:request.offset||0,limit:40});
  data.parts=result.rows;info.list={total:result.total,offset:request.offset||0,limit:40,nextOffset:result.nextOffset};
  info.catalogueMakers=r.db.prepare("SELECT min(json_extract(f.json,'$')) name FROM query_records q JOIN record_fields f ON f.record=q.key AND f.path='[\"maker\"]' WHERE q.bucket='[\"parts\"]' AND q.maker<>'' GROUP BY q.maker ORDER BY q.maker").all().map(x=>x.name);return true;
 }
 if(['Settings','Library','Connections','Import & Export'].includes(request.page))return true;
 if(request.page==='Showroom'){
  const filters=request.showroom||{},choices=require('../renderer/showroom-domain.js').cars({cars:db.cars.map(carChoice)},filters),shelf=db.planning.shelves.find(s=>s.id===filters.shelf);
  const byId=new Map(choices.map(c=>[c.id,c])),list=shelf?shelf.carIds.map(id=>byId.get(id)).filter(Boolean):choices;
  info.showroomChoices=list.map(c=>({id:c.id,name:c.name}));info.usage=[...new Set(db.cars.filter(c=>!c.archived).flatMap(c=>c.usage||[]))].sort();info.activeCars=db.cars.filter(c=>!c.archived).length;
  info.galleryIds=h.slice(list,48).map(c=>c.id);info.galleryIds.forEach(id=>h.add('cars',id));
  const featured=list.find(c=>c.id===db.settings.showroomFeaturedId)||list.find(c=>{const original=db.cars.find(x=>x.id===c.id);const picture=Object.getOwnPropertyDescriptor(original,'picture');return !!(picture?.get||picture?.value)||(original.photos||[]).length;})||list[0];info.featuredId=featured?.id;h.add('cars',featured?.id);
  if(list.some(c=>c.id===filters.viewerId))h.add('cars',filters.viewerId);
  data.planning.shelves=cloneJSON(db.planning.shelves);return true;
 }
 if(request.page==='Workshop'){
  if(request.toolboxTab==='Manuals and Part Guides'){
   const f=request.guides||{},result=r.list('documents',{guides:true,guideQuery:f.query||'',generalGuide:f.carId==='general',carId:f.carId&&f.carId!=='general'?f.carId:undefined,offset:request.offset||0,limit:24});
   data.documents=result.rows.map(d=>{const out=pick(d,['id','guide','carId','name','mime','size','title','category','added','updated']);require('./lazy-assets.cjs').copyProperty(out,'picture',d);return out;});
   info.list={total:result.total,offset:request.offset||0,limit:24,nextOffset:result.nextOffset};h.chooseCars();return true;
  }
  if(request.jobId){const j=h.add('jobs',request.jobId);if(j){h.add('cars',j.carId);h.installations(j.carId);h.shopping(db.planning.shopping.filter(s=>s.jobId===j.id));}return true;}
  if(request.toolboxTab==='Workshop supplies'){
   const f=request.supply||{},items=db.supplies.filter(s=>s.archived===!!f.archived&&(!f.category||s.category===f.category)&&(!f.low||s.kind==='Consumable'&&s.remaining!==null&&s.minimum!==null&&s.remaining<=s.minimum)&&[s.name,s.partType,s.maker,s.reference,s.location].join(' ').toLowerCase().includes(String(f.query||'').toLowerCase()));
   data.supplies=h.slice(items).map(s=>r.one('supplies',s.id));return true;
  }
  if(request.jobCategory&&!require('../renderer/job-types.js').valid(request.jobCategory))throw fault('INVALID_QUERY','Invalid job category.');
  const jobs=db.jobs.filter(j=>!request.jobCategory||(j.category||'general')===request.jobCategory),active=jobs.filter(j=>j.status==='active'),closed=jobs.filter(j=>j.status!=='active');info.jobCounts={active:active.length,closed:closed.length};
  data.jobs=h.slice(request.closedJobs?closed:active).map(j=>r.one('jobs',j.id));data.jobs.forEach(j=>h.add('cars',j.carId));
  const events=r.list('events',{types:['maintenance','modification','installation','removal'],limit:Math.min(200,Math.max(3,request.recentWorkLimit||3))});info.recentTotal=events.total;data.events=events.rows;
  const reminders=r.reminders();info.reminderTotal=reminders.length;const offset=request.detailOffsets?.reminders||0;info.reminders={pager:'reminders',offset,limit:24,total:reminders.length,nextOffset:offset+24<reminders.length?offset+24:null};info.maintenance=reminders.slice(offset,offset+24).map(e=>r.record(e.key));info.maintenance.forEach(e=>h.add('cars',e.carId));return true;
 }
 if(request.page==='Parts'&&request.partsTab==='Assemblies'){
  const all=db.assemblies.filter(a=>!a.dismantled);info.assemblies=all.length;data.assemblies=h.slice(all).map(a=>r.one('assemblies',a.id));for(const a of data.assemblies){h.add('cars',a.carId);for(const c of a.components)h.add('parts',c.partId);}return true;
 }
 if(request.page==='Build from Scratch'||request.page==='Parts'&&request.partsTab==='Build from Scratch'){
  // Complete compact stock choices; full specifications only for the visible
  // candidates and assignments. No car history or race results are transferred.
  h.stock();if(request.build?.rebuildCarId)info.rebuild=require('./rebuild.cjs').context(db,request.build.rebuildCarId);const f=request.build||{},types=f.types||[],ids=new Set(f.partIds||[]);
  for(const i of info.rebuild?.installations||[])ids.add(i.partId);
  for(const a of data.assemblies.filter(a=>a.carId===f.rebuildCarId))for(const c of a.components)ids.add(c.partId);
  const candidates=db.parts.filter(p=>(f.all||!types.length||types.includes(p.partType))&&[p.name,p.reference,p.maker,p.location,p.partType].join(' ').toLowerCase().includes(String(f.query||'').toLowerCase()));
  info.buildIds=h.slice(candidates,40).map(p=>p.id);info.buildIds.forEach(id=>ids.add(id));
  for(const a of data.assemblies.filter(a=>(f.assemblyIds||[]).includes(a.id)))for(const c of a.components)ids.add(c.partId);
  ids.forEach(id=>h.add('parts',id));data.buildDrafts=db.buildDrafts.map(d=>({id:d.id,updated:d.updated,...(d.data.rebuild?{rebuildJobId:d.data.rebuild.jobId}:{}),data:{name:d.data.name,parts:d.data.parts.map(()=>null),assemblies:d.data.assemblies.map(()=>null)}}));return true;
 }
 if(request.page==='Parts'&&request.stockScope==='shopping'){h.shopping(h.slice(db.planning.shopping,30));return true;}
 if(request.page==='Cars'&&request.carId&&request.section==='Technical & parts'){if(!h.add('cars',request.carId))throw fault('CAR_NOT_FOUND','This car no longer exists.');h.installations(request.carId);return true;}
 return false;
}
function editor(db,data,r,request){
 const e=request.editor;if(!e)return;const {action,id}=e;if(typeof action!=='string'||action.length>100||id!==undefined&&typeof id!=='string')throw fault('INVALID_QUERY','Invalid editor context.');
 const h=helpers(db,data,r),a=action;data._view.editor=true;
 let carId=request.carId;if(a==='reports'&&!id&&e.selected?.length===1)carId=e.selected[0];
 // Resolve stable identities, never names or the currently displayed page.
 for(const bucket of ['cars','parts','supplies','jobs','setups','tests','documents','assemblies']){const value=db[bucket].find(v=>v.id===id);if(value){h.add(bucket,id);if(bucket==='cars')carId=id;else if(value.carId)carId=value.carId;}}
 // Editors only need document metadata; never send full PDF/image bytes to rename or remove a guide.
 data.documents=data.documents.map(d=>{const out=pick(d,['id','guide','carId','name','mime','size','title','category','added','updated']);require('./lazy-assets.cjs').copyProperty(out,'picture',d);return out;});
 if(carId)h.add('cars',carId);
 if(carId&&['slotcar-research','slotcar-kit','slotcar-pick'].includes(a))h.installations(carId);
 if(['guide-add','guide-edit','car-compare'].includes(a))h.chooseCars();
 if(['install-part','install-stock','install-assembly','new-job','maintenance-job','shelf-new','shelf-edit','export-selected','send-selected','reports','select-filtered'].includes(a))h.chooseCars();
 if(['add-assembly','replace-assembly','install-part','install-stock','shop-add','job-shopping','receive-stock','shop-receive'].includes(a)){h.stock();h.chooseCars();}
 if(['shop-add','job-shopping','new-job','maintenance-job'].includes(a)){
  data.jobs=db.jobs.filter(j=>j.status==='active').map(j=>pick(j,['id','carId','name','status']));h.chooseCars();
 }
 if(a==='select-filtered'||a==='reports'&&!id&&!e.selected?.length){
  const result=r.list('cars',{query:request.query||'',usage:request.usage||[],matchAll:!!request.matchAll,archived:!!request.archived,sort:request.sort||'name',direction:request.sortDirection,limit:200,idsOnly:true});
  if(result.total>1000)throw fault('QUERY_LIMIT','Narrow the filters to 1,000 cars or fewer.');
  const ids=[...result.rows];for(let offset=200;offset<result.total;offset+=200)ids.push(...r.list('cars',{query:request.query||'',usage:request.usage||[],matchAll:!!request.matchAll,archived:!!request.archived,sort:request.sort||'name',direction:request.sortDirection,offset,limit:200,idsOnly:true}).rows);
  const map=new Map(db.cars.map(c=>[c.id,c]));data.cars=ids.map(id=>carChoice(map.get(id)));data._view.list={total:ids.length,limit:1000,offset:0,nextOffset:null};
 }
 if(['add-part','edit-part','part-appearance'].includes(a)){const target=data.parts.find(p=>p.id===id);data.parts=db.parts.map(p=>p.id===id&&target?target:partChoice(p));}
 if(['add-supply','edit-supply'].includes(a)){const target=data.supplies.find(p=>p.id===id);data.supplies=db.supplies.map(p=>p.id===id&&target?target:pick(p,['id','name','maker','partType','location']));}
 if(['new-job','maintenance-job'].includes(a))data.setups=db.setups.map(s=>pick(s,['id','carId','name','date']));
 if(a==='compare-setup'&&carId)h.related('setups',carId);
 if(['add-test','reports'].includes(a)&&carId)data.setups=db.setups.filter(s=>s.carId===carId).map(s=>pick(s,['id','carId','name','date','track']));
 if(a==='compare-setup'&&carId){h.installations(carId);h.related('tests',carId);h.related('jobs',carId);}
 if(a==='add-work'&&carId)data.events=db.events.filter(v=>v.carId===carId&&v.task).map(v=>pick(v,['id','carId','task']));
 if(['shop-receive','shop-remove'].includes(a)){const s=db.planning.shopping.find(s=>s.id===id);if(s)h.shopping([s]);}
 if(a==='receive-stock')data.planning.shopping=cloneJSON(db.planning.shopping.filter(s=>s.partId===id));
 if(['shop-add','job-shopping'].includes(a))data.planning.shopping=db.planning.shopping.map(s=>pick(s,['id','partId','quantity','received']));
 if(a.startsWith('shelf-'))data.planning.shelves=cloneJSON(db.planning.shelves);
 if(a==='rebuild-start'){h.chooseCars();data.jobs=db.jobs.map(j=>pick(j,['id','carId','status','category','kind']));}
 if(a==='build-load-draft'){const d=db.buildDrafts.find(d=>d.id===id);if(d)data.buildDrafts=[cloneJSON(d)];}
 if(a==='build-assemblies'||a==='build-use-assembly'){h.stock();}
 if(a==='compare-pace'){
  data._view.paceRuns=[...r.db.prepare("SELECT json_extract(json,'$._query.runs') runs FROM query_sessions").all().flatMap(row=>JSON.parse(row.runs||'[]')),...require('../renderer/pace-model.js').runs({...db,timing:{sessions:[]}})];h.chooseCars();const ids=new Set(data._view.paceRuns.map(run=>run.carId)),originals=new Map(db.cars.map(c=>[c.id,c]));for(const c of data.cars)if(ids.has(c.id))require('./lazy-assets.cjs').copyProperty(c,'picture',originals.get(c.id));
 }
 // Catalogue matches are requested explicitly by the selected incoming row.
 if(a==='catalogue-product')for(const bucket of ['parts','supplies'])for(const key of e.matchIds||[])h.add(bucket,key);
 data.planning.jobs=cloneJSON(db.planning.jobs.filter(p=>data.jobs.some(j=>j.id===p.jobId)));
 const ids=new Set(data.cars.map(c=>c.id));data.planning.focus=cloneJSON(db.planning.focus.filter(f=>ids.has(f.carId)));
}
module.exports={extraView,editor,helpers,carChoice,partChoice};
