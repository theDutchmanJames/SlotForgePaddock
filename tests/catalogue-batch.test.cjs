'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const B=require('../src/catalogue-batch.cjs'),C=require('../src/catalogue-import.cjs'),R=require('../src/catalogue-research.cjs'),{Store}=require('../src/store.cjs');
const product=(overrides={})=>({kind:'part',name:'Motor',manufacturer:'Example',reference:'M1',category:'Motors & motor parts',partType:'Motor',specifications:[],...overrides});
const file=(name,products)=>({name,input:{format:'slotforge-catalogue',version:1,products}});
test('focused templates partition every classification exactly once, without changing taxonomy',()=>{
  const all=C.kit(),collected=[];for(const group of R.groups()){const k=C.kit(group.id);assert.equal(k.reference.scope.id,group.id);assert.ok(k.reference.researchChecklists.every(c=>c.check.length>=3));collected.push(...k.reference.classificationOptions);assert.deepEqual(k.products,[]);assert.match(k.instructions,/RESEARCH SCOPE/);}
  const sort=a=>a.map(v=>JSON.stringify(v)).sort();assert.deepEqual(sort(collected),sort(all.reference.classificationOptions));assert.equal(new Set(sort(collected)).size,collected.length);
  assert.deepEqual(C.kit('part-tyres').reference.parts,{'Wheels & tyres':['Tyre']});assert.ok(!C.kit('part-wheels-accessories').reference.parts['Wheels & tyres'].includes('Tyre'));assert.throws(()=>C.kit('invalid'),/Unknown/);
  const motor=all.reference.researchChecklists.find(c=>c.partType==='Motor').check.join(' '),tyre=all.reference.researchChecklists.find(c=>c.partType==='Tyre').check.join(' ');
  assert.match(motor,/rated voltage/);assert.match(motor,/Torque units and test conditions/);assert.match(tyre,/Hardness and measurement scale/);assert.match(tyre,/Inner diameter/);assert.match(all.instructions,/Never generate a Cartesian product/);assert.match(all.instructions,/English/);
});
test('identical entries collapse while conflicting versions stay unselectable, preserving provenance',()=>{
 const a=product(),b=product({specifications:[{name:'RPM',value:'25000',unit:'rpm'}]});const result=B.combine([file('a.json',[a,a]),file('b.json',[b,a])]);
 assert.equal(result.originalRows,4);assert.equal(result.collapsed,2);assert.equal(result.input.products.length,1);assert.equal(result.input.products[0],null);assert.equal(result.conflicts[0].variants.length,2);assert.equal(result.conflicts[0].variants[0].sources.length,3);assert.equal(result.sources[0].length,4);
 const store=new Store();assert.throws(()=>store.mutate('catalogue.apply',{revision:store.data.revision,input:result.input,selections:[{index:0,create:true}],confirmed:true}));assert.equal(store.data.parts.length,0);
 result.input.products[0]=result.conflicts[0].variants[1].product;store.mutate('catalogue.apply',{revision:store.data.revision,input:result.input,selections:[{index:0,create:true}],confirmed:true});assert.equal(store.data.parts.length,1);assert.equal(store.data.parts[0].quantity,0);assert.equal(store.data.parts[0].catalogue.product.specifications[0].value,'25000');
});
test('bad rows keep forbidden fields and cannot get cleaned into safe imports by deduplication',()=>{
 const result=B.combine([file('a.json',[product({quantity:10})]),file('b.json',[product()])]);assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].variants[0].product.quantity,10);result.input.products[0]=result.conflicts[0].variants[0].product;assert.match(C.parse(result.input)[0].errors.join(' '),/quantity/);
});
test('different references and kinds stay separate; missing references match on names only',()=>{
 const result=B.combine([file('a.json',[product(),product({reference:'M2'}),product({reference:'',name:'No ref'}),product({reference:'',name:'Other'})]),file('b.json',[product({reference:'',name:'No ref'})])]);assert.equal(result.input.products.length,4);assert.equal(result.collapsed,1);
});
test('bad files and combined limits fail before any import',()=>{
 assert.throws(()=>B.combine([file('empty.json',[])]),/empty.json/);assert.throws(()=>B.combine([{name:'pictures.json',input:{format:'slotforge-catalogue-images',version:1}}]),/pictures.json/);
 assert.throws(()=>B.combine(Array.from({length:65},(_,i)=>file(i+'.json',[product()]))),/64/);
 assert.throws(()=>B.combine([file('large.json',Array.from({length:5001},()=>product()))]),/5,000/);
 assert.throws(()=>B.combine([file('large.json',[product({reviewNotes:'x'.repeat(B.limits.productBytes)})])]),/16 MiB/);
});
test('eight large catalogues combine, retain review notes, and preserve stock on selected updates',()=>{
 const files=Array.from({length:8},(_,f)=>file(f+'.json',Array.from({length:300},(_,i)=>product({reference:f+'-'+i,name:'Motor '+f+'-'+i}))));files[0].input.coverageNotes='One unavailable range';
 const result=B.combine(files);assert.equal(result.input.products.length,2400);assert.equal(result.sources[2399][0].file,'7.json');assert.equal(result.coverage[0].notes,'One unavailable range');
 const store=new Store();const id=store.mutate('part.save',{revision:store.data.revision,data:{name:'Personal name',maker:'Example',reference:'0-0',quantity:7,tracking:'quantity',notes:'Keep me'}}).result;
 const before=structuredClone(store.data.parts.find(p=>p.id===id));const p=C.preview(store.data,result.input);assert.equal(p.rows[0].status,'update');
 store.mutate('catalogue.apply',{revision:store.data.revision,input:result.input,selections:[{index:0,targetId:id},{index:2399,create:true}],confirmed:true});const after=store.data.parts.find(p=>p.id===id);for(const key of ['quantity','name','notes','photo'])assert.deepEqual(after[key],before[key]);assert.equal(store.data.parts.length,2);assert.equal(store.data.parts.find(p=>p.id!==id).quantity,0);
});
test('bounded reader supports BOM and reports the exact failing filename',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-catalogue-batch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const good=path.join(dir,'good.json'),bad=path.join(dir,'bad.json');fs.writeFileSync(good,'\uFEFF'+JSON.stringify(file('good.json',[product()]).input));fs.writeFileSync(bad,'broken');assert.equal((await B.readFiles([good]))[0].input.products.length,1);await assert.rejects(B.readFiles([good,bad]),/bad.json/);await assert.rejects(B.readFiles([dir]),/Not a regular file/);
 const large=path.join(dir,'oversized.json');const fd=fs.openSync(large,'w');fs.ftruncateSync(fd,B.limits.fileBytes+1);fs.closeSync(fd);await assert.rejects(B.readFiles([large]),/oversized.json.*16 MiB/);
});
