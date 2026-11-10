const validPhoto=f=>{const m=require('./lazy-assets.cjs').property(f,'data')?.meta;return m?m.photo&&m.chars<=12*1024*1024:typeof f.data==='string'&&f.data.length<=12*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(f.data);};
const {randomUUID}=require('node:crypto');
const {assemblyForPart}=require('./workshop.cjs');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const text=(x,max=200)=>typeof x==='string'&&x.length<=max;
const date=x=>x===''||typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const id=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x)&&!Object.hasOwn(Object.prototype,x)&&x!=='prototype';
const empty=()=>({shopping:[],jobs:[],shelves:[],focus:[]});
// Imported extra-photo IDs may be 'main'; keep that identity separate from the cover photo.
const photoData=(car,key)=>{const object=key==='main'?car:car?.photos.find(p=>p.id===(key==='photo:main'?'main':key)),field=key==='main'?'picture':'data',lazy=require('./lazy-assets.cjs'),asset=lazy.property(object,field);return asset?.meta.hash||(object?.[field]?lazy.digest(object[field]):null);};
const number=value=>{check(typeof value==='number'||typeof value==='string'&&value.trim()!=='','Enter a numeric value.');return Number(value);};
function purchasePart(db,partId){const part=db.parts.find(p=>p.id===partId);check(part,'Choose a catalogue part.');check(!assemblyForPart(db,partId),'This stock belongs to an assembly. Choose its original catalogue record or add a separate stock record.');return part;}
function validate(db){
  const p=db.planning;check(object(p),'Invalid collection planning.');
  for(const s of p.shopping||[]){check(s.buildId===undefined||id(s.buildId),'Invalid shopping build link.');check(s.buildName===undefined||text(s.buildName),'Invalid shopping build name.');check(s.buildCarId===undefined||id(s.buildCarId),'Invalid completed build link.');}
  for(const [key,max]of [['shopping',10000],['jobs',10000],['shelves',100],['focus',50000]])check(Array.isArray(p[key])&&p[key].length<=max,'Too many '+key+' records.');
  for(const key of ['shopping','shelves']){const seen=new Set();for(const r of p[key]){check(object(r)&&id(r.id)&&!seen.has(r.id),'Invalid planning identity.');seen.add(r.id);}}
  for(const r of p.shopping){check(db.parts.some(x=>x.id===r.partId)&&(!r.jobId||db.jobs.some(j=>j.id===r.jobId)),'Shopping item has a missing part or job.');check(Number.isSafeInteger(r.quantity)&&r.quantity>0&&r.quantity<=1000000&&Number.isSafeInteger(r.received)&&r.received>=0&&r.received<=r.quantity,'Invalid shopping quantity.');check(text(r.notes,2000)&&text(r.supplier)&&date(r.date)&&text(r.created,100)&&text(r.updated,100),'Invalid shopping details.');}
  const jobs=new Set();for(const r of p.jobs){check(object(r)&&db.jobs.some(j=>j.id===r.jobId)&&!jobs.has(r.jobId),'Invalid job plan.');jobs.add(r.jobId);check(['Low','Normal','High'].includes(r.priority)&&date(r.targetDate)&&typeof r.waiting==='boolean','Invalid job schedule.');check(Array.isArray(r.checklist)&&r.checklist.length<=50,'Maximum 50 checklist steps.');const steps=new Set();for(const s of r.checklist){check(object(s)&&id(s.id)&&!steps.has(s.id)&&text(s.text,300)&&s.text.trim()&&typeof s.done==='boolean','Invalid checklist step.');steps.add(s.id);}check(Array.isArray(r.photos)&&r.photos.length<=8,'Maximum eight job photographs.');const photos=new Set();for(const f of r.photos){check(object(f)&&id(f.id)&&!photos.has(f.id)&&['Before','After'].includes(f.stage)&&text(f.name)&&validPhoto(f),'Invalid job photograph.');photos.add(f.id);}}
  for(const s of p.shelves)check(text(s.name,100)&&s.name.trim()&&Array.isArray(s.carIds)&&s.carIds.length<=10000&&new Set(s.carIds).size===s.carIds.length&&s.carIds.every(i=>db.cars.some(c=>c.id===i)),'Invalid showroom shelf.');
  const focuses=new Set();for(const f of p.focus){check(object(f),'Invalid photograph focus.');const car=db.cars.find(c=>c.id===f.carId),key=JSON.stringify([f.carId,f.photoKey]);check(object(f)&&car&&photoData(car,f.photoKey)&&!focuses.has(key)&&[f.x,f.y].every(n=>Number.isFinite(n)&&n>=0&&n<=100),'Invalid photograph focus.');focuses.add(key);}
}
function mutate(db,action,p){
  check(p.revision===db.revision,'The database changed. Reopen this action.');const state=db.planning,stamp=new Date().toISOString();
  if(action==='planning.shopping.add'){
    const part=purchasePart(db,p.partId),quantity=number(p.quantity);check(!p.jobId||db.jobs.some(j=>j.id===p.jobId&&j.status==='active'),'Choose an active job.');
    const outstanding=state.shopping.filter(s=>s.partId===part.id).reduce((n,s)=>n+s.quantity-s.received,0);
    check(part.tracking!=='individual'||part.quantity+outstanding+quantity<=1,'An individually tracked part can only contain one item. Use a separate record for another identity.');
    const r={id:randomUUID(),partId:p.partId,jobId:p.jobId||'',quantity,received:0,notes:p.notes||'',supplier:p.supplier||'',date:p.date||'',created:stamp,updated:stamp};state.shopping.push(r);return r.id;
  }
  if(action==='planning.receive'){
    check(p.confirmed===true,'Confirm that these parts have been received.');const part=purchasePart(db,p.partId),amount=number(p.quantity);check(Number.isSafeInteger(amount)&&amount>0&&amount<=1000000,'Enter a positive whole quantity.');
    const line=p.shoppingId?state.shopping.find(x=>x.id===p.shoppingId&&x.partId===part.id):null;check(!p.shoppingId||line,'Shopping item not found.');if(line){check(amount<=line.quantity-line.received,'Quantity exceeds the remaining shopping quantity.');line.received+=amount;line.updated=stamp;}
    check(part.tracking!=='individual'||part.quantity+amount<=1,'An individually tracked part can only contain one item.');part.quantity+=amount;part.updated=stamp;return part.id;
  }
  if(action==='planning.shopping.remove'){const r=state.shopping.find(x=>x.id===p.id);check(r,'Shopping item not found.');check(!r.received,'Keep received purchases as history.');state.shopping=state.shopping.filter(x=>x.id!==p.id);return p.id;}
  if(action.startsWith('planning.job.')){
    const job=db.jobs.find(j=>j.id===p.jobId);check(job&&job.status==='active','Reopen an active workshop job.');let plan=state.jobs.find(j=>j.jobId===job.id);if(!plan){plan={jobId:job.id,priority:'Normal',targetDate:'',waiting:false,checklist:[],photos:[]};state.jobs.push(plan);}
    if(action==='planning.job.save'){check(Array.isArray(p.checklist),'Enter a checklist.');check(p.checklist.every(s=>object(s)&&(s.done===undefined||typeof s.done==='boolean')),'Invalid checklist step.');Object.assign(plan,{priority:p.priority,targetDate:p.targetDate,waiting:p.waiting,checklist:p.checklist.map(s=>({id:s.id||randomUUID(),text:s.text,done:s.done===true}))});}
    else if(action==='planning.job.check'){const step=plan.checklist.find(s=>s.id===p.id);check(step&&typeof p.done==='boolean','Checklist step missing.');step.done=p.done;}
    else if(action==='planning.job.photo'){plan.photos.push({id:randomUUID(),stage:p.stage,name:p.name,data:p.data});}
    else if(action==='planning.job.photo.remove'){check(plan.photos.some(f=>f.id===p.id),'Photo not found.');plan.photos=plan.photos.filter(f=>f.id!==p.id);}
    else throw Error('Unknown job planning action.');job.updated=stamp;return job.id;
  }
  if(action==='planning.shelf.save'){check(!p.id||state.shelves.some(s=>s.id===p.id),'Shelf not found.');const s={id:p.id||randomUUID(),name:p.name,carIds:p.carIds};const i=state.shelves.findIndex(x=>x.id===s.id);if(i<0)state.shelves.push(s);else state.shelves[i]=s;return s.id;}
  if(action==='planning.shelf.remove'){check(state.shelves.some(s=>s.id===p.id),'Shelf not found.');state.shelves=state.shelves.filter(s=>s.id!==p.id);return p.id;}
  if(action==='planning.focus'){const car=db.cars.find(c=>c.id===p.carId);check(car&&photoData(car,p.photoKey),'Photograph not found.');const focus={carId:p.carId,photoKey:p.photoKey,x:number(p.x),y:number(p.y)};state.focus=state.focus.filter(f=>f.carId!==p.carId||f.photoKey!==p.photoKey);state.focus.push(focus);return p.carId;}
  throw Error('Unknown planning operation.');
}
function pruneFocus(db,previous){db.planning.focus=db.planning.focus.filter(f=>{const c=db.cars.find(c=>c.id===f.carId),old=previous?.cars.find(c=>c.id===f.carId);if(!c)return false;const data=photoData(c,f.photoKey),oldData=photoData(old,f.photoKey);return !!data&&(!oldData||oldData===data);});}
module.exports={empty,validate,mutate,pruneFocus};
