const fs = require('node:fs');
const clubModel=require('./club-model.cjs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const workshop = require('./workshop.cjs');
const jobs = require('./jobs.cjs');
const planning=require('./planning.cjs');
const {readJSON}=require('./files.cjs');
const collection=require('./collection.cjs');
const catalogue=require('../renderer/catalogue.js');
const toolbox=require('./toolbox.cjs');
const preferences=require('./preferences.cjs');
const inventory=require('./inventory.cjs');
const build=require('./build.cjs');
const timing=require('./timing-integration.cjs');
const catalogueImport=require('./catalogue-import.cjs');
const iconAppearance=require('../renderer/icon-catalogue.js');
const {validateDocument}=require('./documents.cjs');

const ID = /^[a-zA-Z0-9_-]{1,100}$/;
const UNSAFE_IDS=new Set([...Object.getOwnPropertyNames(Object.prototype),'prototype']);
const TEXT_FIELDS = ['name','number','maker','reference','marque','model','scale','vehicleYear','releaseYear','livery','colours','raceNumber','team','drivers','event','edition','serial','origin','owner','ownership','condition','packaging','completeness','location','availability','acquired','acquisitionMethod','seller','price','currency','costs','valuation','valuationDate','valuationSource','loanTo','loanDate','returnDate','disposalDate','disposalMethod','salePrice','category','raceClass','description','privateNotes','inspection'];
const TECH_FIELDS = ['body','bodyMaterial','bodySettings','chassis','wheelbase','motor','motorLayout','pod','podSettings','ratedRpm','ratedVoltage','measuredRpm','measuredVoltage','measuredDate','pinion','gear','gearType','frontAxle','rearAxle','frontBearings','rearBearings','frontWheels','rearWheels','frontTyres','rearTyres','frontDiameter','rearDiameter','frontAxlePlay','rearAxlePlay','guide','braids','wiring','lights','digitalSystem','chip','magnets','ballast','suspension','fasteners','weight','clearance','frontWidth','rearWidth','technicalNotes'];
const PUBLIC_FIELDS = ['name','number','maker','reference','marque','model','scale','vehicleYear','releaseYear','livery','colours','raceNumber','team','drivers','event','edition','origin','category','raceClass','description'];
TECH_FIELDS.push('pinionPart','gearPart');
TECH_FIELDS.push('motorTorque','torqueVoltage','torqueType','motorType');
const COMPONENT_FIELDS=['body','chassis','motor','pod','pinionPart','gearPart','frontAxle','rearAxle','frontBearings','rearBearings','frontWheels','rearWheels','frontTyres','rearTyres','guide','braids','wiring','lights','chip','magnets','ballast','suspension','fasteners'];
const TECH = new Set(COMPONENT_FIELDS);
const collectionContext={textFields:TEXT_FIELDS,techFields:TECH_FIELDS};
const {cloneJSON:clone}=require('./json-data.cjs');
const now = () => new Date().toISOString();
function assert(condition, message) { if (!condition) throw new Error(message); }
function text(value, max = 20000) { assert(typeof value === 'string' && value.length <= max, 'Invalid text or text too long.'); return value; }
function ident(value) { assert(typeof value === 'string' && ID.test(value)&&!UNSAFE_IDS.has(value), 'Invalid record identity.'); return value; }
function calendarDate(value,optional=true){text(value,30);if(optional&&!value)return value;assert(/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Enter a valid calendar date.');return value;}
function unique(records,kind){const seen=new Set();for(const record of records){object(record);ident(record.id);assert(!seen.has(record.id),'Duplicate '+kind+' identity.');seen.add(record.id);}return seen;}
function guardInstalled(db,car,changes){for(const i of db.installations.filter(i=>i.carId===car.id&&!i.removed&&i.field)){if(Object.hasOwn(changes,i.field))assert(changes[i.field]===car.technical[i.field]||changes[i.field]===db.parts.find(p=>p.id===i.partId).name,'The '+i.field+' field has an installed component. Use the workshop to replace or remove it first.');}}
function strings(value) { assert(Array.isArray(value) && value.length <= 100, 'Too many labels.'); return [...new Set(value.map(v => text(v, 160).trim()).filter(Boolean))]; }
function object(value) { assert(value && typeof value === 'object' && !Array.isArray(value), 'Invalid record.'); return value; }
function cleanMap(value, fields) { const result = {}; object(value); for (const k of fields) if (Object.hasOwn(value,k)) result[k] = text(value[k]); return result; }
function photo(value) { text(value, 12 * 1024 * 1024); assert(!value || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value), 'Use a PNG, JPEG or WebP image.'); return value; }
function carData(input) {
  object(input); const out = cleanMap(input, TEXT_FIELDS);
  if(out.name!==undefined)text(out.name,200);
  for (const k of ['usage','tags']) if (Object.hasOwn(input,k)) out[k] = strings(input[k]);
  for (const k of ['technical','factory']) if (Object.hasOwn(input,k)) out[k] = cleanMap(input[k], TECH_FIELDS);
  if (Object.hasOwn(input,'picture')) out.picture = photo(input.picture);
  if (Object.hasOwn(input,'photos')) { assert(Array.isArray(input.photos) && input.photos.length <= 40,'Maximum 40 photos per car.'); out.photos = input.photos.map(p => ({id:ident(p.id),name:text(p.name,200),data:photo(p.data)})); }
  if (Object.hasOwn(input,'custom')) { out.custom = {}; const entries=Object.entries(object(input.custom)); assert(entries.length <= 100,'Maximum 100 custom values.'); for (const [k,v] of entries) { ident(k); assert(!['__proto__','constructor','prototype'].includes(k),'Invalid custom field.'); out.custom[k]=text(v); } }
  for (const k of ['archived','favourite']) if (Object.hasOwn(input,k)) { assert(typeof input[k]==='boolean','Invalid flag.'); out[k]=input[k]; }
  return out;
}
function initial() { return {schema:11,club:null,planning:planning.empty(),timing:{key:null,sessions:[]},buildDrafts:[],supplies:[],jobs:[],id:randomUUID(),revision:0,catalogueRevision:0,settings:{name:'My collection',theme:'dark',columns:[...collection.DEFAULT_COLUMNS]},cars:[],parts:[],assemblies:[],installations:[],setups:[],events:[],tests:[],submissions:[],choices:{},choiceAliases:[],documents:[],views:[],customFields:[]}; }
function migrate(input){const db=clone(object(input));if(db.schema===1){db.schema=2;db.assemblies=[];}if(db.schema===2){db.schema=3;db.choiceAliases=[];db.documents=[];object(db.settings).columns=[...collection.DEFAULT_COLUMNS];if(Array.isArray(db.views))for(const view of db.views)view.columns=[...collection.DEFAULT_COLUMNS];}if(db.schema===3){db.schema=4;db.jobs=[];}if(db.schema===4){db.schema=5;db.supplies=[];if(Array.isArray(db.parts))for(const p of db.parts){Object.assign(p,catalogue.classify(p.category,p.partType));for(const key of ['maker','scale','dimensions','material','compatibility','picture'])p[key]??='';}}if(db.schema===5)db.schema=6;if(db.schema===6)db.schema=7;if(db.schema===7){db.schema=8;db.buildDrafts=[];}if(db.schema===8){db.schema=9;db.timing??={key:null,sessions:[]};}if(db.schema===9){db.schema=10;db.planning??=planning.empty();}if(db.schema===10){db.schema=11;db.club??=null;}if(db.schema===11&&!Object.hasOwn(db,'catalogueRevision'))db.catalogueRevision=0;if(Array.isArray(db.submissions))for(const sub of db.submissions){object(sub);sub.package=validatePackage(sub.package);}return validateDatabase(db);}
function publicCar(car) {
  const result = {id:car.id,...cleanMap(car,PUBLIC_FIELDS),technical:cleanMap(car.technical || {},TECH_FIELDS),picture:car.picture || '',usage:clone(car.usage || [])};
  return result;
}
// Compare exactly the visible catalogue (including its name and ordering), not
// car revision stamps or a hand-maintained list of mutation types. Some workshop
// actions change public specifications; others only add private history.
function publicCatalogue(db){return {id:db.id,name:db.settings.name,cars:db.cars.filter(c=>!c.archived).map(publicCar)};}
function advanceCatalogue(before,after){
  const changed=!isDeepStrictEqual(publicCatalogue(before),publicCatalogue(after));
  const revision=before.catalogueRevision+(changed?1:0);
  assert(Number.isSafeInteger(revision)&&revision>=0,'Public catalogue revision limit reached.');
  after.catalogueRevision=revision;
}
function makePackage(db, ids, options={}) {
  assert(Array.isArray(ids)&&ids.length>0&&ids.length<=1000,'Select 1–1,000 cars.');assert(new Set(ids).size===ids.length,'Duplicate car selection.');
  const cars = ids.map(id=>{const c=db.cars.find(c=>c.id===id); assert(c,'Car no longer exists.'); const result=publicCar(c);
    if(options.photos) result.photos=clone(c.photos || []);
    if(options.setups) result.sharedSetups=db.setups.filter(s=>s.carId===id).map(s=>({id:s.id,name:s.name,date:s.date,technical:clone(s.technical),notes:s.notes,track:s.track}));
    return result;
  });
  return validatePackage({format:'slotforge-car-package',version:1,packageId:randomUUID(),source:db.id,sender:db.settings.name,created:now(),cars});
}
function validatePackage(input) {
  object(input); assert(input.format==='slotforge-car-package' && input.version===1,'This is not a supported SlotForge car package.');
  assert(Array.isArray(input.cars) && input.cars.length>0 && input.cars.length<=1000,'Invalid car count.');
  const seen=new Set();
  const cars=input.cars.map(c=>{object(c);const id=ident(c.id);assert(!seen.has(id),'Duplicate car identity in package.');seen.add(id);
    const data={id,...cleanMap(c,PUBLIC_FIELDS)};assert(data.name?.trim(),'A submitted car needs a name.');text(data.name,200);
    if(Object.hasOwn(c,'technical'))data.technical=cleanMap(c.technical,TECH_FIELDS);
    if(Object.hasOwn(c,'picture'))data.picture=photo(c.picture);
    if(Object.hasOwn(c,'usage'))data.usage=strings(c.usage);
    if(Object.hasOwn(c,'photos')){data.photos=carData({photos:c.photos}).photos;unique(data.photos,'photo');}
    if(Object.hasOwn(c,'sharedSetups')) { assert(Array.isArray(c.sharedSetups)&&c.sharedSetups.length<=200,'Too many setups.'); data.sharedSetups=c.sharedSetups.map(s=>{assert(typeof s.name==='string'&&s.name.trim(),'A shared setup needs a name.');return {id:ident(s.id),name:text(s.name,200),date:text(s.date,100),technical:cleanMap(s.technical,TECH_FIELDS),notes:text(s.notes||''),track:text(s.track||'',200)};});unique(data.sharedSetups,'shared setup'); }
    return data;
  });
  return {format:input.format,version:1,packageId:ident(input.packageId),source:ident(input.source),sender:text(input.sender,200),created:text(input.created,100),cars};
}
function validateDatabase(db,encoded) {
  object(db); assert(db.schema===11,'Unsupported database version.');clubModel.validate(db);planning.validate(db);ident(db.id);build.validateDrafts(db);timing.validateStored(db);
  assert(Number.isSafeInteger(db.revision) && db.revision>=0,'Invalid database revision.');
  assert(Number.isSafeInteger(db.catalogueRevision)&&db.catalogueRevision>=0,'Invalid public catalogue revision.');
  for(const k of ['cars','parts','installations','setups','events','tests','submissions','views','customFields']){assert(Array.isArray(db[k]),'Invalid database: '+k);unique(db[k],k);}
  assert(db.cars.length<=10000 && db.parts.length<=50000,'Database limit exceeded.');
  object(db.settings);text(db.settings.name,200);assert(db.settings.name.trim(),'Missing database name.');preferences.validate(db.settings,collection.metadata(db,collectionContext).columns);
  object(db.choices);for(const values of Object.values(db.choices)){assert(Array.isArray(values)&&values.length<=20000,'Invalid saved choices.');values.forEach(v=>text(v));}
  for(const f of db.customFields){text(f.label,160);assert(f.label.trim(),'Missing custom field label.');assert(['text','choice','number','date','yesno','notes'].includes(f.type),'Invalid custom field type.');}
  for(const v of db.views){text(v.name,160);text(v.query,200);strings(v.usage);assert(['gallery','table'].includes(v.mode)&&['name','maker','updated'].includes(v.sort)&&typeof v.matchAll==='boolean'&&typeof v.archived==='boolean','Invalid saved view.');}
  const ids=new Set(db.cars.map(c=>c.id)),pids=new Set(db.parts.map(p=>p.id));
  for(const c of db.cars){carData(c);assert(c.name?.trim(),'Missing car name.');assert(Number.isSafeInteger(c.revision)&&c.revision>=1,'Invalid car revision.');object(c.technical);strings(c.usage);strings(c.tags);object(c.factory);object(c.custom);assert(Array.isArray(c.photos),'Invalid car photos.');unique(c.photos,'photo');}
  for(const p of db.parts){text(p.name,200);assert(p.name.trim(),'Missing part name.');assert(['quantity','individual'].includes(p.tracking),'Invalid part tracking.');assert(Number.isSafeInteger(p.quantity)&&p.quantity>=0,'Invalid stock quantity.');if(p.tracking==='individual')assert(p.quantity<=1,'Individual part quantity exceeds one.');for(const k of ['category','condition','location','reference','notes'])text(p[k]);for(const k of ['partType','maker','scale','dimensions','material','compatibility'])text(p[k]||'',2000);if(p.picture!==undefined)photo(p.picture);iconAppearance.validate(p);}
  const used=new Map();for(const i of db.installations){assert(ids.has(i.carId)&&pids.has(i.partId),'Orphan installation.');assert(Number.isSafeInteger(i.quantity)&&i.quantity>0,'Invalid installed quantity.');text(i.field,100);assert(!i.field||TECH_FIELDS.includes(i.field),'Invalid installation field.');text(i.position,160);text(i.installed,100);assert(i.removed===null||typeof i.removed==='string','Invalid removal record.');if(i.name!==undefined)text(i.name,200);if(!i.removed)used.set(i.partId,(used.get(i.partId)||0)+i.quantity);}
  for(const p of db.parts)assert((used.get(p.id)||0)<=p.quantity,'Installed stock exceeds owned quantity.');
  workshop.validateWorkshop(db,TECH_FIELDS);
  for(const s of db.setups){assert(ids.has(s.carId),'Orphan setup.');text(s.name,200);assert(s.name.trim(),'Missing setup name.');text(s.date,100);text(s.track||'',200);text(s.notes||'');cleanMap(s.technical,TECH_FIELDS);assert(Array.isArray(s.installations),'Invalid setup inventory.');const slots=new Set();for(const i of s.installations){assert(pids.has(i.partId),'Missing setup component.');text(i.name,200);assert(Number.isSafeInteger(i.quantity)&&i.quantity>0,'Invalid setup quantity.');text(i.position,160);text(i.field,100);assert(!i.field||TECH_FIELDS.includes(i.field),'Invalid setup component field.');if(i.field){assert(!slots.has(i.field),'Duplicate setup component position.');slots.add(i.field);}if(i.assemblyId){ident(i.assemblyId);text(i.assemblyName,200);assert(db.assemblies.some(a=>a.id===i.assemblyId),'Missing saved assembly.');}}}
  for(const e of db.events){assert(ids.has(e.carId),'Orphan history.');text(e.title,500);text(e.type,100);text(e.date,100);text(e.notes||'');for(const k of ['performedDate','nextDue'])if(e[k]!==undefined)calendarDate(e[k]);if(e.task!==undefined)text(e.task,200);}
  for(const t of db.tests){assert(ids.has(t.carId),'Orphan test.');cleanMap(t.technical,TECH_FIELDS);text(t.notes||'');text(t.date,100);for(const k of ['track','lane','driver','voltage','laps','best','average'])text(t[k]);if(t.setupId)assert(db.setups.some(s=>s.id===t.setupId&&s.carId===t.carId),'Invalid test setup.');for(const k of ['voltage','laps','best','average'])if(t[k])assert(Number.isFinite(Number(t[k]))&&Number(t[k])>=0,'Invalid test figure.');if(t.laps)assert(Number.isSafeInteger(Number(t.laps)),'Invalid lap count.');}
  jobs.validate(db,TECH_FIELDS);
  for(const t of db.tests){if(t.installations!==undefined)jobs.validateSnapshot(db,t,TECH_FIELDS);if(t.jobId)assert(db.jobs.some(j=>j.id===t.jobId&&j.carId===t.carId),'Invalid test job.');}
  collection.validateCollection(db,collectionContext);
  toolbox.validate(db,photo);catalogueImport.validateStored(db);
  assert(Array.isArray(db.documents),'Invalid document collection.');unique(db.documents,'document');const docCounts=new Map();for(const d of db.documents){assert(ids.has(d.carId),'Orphan document.');validateDocument(d);text(d.title,200);assert(d.title.trim(),'Missing document title.');text(d.category,160);text(d.added,100);docCounts.set(d.carId,(docCounts.get(d.carId)||0)+1);assert(docCounts.get(d.carId)<=100,'Maximum 100 documents per car.');}
  const packages=new Set();for(const s of db.submissions){const pack=validatePackage(s.package);assert(!packages.has(pack.packageId),'Duplicate submission package.');packages.add(pack.packageId);assert(['pending','reviewed'].includes(s.status),'Invalid submission status.');object(s.outcomes);text(s.received,100);for(const [id,outcome]of Object.entries(s.outcomes)){assert(pack.cars.some(c=>c.id===id),'Unknown review outcome.');object(outcome);assert(['accept','reject'].includes(outcome.decision),'Invalid review decision.');text(outcome.date,100);text(outcome.note||'');}assert((s.status==='reviewed')===pack.cars.every(c=>Object.hasOwn(s.outcomes,c.id)),'Review status and decisions disagree.');}
  const json=JSON.stringify(db);assert(Buffer.byteLength(json)<=200*1024*1024,'Database exceeds 200 MB. Export or reduce image sizes.');if(encoded)encoded.json=json;
  return db;
}
class Store {
  constructor(file) {this.listeners=new Set();this.file=file;this.data=initial();if(file&&fs.existsSync(file))this.data=migrate(readJSON(file));}
  snapshot(){return clone(this.data);}
  subscribe(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
  emit(){for(const fn of this.listeners)try{fn();}catch{}}
  replace(data){const encoded={};validateDatabase(data,encoded);this.persist(data,encoded.json);this.data=data;this.emit();return this.snapshot();}
  metadata(){return collection.metadata(this.data,collectionContext);}
  plan(action,p={}){if(action==='catalogue.preview')return catalogueImport.preview(this.data,p.input);if(action==='catalogue.selection')return catalogueImport.selected(this.data,p);if(action==='build.preview')return build.plan(this.data,p);if(action==='part.delete')return inventory.deletion(this.data,p.id);if(action==='job.view')return jobs.model(this.data,p.id,TECH_FIELDS);if(action==='choices.catalogue')return collection.catalogue(this.data,collectionContext);if(action==='setup.options')return workshop.setupOptions(this.data,p.id);if(['setup.preview','choice.preview','bulk.preview'].includes(action)){const draft=this.snapshot(),result=action==='setup.preview'?workshop.applySetup(draft,p,true):action==='choice.preview'?collection.renameChoice(draft,p,collectionContext,true):collection.applyBulk(draft,p,true);validateDatabase(draft);return result;}throw new Error('Unknown preview.');}
  persist(db,json){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.tmp'; const fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,json??JSON.stringify(db));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}if(fs.existsSync(this.file))fs.copyFileSync(this.file,this.file+'.previous');fs.renameSync(temp,this.file);}
  transact(fn){const draft=clone(this.data);const result=fn(draft);planning.pruneFocus(draft,this.data);draft.revision++;advanceCatalogue(this.data,draft);const encoded={};validateDatabase(draft,encoded);this.persist(draft,encoded.json);this.data=draft;this.emit();return result;}
  mutate(action,p={}) {object(p);let result;if(action.startsWith('planning.')){this.transact(db=>{result=planning.mutate(db,action,p);});return {result,data:this.snapshot(),collection:this.metadata()};}
    if(action==='submission.add'){const pack=validatePackage(p.package);const existing=this.data.submissions.find(s=>s.package.packageId===pack.packageId);if(existing){assert(isDeepStrictEqual(existing.package,pack),'This package identity was already used for different content. Export a new package for changed cars.');return {result:'duplicate',data:this.snapshot()};}}
    this.transact(db=>{
      const getCar=id=>{const c=db.cars.find(c=>c.id===id);assert(c,'Car not found.');return c;};
      const checkedCar=()=>{const c=getCar(p.id);assert(c.revision===p.revision,'This car changed. Close the editor and reopen it before saving.');return c;};
      const event=(carId,type,title,notes='',extra={})=>db.events.unshift({id:randomUUID(),carId,type,title,date:now(),notes,...extra});
      const touch=c=>{c.revision++;c.updated=now();};
      const remember=c=>collection.rememberChoices(db,c,collectionContext);
      switch(action){
        case 'catalogue.apply':result=catalogueImport.apply(db,p);break;
        case 'build.draft.save':case 'build.draft.delete':case 'build.create':result=build.mutate(db,action,p,remember);break;
        case 'part.delete':result=inventory.remove(db,p);break;
        case 'part.appearance':{assert(p.revision===db.revision,'The database changed. Reopen the icon picker.');const part=db.parts.find(x=>x.id===p.id);assert(part,'Part not found.');Object.assign(part,iconAppearance.fields(object(p.data),part),{updated:now()});result=part.id;break;}
        case 'supply.delete':case 'supply.save':case 'supply.archive':result=toolbox.mutate(db,action,p,photo);break;
        case 'choice.add':case 'choice.rename':case 'car.bulk':case 'columns.save':{if(action==='car.bulk'&&Array.isArray(p.ids))for(const id of p.ids)remember(getCar(id));result=collection.mutateCollection(db,action,p,collectionContext);if(result?.rows)for(const row of result.rows)remember(getCar(row.id));break;}
        case 'document.add':{const c=getCar(p.carId);assert(c.revision===p.revision,'The car changed. Reopen the document action.');validateDocument(p.document);assert(typeof p.title==='string'&&p.title.trim(),'Enter a document title.');const d={id:randomUUID(),carId:c.id,name:p.document.name,mime:p.document.mime,size:p.document.size,data:p.document.data,title:text(p.title.trim(),200),category:text(p.category||'Document',160),added:now()};db.documents.push(d);touch(c);event(c.id,'document','Document attached',d.title);result=d.id;break;}
        case 'document.remove':{const d=db.documents.find(d=>d.id===p.id);assert(d,'Document not found.');const c=getCar(d.carId);assert(c.revision===p.revision,'The car changed. Reopen the document action.');db.documents=db.documents.filter(d=>d.id!==p.id);touch(c);event(c.id,'document','Document removed',d.title);break;}
        case 'job.edit':case 'job.note':case 'job.start':case 'job.fit':case 'job.remove':case 'job.setting':case 'job.complete':case 'job.cancel':result=jobs.mutate(db,action,p,TECH_FIELDS);break;
        case 'assembly.replace':case 'assembly.create':case 'assembly.install':case 'assembly.remove':case 'assembly.dismantle':case 'setup.apply':result=workshop.mutateWorkshop(db,action,p,COMPONENT_FIELDS);break;
        case 'car.save':{const data=carData(p.data);if(p.id){const c=checkedCar();remember(c);assert((data.name??c.name).trim(),'Enter a car name.');if(data.technical){guardInstalled(db,c,data.technical);data.technical={...c.technical,...data.technical};}if(data.factory)data.factory={...c.factory,...data.factory};if(data.custom)data.custom={...c.custom,...data.custom};Object.assign(c,data);touch(c);remember(c);event(c.id,'correction','Details updated');result=c.id;}else{assert(data.name?.trim(),'Enter a car name.');const c={id:randomUUID(),revision:1,created:now(),updated:now(),usage:[],tags:[],technical:{},factory:{},photos:[],custom:{},ownership:'Owned',availability:'Available',...data};db.cars.push(c);remember(c);event(c.id,'created','Car added');result=c.id;}break;}
        case 'car.favourite':{const c=checkedCar();assert(typeof p.value==='boolean','Invalid favourite flag.');c.favourite=p.value;touch(c);result=c.id;break;}
        case 'car.duplicate':{const original=getCar(p.id);const data=publicCar(original);delete data.id;const c={...data,id:randomUUID(),name:original.name.slice(0,193)+' (copy)',number:'',revision:1,created:now(),updated:now(),ownership:'Owned',availability:'Available',photos:[],factory:clone(original.factory||{}),custom:{},tags:[]};db.cars.push(c);event(c.id,'created','Car duplicated','New physical identity; no history or ownership copied.');result=c.id;break;}
        case 'car.archive':{const c=checkedCar();c.archived=!c.archived;touch(c);event(c.id,'archive',c.archived?'Car archived':'Car restored');break;}
        case 'part.save':{if(p.revision!==undefined)assert(p.revision===db.revision,'The database changed. Reopen the part editor.');const old=p.id?db.parts.find(x=>x.id===p.id):null;assert(!p.id||old,'Part not found.');if(old)assert(!workshop.assemblyForPart(db,old.id),'Dismantle the assembly before editing its component stock.');const d=object(p.data);assert(typeof d.quantity==='number'||typeof d.quantity==='string'&&d.quantity.trim()!=='','Enter a quantity as a whole number.');const quantity=Number(d.quantity);assert(Number.isSafeInteger(quantity)&&quantity>=0,'Quantity must be a non-negative whole number within the supported range.');assert(d.name?.trim(),'Enter a part name.');assert(['quantity','individual'].includes(d.tracking),'Choose tracking method.');if(d.tracking==='individual')assert(quantity===0||quantity===1,'An individual part has quantity 0 or 1.');const classification=catalogue.classify(text(d.category||old?.category||'Other',160),text(d.partType??old?.partType??'',200));const v={...classification,...iconAppearance.fields(d,old||{}),name:text(d.name,200),tracking:d.tracking,quantity,location:text(d.location||'',200),condition:text(d.condition||'New',100),reference:text(d.reference||'',200),notes:text(d.notes||''),updated:now(),picture:photo(d.picture??old?.picture??'')};for(const key of ['maker','scale','dimensions','material','compatibility'])v[key]=text(d[key]??old?.[key]??'',2000);if(old){assert(!db.installations.some(i=>i.partId===old.id)&&!db.assemblies.some(a=>[...a.components,...(a.history||[]).flatMap(e=>[...e.before,...e.after])].some(c=>c.partId===old.id))||v.tracking===old.tracking,'Cannot change tracking after a part has been used.');if(v.name!==old.name){for(const i of db.installations.filter(i=>i.partId===old.id)){i.name??=old.name;if(!i.removed&&i.field){const c=getCar(i.carId);c.technical[i.field]=v.name;touch(c);event(c.id,'correction','Installed part name corrected',old.name+' → '+v.name);}}}Object.assign(old,v);result=old.id;}else{const part={id:randomUUID(),created:now(),...v};db.parts.push(part);result=part.id;}break;}
        case 'part.install':{const c=getCar(p.carId),part=db.parts.find(x=>x.id===p.partId);assert(part,'Part not found.');const quantity=Number(p.quantity);assert(Number.isInteger(quantity)&&quantity>0,'Enter a positive whole quantity.');const field=p.field||'';assert(!field||TECH.has(field),'Invalid component field.');if(field)assert(!db.installations.some(i=>i.carId===c.id&&i.field===field&&!i.removed),'Remove the existing tracked component in this position first.');db.installations.push({id:randomUUID(),carId:c.id,partId:part.id,name:part.name,quantity,field,position:text(p.position||part.category,160),installed:now(),removed:null});if(field)c.technical[field]=part.name;touch(c);event(c.id,'installation','Installed '+part.name,`${quantity} piece(s) · ${p.position||part.category}`);break;}
        case 'part.remove':{const i=db.installations.find(x=>x.id===p.id);assert(i&&!i.removed,'Installation not found.');assert(!i.assemblyId,'Remove the complete assembly or dismantle it first.');assert(['spares','discarded'].includes(p.destination),'Choose spares or discarded.');const part=db.parts.find(x=>x.id===i.partId),c=getCar(i.carId);i.removed=now();i.destination=p.destination;if(part.tracking==='individual'){if(p.destination==='discarded')part.quantity=0;part.condition=p.destination==='discarded'?'Discarded':'Used';part.location=p.destination==='discarded'?'Discarded':text(p.location||'Used spares',200);part.updated=now();}else{part.quantity-=i.quantity;if(p.destination==='spares')db.parts.push({...clone(part),id:randomUUID(),sourcePartId:part.sourcePartId||part.id,quantity:i.quantity,condition:'Used',location:text(p.location||'Used spares',200),created:now(),updated:now()});}if(i.field)c.technical[i.field]='';touch(c);event(c.id,'removal','Removed '+part.name,p.destination==='spares'?'Returned to used spares':'Discarded');break;}
        case 'setup.save':{const c=getCar(p.carId);if(p.carRevision!==undefined)assert(c.revision===p.carRevision,'The car changed. Reopen Add setup to capture its latest configuration.');assert(p.name?.trim(),'Enter a setup name.');db.setups.unshift({id:randomUUID(),carId:c.id,name:text(p.name,200),date:now(),notes:text(p.notes||''),track:text(p.track||'',200),technical:clone(c.technical),installations:db.installations.filter(i=>i.carId===c.id&&!i.removed).map(i=>({partId:i.partId,quantity:i.quantity,position:i.position,field:i.field,name:db.parts.find(p=>p.id===i.partId).name,...(i.assemblyId?{assemblyId:i.assemblyId,assemblyName:db.assemblies.find(a=>a.id===i.assemblyId).name}:{})}))});collection.rememberValue(db,'track',p.track);event(c.id,'setup','Saved '+p.name);break;}
        case 'work.add':{const c=getCar(p.carId);assert(p.title?.trim(),'Enter the work performed.');assert(['maintenance','modification'].includes(p.type),'Invalid work type.');event(c.id,p.type,text(p.title,200),text(p.notes||''),{performedDate:calendarDate(p.performedDate||now().slice(0,10),false),nextDue:calendarDate(p.nextDue||''),task:text(p.task?.trim()||p.title.trim(),200)});break;}
        case 'test.add':{const c=getCar(p.carId),setup=p.setupId?db.setups.find(s=>s.id===p.setupId&&s.carId===c.id):null;assert(!p.setupId||setup,'Setup does not belong to this car.');const t={id:randomUUID(),carId:c.id,date:now(),setupId:p.setupId||'',technical:clone(setup?setup.technical:c.technical),installations:clone(setup?setup.installations:jobs.snapshot(db,c.id).installations),configurationSource:setup?'saved':'current',...(!setup&&db.jobs.some(j=>j.carId===c.id&&j.status==='active')?{jobId:db.jobs.find(j=>j.carId===c.id&&j.status==='active').id}:{}),track:text(p.track||'',200),lane:text(p.lane||'',50),driver:text(p.driver||'',200),voltage:text(p.voltage||'',30),laps:text(p.laps||'',30),best:text(p.best||'',30),average:text(p.average||'',30),notes:text(p.notes||'')};for(const k of ['voltage','laps','best','average'])if(t[k])assert(Number.isFinite(Number(t[k]))&&Number(t[k])>=0,'Test figures must be non-negative numbers.');if(t.laps)assert(Number.isInteger(Number(t.laps)),'Lap count must be a whole number.');db.tests.unshift(t);collection.rememberValue(db,'track',t.track);collection.rememberValue(db,'driver',t.driver);event(c.id,'test','Manual test recorded',t.track);break;}
        case 'settings.save':{if(p.revision!==undefined)assert(p.revision===db.revision,'The database changed. Reopen preferences before saving.');if(p.name!==undefined){assert(p.name.trim(),'Enter a database name.');db.settings.name=text(p.name,200);}if(p.showroomFeaturedId)assert(db.cars.some(c=>c.id===p.showroomFeaturedId&&!c.archived),'Choose a car in the active collection.');preferences.save(db.settings,p,collection.metadata(db,collectionContext).columns);break;}
        case 'view.save':{assert(p.name?.trim(),'Enter a view name.');db.views.push({id:randomUUID(),name:text(p.name,160),query:text(p.query||'',200),usage:strings(p.usage||[]),matchAll:!!p.matchAll,mode:p.mode==='table'?'table':'gallery',sort:['name','maker','updated'].includes(p.sort)?p.sort:'name',archived:!!p.archived,columns:clone(collection.validateColumns(db,p.columns||db.settings.columns,collectionContext))});break;}
        case 'view.delete':db.views=db.views.filter(v=>v.id!==p.id);break;
        case 'custom.add':{assert(p.label?.trim(),'Enter a field label.');assert(['text','choice','number','date','yesno','notes'].includes(p.type),'Invalid field type.');assert(!db.customFields.some(f=>f.label.toLowerCase()===p.label.trim().toLowerCase()),'That field already exists.');db.customFields.push({id:randomUUID(),label:text(p.label.trim(),160),type:p.type});break;}
        case 'submission.add':{const bundle=validatePackage(p.package);const sub={id:randomUUID(),package:bundle,received:now(),status:'pending',outcomes:{},note:''};db.submissions.unshift(sub);result=sub.id;break;}
        case 'submission.review':{const sub=db.submissions.find(s=>s.id===p.id);assert(sub&&sub.status==='pending','Submission already reviewed.');const incoming=sub.package.cars.find(c=>c.id===p.carId);assert(incoming&&!sub.outcomes[incoming.id],'Car already reviewed.');assert(['accept','reject'].includes(p.decision),'Invalid decision.');if(p.decision==='accept'){let c=db.cars.find(c=>c.id===incoming.id);assert((c?.revision||0)===p.revision,'The club record changed. Refresh the comparison before accepting.');const allowed=Object.keys(incoming).filter(k=>!['id','sharedSetups'].includes(k));const fields=strings(p.fields||allowed);assert(fields.every(f=>allowed.includes(f)),'Invalid submitted field.');if(!c){assert(fields.includes('name'),'A new car needs its name.');c={id:incoming.id,revision:0,created:now(),name:incoming.name,technical:{},factory:{},usage:[],tags:[],photos:[],custom:{},ownership:'Owned',availability:'Available'};db.cars.push(c);}if(fields.includes('technical'))guardInstalled(db,c,incoming.technical);for(const f of fields)c[f]=f==='technical'?{...c.technical,...clone(incoming.technical)}:clone(incoming[f]);if(p.includeSetups)for(const s of incoming.sharedSetups||[])if(!db.setups.some(x=>x.carId===c.id&&x.sourceId===s.id))db.setups.unshift({...clone(s),id:randomUUID(),carId:c.id,sourceId:s.id,installations:[]});touch(c);remember(c);event(c.id,'sharing','Submission accepted',sub.package.sender);}sub.outcomes[incoming.id]={decision:p.decision,date:now(),note:text(p.note||'')};if(sub.package.cars.every(c=>sub.outcomes[c.id]))sub.status='reviewed';break;}
        default:throw new Error('Unknown operation.');
      }
      const prior=new Map(this.data.cars.map(c=>[c.id,c.revision]));for(const c of db.cars)if(prior.get(c.id)!==c.revision)remember(c);
    });return {result,data:this.snapshot(),collection:this.metadata()};
  }
  restore(input,revision){const data=migrate(input);assert(this.data.revision===revision,'Database changed. Export again before restoring.');data.revision=this.data.revision+1;if(data.id===this.data.id){const previous={...this.data,catalogueRevision:Math.max(this.data.catalogueRevision,data.catalogueRevision)};advanceCatalogue(previous,data);}const encoded={};validateDatabase(data,encoded);this.persist(data,encoded.json);this.data=data;this.emit();return this.snapshot();}
}
module.exports={Store,initial,migrate,validateDatabase,validatePackage,makePackage,publicCar,publicCatalogue,PUBLIC_FIELDS,TECH_FIELDS,COMPONENT_FIELDS,TEXT_FIELDS};
