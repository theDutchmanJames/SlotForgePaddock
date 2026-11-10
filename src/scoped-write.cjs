'use strict';
// Command workspaces contain complete dependency groups, or an explicitly
// selected car for edits that cannot change another record's relationships.
// Omitted records are preserved in the committed directory, never deleted.
const sqlite=require('./sqlite-storage.cjs'),deferred=require('./deferred-store.cjs');
const {cloneJSON}=require('./json-data.cjs');
const common=['schema','id','revision','catalogueRevision','settings','choices','choiceAliases','views','customFields'];
const prepend=new Set(['events','setups','tests','submissions']);
function context(store,action,p={}){
 const {Store,validateDatabase}=require('./store.cjs'),s=new Store(),data=s.data,source=store.data,state=store.deferredState;
 for(const key of common)data[key]=source[key];
 const oneCar=id=>state.read(r=>r.record(JSON.stringify(['cars','id:'+id]),{assetHandle:true}));
 const simpleCar=['car.favourite','car.archive','work.add'].includes(action)||action==='car.save'&&p.id&&!Object.hasOwn(p.data||{},'picture')&&!Object.hasOwn(p.data||{},'photos')&&!Object.hasOwn(p.data||{},'technical');
 if(action==='car.delete'){for(const key of ['cars','parts','assemblies','installations','setups','tests','jobs','events','documents','planning','buildDrafts'])data[key]=source[key];}
 else if(simpleCar){
  data.cars=[oneCar(action==='work.add'?p.carId:p.id)];
 }else if(action.startsWith('supply.'))data.supplies=source.supplies;
 else if(['submission.add','submission.cancelLocal'].includes(action))data.submissions=source.submissions;
 else if(['settings.save','view.save','view.delete','custom.add','choice.add','columns.save'].includes(action)){
  if(p.showroomFeaturedId)data.cars=[oneCar(p.showroomFeaturedId)];
 }else if(action==='@club')data.club=source.club;
 else if(action==='@history-import'){data.timing.key=source.timing.key;data.timing.imports=[];}
 else if(action==='@timing-key'){
  data.timing.key=source.timing.key;
  const sessions=new Map(new Map(JSON.parse(state.manifest).object).get('timing').object).get('sessions').array;
  if(sessions.length)throw Error('Cannot create a Timing signing key for existing sessions. Use the dealership host or restore a verified backup.');
 }
 else if(action==='@timing'){
  data.timing.key=source.timing.key;
  const roots=new Map(JSON.parse(state.manifest).object),sessions=new Map(roots.get('timing').object).get('sessions').array;
  const key=JSON.stringify(['timing','sessions','session:'+JSON.stringify([p.source.id,p.sessionId])]);
  if(sessions.some(n=>n.record===key))data.timing.sessions=[state.read(r=>r.record(key,{assetHandle:true}))];
  else if(sessions.length>=10000){const e=Error('Maximum 10,000 imported session identities in this database.');e.apiCode='CAPACITY_EXCEEDED';e.httpStatus=507;throw e;}
  for(const id of new Set((p.participants||[]).map(x=>x.carId).filter(Boolean))){
   if(roots.get('cars').array.some(n=>n.record===JSON.stringify(['cars','id:'+id])))data.cars.push(oneCar(id));
  }
 }
 else{
  // Workshop/stock/setup changes share invariants. Load the entire connected
  // stock group, including reservations and historic assembly references.
  for(const key of ['cars','parts','assemblies','installations','setups','jobs','planning'])data[key]=source[key];
  // History is append-only except when checking whether stock may be deleted.
  if(['part.delete','part.deleteMany'].includes(action)){data.events=source.events;data.tests=source.tests;data.buildDrafts=source.buildDrafts;}
  if(action==='choice.rename')data.tests=source.tests;
  if(action.startsWith('document.')||action.startsWith('guide.'))data.documents=source.documents;
  if(action==='submission.review')data.submissions=source.submissions;
  if(action==='catalogue.apply')data.supplies=source.supplies;
  if(action.startsWith('build.')||action.startsWith('rebuild.')||action.startsWith('job.'))data.buildDrafts=source.buildDrafts;
 }
 s.data=validateDatabase(data);return s;
}
function merge(full,before,after,path=[]){
 if(JSON.stringify(before)===JSON.stringify(after))return full;
 if(before.array&&after.array&&full.array){
  const old=new Set(before.array.map(x=>x.record)),next=new Set(after.array.map(x=>x.record)),all=new Set(full.array.map(x=>x.record));
  const added=after.array.filter(x=>!old.has(x.record));
  if(added.some(x=>all.has(x.record)))throw Error('Duplicate collection record identity.');
  // A complete array owns its ordering (including index-keyed planning data).
  if(old.size===all.size&&[...old].every(k=>all.has(k)))return after;
  const kept=full.array.filter(x=>!old.has(x.record)||next.has(x.record));
  return {array:prepend.has(path.at(-1))?[...added,...kept]:[...kept,...added]};
 }
 if(before.object&&after.object&&full.object){
  const b=new Map(before.object),a=new Map(after.object),f=new Map(full.object);
  const entries=full.object.filter(([k])=>!b.has(k)||a.has(k)).map(([k,v])=>[k,b.has(k)&&a.has(k)?merge(v,b.get(k),a.get(k),[...path,k]):v]);
  for(const [k,v]of after.object)if(!f.has(k))entries.push([k,v]);
  return {object:entries};
 }
 return after;
}
function prepare(store,before,after,result){
 if(before===after)return {noop:true,result};
 if(after.id!==store.data.id||!Number.isSafeInteger(after.revision)||after.revision!==store.data.revision+1||!Number.isSafeInteger(after.catalogueRevision))throw Error('Invalid scoped collection revision.');
 // Describe the workspace without serializing its unchanged record bodies.
 const prior=sqlite.packChanges(before,before,store.assetHashes),packed=sqlite.packChanges(before,after,store.assetHashes,prior.manifest);
 packed.manifest=JSON.stringify(merge(JSON.parse(store.persistedManifest),JSON.parse(prior.manifest),JSON.parse(packed.manifest)));
 // A sparse context cannot itself enforce collection-wide count/size limits.
 const tree=JSON.parse(packed.manifest),roots=new Map(tree.object);
 for(const [key,max]of [['cars',10000],['parts',50000]])if(roots.get(key).array.length>max)throw Error('Database limit exceeded.');
 const seed=Object.fromEntries(['schema','id','revision','catalogueRevision'].map(k=>[JSON.stringify([k]),after[k]]));
 const state=deferred.create(store.file,packed.manifest,{...store.deferredState.token,revision:after.revision},seed);
 return {data:state.data,result,scope:{kind:'scoped',packed,state,before,after}};
}
function compact(store,action,p){
 if(action!=='car.save'||!p?.id)return p;
 const car=store.deferredState.read(r=>r.record(JSON.stringify(['cars','id:'+p.id]),{assetHandle:true}));
 return require('./club-model.cjs').compactPayload({cars:[car]},action,p);
}
function command(store,action,p){p=compact(store,action,p);const s=context(store,action,p),before=s.data;const result=s.mutate(action,p,{snapshot:false}).result;return prepare(store,before,s.data,result);}
function clubChange(store,proposalId,fn,baseScope){
 const before=baseScope?.kind==='scoped'?baseScope.before:context(store,'@club').data;
 const base=baseScope?.kind==='scoped'?baseScope.after:before;
 const actual=store.data.club;
 const left={...before,club:actual},right={...base,club:cloneJSON(actual),revision:store.data.revision+1};
 fn(right.club);require('./club-model.cjs').validate(right);
 return prepare(store,left,right);
}
function receiveTiming(store,input,options){
 store.assertIdle();
 try{
  const s=context(store,'@timing',input),before=s.data,result=require('./timing-integration.cjs').receive(s,input,options);
  const prepared=prepare(store,before,s.data,result);
  return require('./transaction.cjs').run(store,()=>prepared,{scoped:true});
 }catch(error){
  if(error.apiCode)throw error;
  const limit=error.code==='COLLECTION_LIMIT',e=Error(limit?'Database metadata exceeds its working limit. Archive unneeded records before retrying.':'Paddock could not save this session. Retry after checking host storage.');
  e.apiCode=limit?'CAPACITY_EXCEEDED':'STORAGE_FAILED';e.httpStatus=limit?507:500;throw e;
 }
}
module.exports={context,prepare,command,compact,clubChange,receiveTiming};
