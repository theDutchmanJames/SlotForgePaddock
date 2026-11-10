const fs=require('node:fs');
const {isDeepStrictEqual}=require('node:util');
const {cloneJSON}=require('./json-data.cjs');
const ACTIONS=new Set('car.save car.favourite car.duplicate car.archive car.delete car.bulk part.save part.delete part.deleteMany part.appearance part.install part.remove assembly.create assembly.replace assembly.install assembly.remove assembly.dismantle setup.save setup.apply work.add test.add job.edit job.note job.start job.fit job.remove job.setting job.complete job.cancel supply.save supply.delete supply.archive document.add document.remove guide.add guide.edit guide.remove choice.add choice.rename columns.save settings.save view.save view.delete custom.add rebuild.start build.draft.save build.draft.delete build.create catalogue.apply submission.add planning.shopping.add planning.receive planning.shopping.remove planning.job.save planning.job.check planning.job.photo planning.job.photo.remove planning.shelf.save planning.shelf.remove planning.focus'.split(' '));
const check=(v,m)=>{if(!v)throw Error(m);};
const {hash}=require('./json-encoding.cjs');
function clean(value){if(value&&typeof value==='object'){for(const key of Object.keys(value)){check(!['__proto__','prototype','constructor'].includes(key),'Unsafe change property.');if(!require('./lazy-assets.cjs').property(value,key))clean(value[key]);}}}
function approved(db){const copy=cloneJSON(db);delete copy.club;delete copy.revision;delete copy.catalogueRevision;if(copy.timing)copy.timing.key=null;return copy;}
function digest(db){check(require('./json-encoding.cjs').byteLength(db)<=220*1024*1024,'This collection needs an updated Dealership connection for reviews. Reconnect with a current Paddock.');return hash(approved(db));}
function shared(db){const copy=cloneJSON(db);copy.timing.key=null;if(copy.club)copy.club.replica=true;return copy;}
function validate(db){
 if(db.club===null)return;
 const c=db.club;check(c&&typeof c.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(c.id)&&Array.isArray(c.proposals)&&c.proposals.length<=5000,'Invalid shared club state.');check(c.replica===undefined||typeof c.replica==='boolean','Invalid club copy flag.');
 const ids=new Set();for(const p of c.proposals){check(typeof p.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)&&!ids.has(p.id),'Invalid club proposal identity.');ids.add(p.id);command(p);check(['pending','accepted','rejected'].includes(p.status),'Invalid club review state.');check(typeof p.received==='string'&&typeof p.receiptHash==='string','Invalid club receipt.');}
}
function command(p){
 check(p?.baselineVersion===undefined||p.baselineVersion===1,'Unsupported review baseline version.');
 check(p&&typeof p==='object'&&ACTIONS.has(p.action),'This operation cannot be proposed to a club.');
 check(p.payload&&typeof p.payload==='object'&&!Array.isArray(p.payload),'Invalid change payload.');
 check(typeof p.device==='string'&&p.device.length>0&&p.device.length<=100,'Enter a device name.');
 check(typeof p.sourceId==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.sourceId),'Invalid submitting device.');
 check(typeof p.base==='string'&&/^[a-f0-9]{64}$/.test(p.base),'Invalid base configuration.');
 check(Array.isArray(p.original)&&p.original.length<=200,'Invalid change summary.');
 for(const r of p.original)check(r&&['field','before','after'].every(k=>typeof r[k]==='string'&&r[k].length<=600),'Invalid proposal comparison.');
 check(require('./json-encoding.cjs').byteLength(p)<=16*1024*1024,'A club proposal is limited to 16 MiB.');clean(p);require('./field-review.cjs').validate(p);
}
// Replication digests cover JSON bytes, including object key order. Deep value
// equality alone misses reordered keys in corrected/imported Timing payloads.
function sameOrderedData(a,b){
 if(Object.is(a,b))return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
 const left=Object.keys(a),right=Object.keys(b);
 return left.length===right.length&&left.every((key,i)=>key===right[i]&&sameMember(a,b,key));
}
function sameMember(a,b,key){const lazy=require('./lazy-assets.cjs'),left=lazy.property(a,key),right=lazy.property(b,key);if(left||right){if(left&&right)return left.meta.hash===right.meta.hash;const value=left?b?.[key]:a?.[key];return typeof value==='string'&&lazy.digest(value)===(left||right).meta.hash;}return sameOrderedData(a?.[key],b?.[key]);}
function deltaMember(a,b,key,path,out){if(sameMember(a,b,key))return;const lazy=require('./lazy-assets.cjs'),left=lazy.property(a,key),right=lazy.property(b,key);if(right){const change={path:[...path,key]};lazy.attach(change,'value',right);out.push(change);}else if(left)out.push({path:[...path,key],value:cloneJSON(b[key])});else delta(a[key],b[key],[...path,key],out);}
function delta(a,b,path=[],out=[]){
 if(sameOrderedData(a,b))return out;
 if(Array.isArray(a)&&Array.isArray(b)&&[...a,...b].every(x=>x&&typeof x.id==='string')&&new Set(a.map(x=>x.id)).size===a.length&&new Set(b.map(x=>x.id)).size===b.length){
  const old=new Map(a.map(x=>[x.id,x]));out.push({path,order:b.map(x=>x.id),records:b.filter(x=>!sameOrderedData(x,old.get(x.id))).map(x=>old.has(x.id)?{id:x.id,changes:delta(old.get(x.id),x)}:{id:x.id,value:cloneJSON(x)})});return out;
 }
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
  if(Array.isArray(a)){for(let i=0;i<b.length;i++)deltaMember(a,b,i,path,out);if(a.length>b.length)out.push({path,trim:b.length});}
  else{
   const left=Object.keys(a),right=Object.keys(b),rebuilt=[...left.filter(k=>Object.hasOwn(b,k)),...right.filter(k=>!Object.hasOwn(a,k))];
   // Recreate reordered objects using existing patch operations. This also
   // works at a record root, where an empty replacement path is not allowed.
   if(!isDeepStrictEqual(rebuilt,right)){for(const k of left)out.push({path:[...path,k],remove:true});for(const k of right)out.push({path:[...path,k],value:cloneJSON(b[k])});}
   else{for(const k of left)if(!Object.hasOwn(b,k))out.push({path:[...path,k],remove:true});for(const k of right)deltaMember(a,b,k,path,out);}
  }
 }else out.push({path,value:cloneJSON(b)});
 return out;
}
const {apply}=require('../renderer/snapshot-patch.js');
function describe(value){if(value===undefined)return 'Not recorded';if(typeof value==='string'&&value.startsWith('data:'))return 'Image / attachment';const text=typeof value==='string'?value:JSON.stringify(value);return (text??'Empty').slice(0,500);}
function summary(a,b,action=''){
 const rows=[],ignored=new Set(['id','revision','updated','created','date','received','reviewed']);
 function walk(before,after,path=[]){
  if(rows.length>=200||sameOrderedData(before,after))return;
  if(before===undefined&&(after===''||after===null||Array.isArray(after)&&after.length===0))return;
  if(Array.isArray(before)&&Array.isArray(after)&&[...before,...after].every(x=>x&&typeof x.id==='string')){
   const old=new Map(before.map(x=>[x.id,x])),next=new Map(after.map(x=>[x.id,x]));
   for(const id of new Set([...old.keys(),...next.keys()])){const record=old.get(id)||next.get(id),label=record.name||record.title||record.device||record.id;walk(old.get(id),next.get(id),[...path,String(label).slice(0,100)]);}return;
  }
  if((before===undefined||before&&typeof before==='object'&&!Array.isArray(before))&&(after===undefined||after&&typeof after==='object'&&!Array.isArray(after))){
   const keys=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].sort((x,y)=>(['name','title'].includes(x)?-1:0)-(['name','title'].includes(y)?-1:0));
   for(const key of keys)if(!ignored.has(key)&&!sameMember(before,after,key))walk(before?.[key],after?.[key],[...path,key]);return;
  }
  rows.push({field:path.join(' → ').slice(0,600),before:describe(before),after:after===undefined?'Removed':describe(after)});
 }
 // Preserve unchanged record identities so an ordinary review does not clone
 // and compare all cars, histories and laps. This projection is read-only.
 const ignoredRoots=new Set(['club','revision','catalogueRevision','timing',...(!action.startsWith('choice.')?['choices']:[])]);
 const project=db=>Object.defineProperties({},Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(db)).filter(([key])=>!ignoredRoots.has(key))));
 walk(project(a),project(b));return rows;
}
// Existing car editors submit complete forms. Preserve only deliberate edits so a
// later approval cannot overwrite an unrelated edit or resend an unchanged photo.
function compactPayload(db,action,payload){
 const p=cloneJSON(payload);
 if(action==='car.save'&&p.id){const old=db.cars.find(x=>x.id===p.id);if(old)for(const key of Object.keys(p.data)){if(['technical','factory','custom','realHistory'].includes(key)&&p.data[key]&&typeof p.data[key]==='object'){for(const sub of Object.keys(p.data[key]))if(sameMember(p.data[key],old[key],sub))delete p.data[key][sub];if(!Object.keys(p.data[key]).length)delete p.data[key];}else if(sameMember(p.data,old,key))delete p.data[key];}}
 if(action==='part.save'&&p.id&&sameMember(p.data,db.parts.find(x=>x.id===p.id),'picture'))delete p.data.picture;
 return p;
}
function write(file,data){if(!file)return;fs.mkdirSync(require('node:path').dirname(file),{recursive:true});const tmp=file+'.tmp',fd=fs.openSync(tmp,'w',0o600);try{fs.writeFileSync(fd,JSON.stringify(data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(tmp,file);}
module.exports={ACTIONS,check,hash,digest,shared,validate,command,delta,apply,summary,compactPayload,write,sameOrderedData,sameMember};
