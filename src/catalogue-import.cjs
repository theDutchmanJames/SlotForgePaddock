const {randomUUID}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const taxonomy=require('../renderer/catalogue.js');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const normal=v=>String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const tokenise=v=>[...new Set(normal(v).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>=3))];
const keyOf=(...values)=>JSON.stringify(values);
const fields=['kind','name','manufacturer','reference','category','partType','supplyKind','packSize','packUnit','packDescription','sourceUrl','checkedDate','reviewNotes','specifications'];
const instructions=`Fill the products array in this SlotForge catalogue template using the website(s) supplied by the user. Return a valid JSON file, not a code block. Keep format and version unchanged. The reference lists and examples are guidance only: never import the fictional examples as products.
Use only facts stated on product pages; do not invent references, measurements, compatibility or stock. Follow the site's access rules. Provide a product-page sourceUrl and the date actually checked (YYYY-MM-DD) for each product. Leave unknown text empty and unknown packSize null. Put uncertainty and conflicting source information in reviewNotes.
Use kind "part" or "supply" and exact categories/partTypes from reference. For supplies, use supplyKind "Tool / equipment" or "Consumable". Do not force a classification you cannot establish: leave it blank for the user to correct.
Copy the manufacturer and exact product reference/SKU, distinguishing variants. Include each manufacturer/reference once. Put specifications in an array of {name,value,unit}, with value and unit as strings. Keep units explicit and preserve stated values; do not infer physical fit. Suggested names include Scale, Dimensions, Material, Compatibility, RPM, Voltage, Axle diameter and Teeth.
packSize is the number of individual pieces in one sold pack only when explicitly known, never owned quantity. For bulk liquids etc., describe the packaging and record capacity with a unit in specifications. Do not include quantity, tracking, personal notes, prices or photographs. This file describes products; importing it creates zero-owned stock entries.
An empty product array is valid as a blank template, but there is nothing to import until it is filled. The user will review categories, products and proposed updates before importing.`;
function kit(){return {format:'slotforge-catalogue',version:1,instructions,reference:{parts:taxonomy.parts,supplies:taxonomy.supplies,productFields:fields,limits:{products:5000,specificationsPerProduct:60}},examples:[
  {kind:'part',name:'Example motor (fictional)',manufacturer:'Example Racing (fictional)',reference:'EXAMPLE-MOTOR',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'Single motor',sourceUrl:'https://example.com/fictional-motor',checkedDate:'',reviewNotes:'FICTIONAL EXAMPLE — do not import.',specifications:[{name:'RPM',value:'21500',unit:'rpm'},{name:'Voltage',value:'12',unit:'V'}]},
  {kind:'supply',name:'Example oil (fictional)',manufacturer:'Example Workshop (fictional)',reference:'EXAMPLE-OIL',category:'Cleaning & lubrication',partType:'Bearing oil',supplyKind:'Consumable',packSize:1,packUnit:'bottle',packDescription:'One bottle',sourceUrl:'https://example.com/fictional-oil',checkedDate:'',reviewNotes:'FICTIONAL EXAMPLE — do not import.',specifications:[{name:'Capacity',value:'20',unit:'ml'}]}
],products:[]};}
function row(input,index){
  const errors=[],warnings=[],p={};
  if(!object(input))return {index,product:null,errors:['Product must be an object.'],warnings};
  const string=(key,max=200)=>{const v=input[key]??'';if(typeof v!=='string'||v.length>max){errors.push(key+' must be text of at most '+max+' characters.');return '';}return v.trim();};
  for(const k of ['kind','name','manufacturer','reference','category','partType','supplyKind'])p[k]=string(k);
  for(const [k,max]of [['packUnit',80],['packDescription',500],['sourceUrl',2048],['checkedDate',10],['reviewNotes',4000]])p[k]=string(k,max);
  if(!['part','supply'].includes(p.kind))errors.push('Choose Part or Workshop supply.');
  if(!p.name)errors.push('Product name is required.');if(!p.manufacturer)errors.push('Manufacturer is required.');
  const categories=p.kind==='supply'?taxonomy.supplies:taxonomy.parts;
  if(!Object.hasOwn(categories,p.category))errors.push('Choose a supported category.');
  else if(!categories[p.category].includes(p.partType))errors.push('Choose a supported part / item type.');
  if(p.kind==='supply'&&!['Tool / equipment','Consumable'].includes(p.supplyKind))errors.push('Choose a supply kind.');
  if(p.kind==='part')p.supplyKind='';
  p.packSize=input.packSize??null;
  if(p.packSize!==null&&(!Number.isSafeInteger(p.packSize)||p.packSize<1||p.packSize>1000000))errors.push('Pack size must be a positive whole number or null.');
  if(p.sourceUrl){try{const u=new URL(p.sourceUrl);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error();}catch{errors.push('Source must be an HTTP or HTTPS URL without credentials.');}}
  else warnings.push('No product source URL supplied.');
  if(p.checkedDate){if(!/^\d{4}-\d{2}-\d{2}$/.test(p.checkedDate)||!Number.isFinite(Date.parse(p.checkedDate))||new Date(p.checkedDate).toISOString().slice(0,10)!==p.checkedDate)errors.push('Checked date must be a valid YYYY-MM-DD date.');}
  else warnings.push('Source check date is missing.');
  if(!p.reference)warnings.push('No product reference: matching will need extra care.');
  if(p.packSize===null)warnings.push('Pack size is unknown.');
  if(p.reviewNotes)warnings.push('Source uncertainty / review notes supplied.');
  p.specifications=[];
  const specs=input.specifications??[];
  if(!Array.isArray(specs)||specs.length>60)errors.push('Specifications must be an array of at most 60 entries.');
  else for(const s of specs){if(!object(s)||typeof s.name!=='string'||!s.name.trim()||s.name.length>100||typeof s.value!=='string'||s.value.length>2000||typeof s.unit!=='string'||s.unit.length>80){errors.push('Each specification needs a name, text value and text unit.');break;}p.specifications.push({name:s.name.trim(),value:s.value.trim(),unit:s.unit.trim()});}
  for(const key of ['quantity','owned','tracking','remaining','privateNotes'])if(Object.hasOwn(input,key))errors.push(key+' is not a catalogue field. Remove it; ownership is managed in Stock.');
  const extra=Object.keys(input).filter(k=>!fields.includes(k));if(extra.length)warnings.push('Unsupported fields are ignored: '+extra.slice(0,10).join(', '));
  return {index,product:p,errors:[...new Set(errors)],warnings};
}
function parse(input){
  check(object(input)&&input.format==='slotforge-catalogue'&&input.version===1,'Choose a SlotForge catalogue JSON file (version 1).');
  check(Array.isArray(input.products)&&input.products.length>0&&input.products.length<=5000,'The catalogue needs 1–5,000 products. The empty template and examples are not imported.');
  check(Buffer.byteLength(JSON.stringify(input))<=16*1024*1024,'Catalogue file exceeds 16 MB. Split it into smaller catalogues.');
  const rows=input.products.map(row),keys=new Map();
  for(const r of rows){const p=r.product;if(!p||!p.manufacturer||!p.name)continue;const key=keyOf(p.kind,normal(p.manufacturer),p.reference?'reference':'name',normal(p.reference||p.name));const list=keys.get(key)||[];list.push(r);keys.set(key,list);}
  for(const group of keys.values())if(group.length>1)for(const r of group)r.errors.push('Repeated manufacturer/reference (or name without a reference) in this file. Remove duplicate rows in the source file before importing this product.');
  return rows;
}
function records(db){return [...db.parts.map(value=>({kind:'part',value})),...db.supplies.map(value=>({kind:'supply',value}))];}
function identity(record){const p=record.value.catalogue?.product;return {maker:normal(p?p.manufacturer:record.value.maker),reference:normal(p?p.reference:record.value.reference),name:p?p.name:record.value.name};}
function preview(db,input){
  const rows=parse(input),stock=records(db),exact=new Map(),names=new Map(),words=new Map();
  const add=(map,key,value)=>{const list=map.get(key)||[];list.push(value);map.set(key,list);};
  for(const r of stock){const i=identity(r);if(i.reference)add(exact,keyOf(r.kind,i.maker,i.reference),r);add(names,keyOf(r.kind,i.maker,normal(i.name)),r);for(const word of tokenise(i.name))add(words,keyOf(r.kind,word),r);}
  for(const r of rows){
    r.matches=[];r.status='invalid';if(r.errors.length)continue;
    const p=r.product,sameName=names.get(keyOf(p.kind,normal(p.manufacturer),normal(p.name)))||[];
    const candidates=p.reference?exact.get(keyOf(p.kind,normal(p.manufacturer),normal(p.reference)))||[]:sameName.filter(c=>c.value.catalogue&&!identity(c).reference);
    if(candidates.length){r.status=candidates.length===1?(isDeepStrictEqual(candidates[0].value.catalogue?.product,p)?'unchanged':'update'):'ambiguous';r.matches=candidates;}
    else{
      const tokens=tokenise(p.name),pool=new Set(sameName.slice(0,300));for(const word of tokens)for(const c of words.get(keyOf(p.kind,word))||[]){const maker=identity(c).maker;if((!maker||maker===normal(p.manufacturer))&&pool.size<300)pool.add(c);}
      r.matches=[...pool].map(c=>{const name=identity(c).name,t=tokenise(name),common=t.filter(w=>tokens.includes(w)).length;return {c,score:normal(name)===normal(p.name)?1:2*common/Math.max(1,t.length+tokens.length)};}).filter(x=>x.score>=.6).sort((a,b)=>b.score-a.score).slice(0,8).map(x=>x.c);
      r.status=r.matches.length?'possible':'new';
    }
    r.matches=r.matches.map(({kind,value})=>({id:value.id,kind,name:value.name,maker:value.maker,reference:value.reference,quantity:value.quantity,location:value.location||'',archived:!!value.archived}));
  }
  return {revision:db.revision,rows};
}
function selected(db,p){
  check(p.revision===db.revision,'The database changed. Refresh the catalogue review before importing.');
  const model=preview(db,p.input);check(Array.isArray(p.selections)&&p.selections.length>0&&p.selections.length<=5000,'Select at least one valid product.');
  const seen=new Set(),targets=new Set(),chosen=[];
  for(const pick of p.selections){
    check(object(pick)&&Number.isSafeInteger(pick.index)&&!seen.has(pick.index),'Invalid or repeated product selection.');seen.add(pick.index);
    const r=model.rows[pick.index];check(r&&!r.errors.length,'A selected product has errors. Correct it or leave it unselected.');
    if(pick.targetId){check(r.matches.some(m=>m.id===pick.targetId),'Choose a suggested existing record for this product.');check(!targets.has(pick.targetId),'Two products cannot update the same stock record in one import.');targets.add(pick.targetId);}
    else check(pick.create===true&&['new','possible'].includes(r.status),'Resolve this product match before importing.');
    check(r.status!=='unchanged','This product is already up to date.');
    chosen.push({product:r.product,targetId:pick.targetId||null,index:r.index});
  }
  return {...model,chosen,created:chosen.filter(c=>!c.targetId).length,updated:chosen.filter(c=>c.targetId).length};
}
function spec(p,name){const s=p.specifications.find(s=>normal(s.name)===name);return s?[s.value,s.unit].filter(Boolean).join(' ').slice(0,2000):'';}
function apply(db,p){
  check(p.confirmed===true,'Confirm the reviewed catalogue import.');const review=selected(db,p),stamp=new Date().toISOString();
  for(const choice of review.chosen){
    const product=choice.product,meta={product:structuredClone(product),importedAt:stamp};
    if(choice.targetId){const item=(product.kind==='part'?db.parts:db.supplies).find(v=>v.id===choice.targetId);item.catalogue=meta;item.updated=stamp;continue;}
    const shared={id:randomUUID(),name:product.name,maker:product.manufacturer,reference:product.reference,category:product.category,partType:product.partType,quantity:0,location:'',condition:'New',notes:'',picture:'',created:stamp,updated:stamp,catalogue:meta};
    if(product.kind==='part')db.parts.push({...shared,tracking:'quantity',scale:spec(product,'scale'),dimensions:spec(product,'dimensions'),material:spec(product,'material'),compatibility:spec(product,'compatibility')});
    else db.supplies.push({...shared,kind:product.supplyKind,remaining:null,minimum:null,unit:'',history:[],archived:false});
  }
  return {created:review.created,updated:review.updated};
}
function validateStored(db){for(const {kind,value}of records(db)){if(value.catalogue===undefined)continue;const c=value.catalogue;check(object(c)&&typeof c.importedAt==='string'&&c.importedAt.length<=100,'Invalid catalogue metadata.');const r=row(c.product,0);check(!r.errors.length&&r.product.kind===kind&&isDeepStrictEqual(r.product,c.product),'Invalid stored catalogue product.');}}
module.exports={kit,instructions,parse,preview,selected,apply,validateStored};
