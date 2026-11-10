'use strict';
// Private, bounded projections for the merge editor. Never exported through the
// Timing/Telemetry contracts. Read operations do not prepare or commit a merge.
const M=require('./car-merge-model.cjs'),A=require('./car-merge-archive.cjs');
const {cloneJSON:clone}=require('./json-data.cjs'),lazy=require('./lazy-assets.cjs');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const name=(db,id)=>db.cars.find(c=>c.id===id)?.name||id;
const get=(o,p)=>p.reduce((v,k)=>v?.[k],o);
const labels={maker:'Slotcar manufacturer',marque:'Car brand',reference:'Reference number',raceClass:'Racing class',technical:'Technical specifications',factory:'Factory reference',realHistory:'Real car history',pinion:'Pinion teeth',gear:'Driven gear teeth'};
const label=p=>p.map(k=>labels[k]||String(k).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase())).join(' / ');
function text(v){if(v===undefined||v===null||v==='')return '—';const s=typeof v==='string'?v:JSON.stringify(v);return s.length>4096?s.slice(0,4096)+'… [preview shortened]':s;}
function page(rows,q){const offset=q.offset??0,limit=q.limit??30;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>60)fail('INVALID_QUERY','Invalid review page.');return {rows:rows.slice(offset,offset+limit),total:rows.length,offset,limit};}
const isAsset=(v,k)=>!!lazy.property(v,k)||typeof v[k]==='string'&&(v[k].startsWith('data:')||k==='data'&&typeof v.mime==='string');
function safeNode(v,depth=0,budget={left:16000}){
 if(depth>6||budget.left<=0)return '[preview shortened]';
 if(!v||typeof v!=='object'){const s=text(v);budget.left-=s.length;return s;}
 const result=Array.isArray(v)?[]:{};
 for(const k of Object.keys(v).slice(0,60)){if(budget.left<=0)break;Object.defineProperty(result,k,{value:isAsset(v,k)?'[attachment — open separately]':safeNode(v[k],depth+1,budget),enumerable:true});}
 return result;
}
function proposal(db,id){const p=db.mergeProposals?.find(p=>p.id===id);if(!p)fail('MERGE_NOT_FOUND','Merge review not found.');return p;}
function rows(db,p,group){
 const a=db.cars.find(c=>c.id===p.mainCarId),b=db.cars.find(c=>c.id===p.retiredCarId),c=p.choices;
 if(group==='fields')return Object.keys(c.fields).map(key=>{const path=JSON.parse(key);return {key,label:label(path),main:text(get(a,path)),incoming:text(get(b,path)),different:A.digest(get(a,path))!==A.digest(get(b,path))};});
 if(group==='settings')return require('./car-merge-settings.cjs').rows(db,p.mainCarId,p.retiredCarId).map(r=>({...r,mainText:r.main.ambiguous?'Conflicting main origins — choose a value':r.main.present?r.main.value===null?'Cleared (use default)':text(r.main.value):'Not set (use default)',candidates:r.candidates.map(v=>({...v,text:!v.present?'Not set (use default)':v.value===null?'Cleared (use default)':text(v.value)}))}));
 if(group==='photos')return Object.keys(c.photos).map(key=>({key,label:key==='picture'?'Original cover':(key.startsWith('photo:')?b.photos:b.realHistory?.photos||[]).find(r=>r.id===key.slice(key.indexOf(':')+1))?.name||'Photo',asset:true}));
 if(Object.hasOwn(c.records,group))return Object.keys(c.records[group]).map(key=>{const r=db[group].find(r=>r.id===key);return {key,label:r?.name||r?.title||r?.task||group,detail:text(safeNode(r)),document:group==='documents',active:group==='jobs'&&r?.status==='active'};});
 if(group==='history'){const all=new Map(M.contributions(db).map(r=>[r.key,r]));return Object.keys(c.history).map(key=>history(all.get(key),key));}
 if(group==='stock')return [...Object.keys(c.installations).map(key=>{const i=db.installations.find(r=>r.id===key);return {key,kind:'installation',label:db.parts.find(r=>r.id===i.partId)?.name||i.partId,detail:`${name(db,i.carId)} · ${i.quantity} piece(s) · ${i.slot||i.position||'Unassigned position'}`,main:i.carId===p.mainCarId,matches:db.installations.filter(j=>j.id!==i.id&&j.carId===p.mainCarId&&!j.removed&&!j.assemblyId&&j.partId===i.partId&&j.quantity===i.quantity&&Object.hasOwn(c.installations,j.id)).map(j=>({id:j.id,name:`${name(db,j.carId)} · ${j.slot||j.position||j.id}`}))};}),...Object.keys(c.assemblies).map(key=>{const r=db.assemblies.find(r=>r.id===key);return {key,kind:'assembly',label:r.name,detail:name(db,r.carId),main:r.carId===p.mainCarId};})];
 fail('INVALID_QUERY','Unknown review section.');
}
function history(r,key){const race=r?.record?.bundle?.race||r?.record?.payload||{};return {key,label:race.name||r?.record?.origin?.name||r?.sessionId||'Historical session',detail:[race.startedAt||race.date||r?.startedAt||'Date unknown',r?.sourceId,r?.sessionId,r?.format].filter(Boolean).join(' · ')};}
function summary(db,p){return {id:p.id,mainCarId:p.mainCarId,retiredCarId:p.retiredCarId,mainName:name(db,p.mainCarId),retiredName:name(db,p.retiredCarId),status:p.status,revision:p.revision,updated:p.updated,archives:p.archives};}
function inspect(db,p,recoveryId){
 let blocker=null;
 if(p.status==='pending')try{
  M.preflight(db,{id:p.id,expectedRevision:p.revision},recoveryId);
  // Domain dry-run finds stock/field contradictions too, without a backup or
  // persistence. Its output is discarded; actual approval verifies a real copy.
  M.prepare(db,{databaseId:db.id,recoveryId,sourceId:'review-preview',operationId:'preview',action:'approve',payload:{id:p.id,expectedRevision:p.revision}}, {recoveryId,backup:{verified:true,databaseId:db.id,recoveryId,dependencyToken:p.dependencyToken}});
 }catch(e){blocker={code:e.code||'MERGE_SELECTION_CONFLICT',message:e.message};}
 const groups=['fields','settings','photos',...Object.keys(p.choices.records),'history','stock'];
 return {...summary(db,p),choices:clone(p.choices),recoveryId,needsRefresh:p.status==='pending'&&(p.recoveryId!==recoveryId||p.dependencyToken!==M.token(db,p.mainCarId,p.retiredCarId)),blocker,groups:groups.map(key=>({key,count:rows(db,p,key).length})),incomingService:!!db.cars.find(c=>c.id===p.retiredCarId)?.service,serviceDetails:{main:safeNode(db.cars.find(c=>c.id===p.mainCarId)?.service),incoming:safeNode(db.cars.find(c=>c.id===p.retiredCarId)?.service)}};
}
function archive(db,id){const a=db.mergeArchives?.find(a=>a.id===id);if(!a)fail('MERGE_NOT_FOUND','Archive not found.');return {a,graph:A.thaw(a,db.mergeChunks)};}
function nodeAt(root,path){if(!Array.isArray(path)||path.length>40||path.some(k=>typeof k!=='string'||['__proto__','prototype','constructor'].includes(k)))fail('INVALID_QUERY','Invalid archive path.');let node=root;for(const k of path){if(!node||typeof node!=='object'||!Object.hasOwn(node,k))fail('MERGE_NOT_FOUND','Archive item not found.');node=node[k];}return node;}
function nodeEntries(node){
 if(node&&typeof node==='object')return Object.keys(node).map(key=>{const media=isAsset(node,key);return {key,asset:media,branch:!media&&!!node[key]&&(typeof node[key]==='object'||typeof node[key]==='string'&&node[key].length>4096),label:key,value:media?'Attachment':node[key]&&typeof node[key]==='object'?`${Object.keys(node[key]).length} items`:text(node[key])};});
 if(typeof node==='string'&&node.length>4096)return Array.from({length:Math.ceil(node.length/4096)},(_,i)=>({key:'',label:'Text · part '+(i+1),value:node.slice(i*4096,(i+1)*4096)}));
 return [{key:'',value:text(node)}];
}
function attachment(value,document){
 if(document){require('./documents.cjs').validateDocument(document);value='data:'+document.mime+';base64,'+document.data;}
 if(typeof value!=='string'||value.length>32*1024*1024)fail('ATTACHMENT_TOO_LARGE','This attachment is too large for inline preview. It remains in the recovery backup.');
 const match=/^data:([^;]+);base64,[A-Za-z0-9+/=\r\n]+$/.exec(value),allowed=new Set([...Object.values(require('./documents.cjs').TYPES),'image/gif']);
 if(!match||!allowed.has(match[1]))fail('INVALID_ATTACHMENT','This attachment cannot be previewed.');
 return {data:value,mime:match[1],name:document?.name||'paddock-archive-image.png'};
}
function read(db,recoveryId,q){
 if(!q||q.databaseId!==db.id)fail('DATABASE_MISMATCH','The collection changed. Reopen Review.');
 if(q.recoveryId&&q.recoveryId!==recoveryId)fail('RECOVERY_CHANGED','The database was restored. Reopen Review.');
 const base={databaseId:db.id,recoveryId};
 if(q.action==='list')return {...base,...page((db.mergeProposals||[]).filter(p=>q.completed?p.status!=='pending':p.status==='pending').map(p=>summary(db,p)),q),pending:db.mergeProposals.filter(p=>p.status==='pending').length};
 if(q.action==='candidates')return {...base,...page(db.cars.filter(c=>!c.merge&&!c.rebuild&&(!q.main||!c.archived)&&(!q.search||c.name.toLowerCase().includes(String(q.search).toLowerCase()))).map(c=>({id:c.id,name:c.name,detail:[c.maker,c.reference,c.scale,c.archived?'Archived':''].filter(Boolean).join(' · ')})),q)};
 if(q.action==='inspect')return {...base,...inspect(db,proposal(db,q.id),recoveryId)};
 if(q.action==='rows'){const p=proposal(db,q.id);if(q.revision!==p.revision)fail('MERGE_REVIEW_STALE','Another reviewer saved this review. Reopen it.');return {...base,...page(rows(db,p,q.group),q)};}
 if(q.action==='evidence'){
  const item=q.late?db.mergeInclusions.find(i=>i.id===q.id):proposal(db,q.id);
  if(!item||!q.late&&!Object.hasOwn(item.choices.history,q.key))fail('MERGE_NOT_FOUND','History item not found.');
  const r=M.contributions(db).find(r=>r.key===(q.late?item.key:q.key));if(!r)fail('MERGE_NOT_FOUND','The source history is no longer available. Refresh Review.');
  return {...base,...page(nodeEntries(nodeAt(r.rawOnly?require('./shared-library-evidence.cjs').decode(r.record.extra):r.record,q.path||[])),q),title:history(r,r.key).label};
 }
 if(q.action==='photo'){const p=proposal(db,q.id),c=db.cars.find(c=>c.id===p.retiredCarId);if(!Object.hasOwn(p.choices.photos,q.key))fail('MERGE_NOT_FOUND','Photo not found.');const v=q.key==='picture'?c.picture:(q.key.startsWith('photo:')?c.photos:c.realHistory?.photos||[]).find(r=>r.id===q.key.slice(q.key.indexOf(':')+1))?.data;return attachment(v);}
 if(q.action==='document'){const p=proposal(db,q.id);if(!Object.hasOwn(p.choices.records.documents,q.key))fail('MERGE_NOT_FOUND','Document not found.');return attachment(null,db.documents.find(d=>d.id===q.key));}
 if(q.action==='archives')return {...base,...page((db.mergeMappings||[]).map(m=>({...m,mainName:name(db,m.mainCarId),retiredName:name(db,m.retiredCarId)})),q)};
 if(q.action==='archive'){
  const {a,graph}=archive(db,q.id),node=nodeAt(graph,q.path||[]),edge=db.mergeMappings.find(m=>m.id===a.mergeId);
  const entries=nodeEntries(node);
  return {...base,...page(entries,q),id:a.id,created:a.created,side:a.side,carName:graph.car.name,mainCarId:edge.mainCarId,mainName:name(db,edge.mainCarId),readOnly:true};
 }
 if(q.action==='archiveAsset'){const g=archive(db,q.id).graph,value=nodeAt(g,q.path),parent=nodeAt(g,q.path.slice(0,-1));return attachment(value,q.path.at(-1)==='data'&&parent.mime?parent:undefined);}
 if(q.action==='late'){const evidence=new Map(M.contributions(db).map(r=>[r.key,r]));return {...base,...page((db.mergeInclusions||[]).filter(i=>i.late).map(i=>{const m=db.mergeMappings.find(m=>m.id===i.mergeId),r=evidence.get(i.key);return {...i,...history(r,i.key),canInclude:!!r&&!r.withdrawn,mainName:name(db,m.mainCarId),retiredName:name(db,i.originalCarId)};}),q)};}
 fail('INVALID_QUERY','Unknown merge review query.');
}
module.exports={read,rows,inspect};
