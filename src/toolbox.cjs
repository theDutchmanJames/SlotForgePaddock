const {randomUUID}=require('node:crypto');
const {supplies}=require('../renderer/catalogue.js');
const iconAppearance=require('../renderer/icon-catalogue.js');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const text=(v,max=200)=>{check(typeof v==='string'&&v.length<=max,'Invalid toolbox text.');return v;};
function amount(value){if(value===null||value===undefined||value==='')return null;check((typeof value==='string'||typeof value==='number')&&String(value).trim()!=='','Enter an amount or leave it blank.');const n=Number(value);check(Number.isFinite(n)&&n>=0&&n<=1e9,'Amounts must be between 0 and 1,000,000,000.');return n;}
function validate(db,photo){
  check(Array.isArray(db.supplies)&&db.supplies.length<=10000,'Invalid workshop supplies.');const ids=new Set();
  for(const s of db.supplies){check(s&&typeof s.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s.id)&&!Object.hasOwn(Object.prototype,s.id)&&s.id!=='prototype'&&!ids.has(s.id),'Invalid supply identity.');ids.add(s.id);text(s.name);check(s.name.trim(),'Enter a supply name.');check(Object.hasOwn(supplies,s.category),'Choose a toolbox category.');check(['Tool / equipment','Consumable'].includes(s.kind),'Choose a supply kind.');check(Number.isSafeInteger(s.quantity)&&s.quantity>=0&&s.quantity<=1000000,'Enter a whole item quantity.');for(const k of ['partType','maker','reference','location','condition','unit','created','updated'])text(s[k]);text(s.notes,20000);require('./lazy-assets.cjs').copyPhoto({},'picture',s,photo);iconAppearance.validate(s);check(typeof s.archived==='boolean','Invalid supply archive flag.');
    for(const key of ['remaining','minimum'])check(s[key]===null||typeof s[key]==='number'&&amount(s[key])===s[key],'Invalid supply amount.');
    if(s.kind==='Consumable')check((s.remaining===null&&s.minimum===null)||s.unit.trim(),'Choose a unit for amounts.');else check(s.remaining===null&&s.minimum===null&&!s.unit,'Tools do not have consumable amounts.');
    check(Array.isArray(s.history),'Invalid supply history.');for(const h of s.history){text(h.date);for(const side of ['before','after']){check(h[side]&&['Tool / equipment','Consumable'].includes(h[side].kind),'Invalid supply history amount.');const a=h[side];check(Number.isSafeInteger(a.quantity)&&a.quantity>=0,'Invalid historical quantity.');for(const key of ['remaining','minimum'])check(a[key]===null||typeof a[key]==='number'&&amount(a[key])===a[key],'Invalid historical amount.');text(a.unit);}}
  }
}
function mutate(db,action,p,photo){
  check(p.revision===db.revision,'The database changed. Reopen this toolbox item before saving.');const old=p.id?db.supplies.find(s=>s.id===p.id):null;check(!p.id||old,'Toolbox item not found.');
  if(action==='supply.delete'){check(old,'Choose a toolbox item.');db.supplies=db.supplies.filter(s=>s.id!==old.id);return old.id;}
  if(action==='supply.archive'){check(old,'Choose a toolbox item.');old.archived=!old.archived;old.updated=new Date().toISOString();return old.id;}
  check(action==='supply.save','Unknown toolbox action.');const d=p.data;check(d&&typeof d==='object'&&!Array.isArray(d),'Invalid toolbox item.');
  const v={...iconAppearance.fields(d,old||{}),name:text(d.name).trim(),category:text(d.category),kind:text(d.kind),quantity:Number(d.quantity),remaining:d.kind==='Consumable'?amount(d.remaining):null,minimum:d.kind==='Consumable'?amount(d.minimum):null,unit:d.kind==='Consumable'?text(d.unit||''):''};
  check(typeof d.quantity==='number'||typeof d.quantity==='string'&&d.quantity.trim()!=='','Enter an item quantity.');
  for(const key of ['partType','maker','reference','location','condition'])v[key]=text(d[key]||'');v.notes=text(d.notes||'',20000);v.picture=photo(d.picture??old?.picture??'');v.updated=new Date().toISOString();
  const counts=s=>({kind:s.kind,quantity:s.quantity,remaining:s.remaining,minimum:s.minimum,unit:s.unit});
  if(old){if(JSON.stringify(counts(old))!==JSON.stringify(counts(v)))old.history.push({date:v.updated,before:counts(old),after:counts(v)});Object.assign(old,v);return old.id;}
  const record={...v,id:randomUUID(),created:v.updated,archived:false,history:[]};db.supplies.push(record);return record.id;
}
module.exports={validate,mutate};
