'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const C=require('../src/catalogue-import.cjs'),R=require('../src/catalogue-research.cjs'),P=require('../src/catalogue-pricing.cjs'),B=require('../src/catalogue-batch.cjs'),{Store,migrate}=require('../src/store.cjs');
const price=(extra={})=>({amount:24.5,currency:'EUR',status:'estimate',basis:'pack',explanation:'Estimated from similar motors; pack of one.',sourceUrl:'',checkedDate:'',...extra});
const product=(extra={})=>({kind:'part',name:'Motor',manufacturer:'Example',reference:'M1',category:'Motors & motor parts',partType:'Motor',specifications:[],...extra});
const input=products=>({format:'slotforge-catalogue',version:1,products});
const act=(s,a,p)=>s.mutate(a,{revision:s.data.revision,...p}).result;
test('every complete and focused kit has explicit coverage, currency and safe estimation instructions',()=>{
 for(const currency of P.currencies)for(const id of [undefined,...R.groups().map(g=>g.id)]){const k=C.kit(id,currency);assert.equal(k.reference.pricing.currency,currency);assert.ok(k.reference.groupCoverage.length);assert.ok(k.reference.groupCoverage.every(g=>typeof g.research==='string'&&g.research.length>80));assert.ok(k.reference.researchChecklists.every(g=>g.check.length>=3));assert.match(k.instructions,/Estimation is allowed ONLY for price/);assert.match(k.instructions,/Currency conversions are estimates/);assert.match(k.instructions,/English/);}
 assert.match(C.kit('part-chassis-mounting','EUR').reference.groupCoverage[0].research,/motor pod kits/);
 assert.ok(C.kit().reference.researchChecklists.find(c=>c.partType==='Motor pod').check.includes('Exact included components / references'));
 assert.equal(C.kit().reference.pricing.currency,null);for(const v of ['',null,'CAD',{},'eur']){assert.throws(()=>P.currency(v),/Choose/);assert.throws(()=>C.kit(undefined,v),/Choose/);}
});
test('optional prices preserve legacy normalized products and accept labelled estimates and published evidence',()=>{
 const legacy=C.validateProduct(product(),0);assert.equal(Object.hasOwn(legacy.product,'price'),false);
 for(const p of [price(),price({status:'published',explanation:'Retail price, VAT included; shipping excluded.',sourceUrl:'https://example.com/m1',checkedDate:'2026-11-14'}),price({amount:0,basis:'piece'})]){const row=C.validateProduct(product({price:p}),0);assert.deepEqual(row.errors,[]);assert.deepEqual(row.product.price,p);assert.deepEqual(C.validateProduct(row.product,0).product,row.product);}
});
test('malformed price metadata cannot be imported or silently presented as published',()=>{
 const invalid=[null,[],1,price({amount:'24.5'}),price({amount:NaN}),price({amount:Infinity}),price({amount:-1}),price({amount:1000001}),price({currency:'CAD'}),price({basis:'box'}),price({status:'verified'}),price({explanation:''}),price({explanation:'x'.repeat(2001)}),price({status:'published'}),price({sourceUrl:'javascript:alert(1)'}),price({sourceUrl:'https://name:secret@example.com'}),price({checkedDate:'2026-02-30'}),price({checkedDate:'2026-13-01'}),price({quantity:100})];
 for(const p of invalid){const r=C.validateProduct(product({price:p}),0);assert.ok(r.errors.length,JSON.stringify(p));const s=new Store();assert.throws(()=>act(s,'catalogue.apply',{input:input([product({price:p})]),selections:[{index:0,create:true}],confirmed:true}));assert.equal(s.data.parts.length,0);}
});
test('price updates preserve inventory and linked setup data; legacy metadata still migrates',()=>{
 const s=new Store();const id=act(s,'part.save',{data:{name:'Personal motor',maker:'Example',reference:'M1',quantity:4,tracking:'quantity',notes:'Keep'}});
 const car=act(s,'car.save',{data:{name:'Price test car'}});act(s,'part.install',{partId:id,carId:car,field:'motor',quantity:1});act(s,'setup.save',{carId:car,name:'Original setup'});
 const before=structuredClone(s.data.parts.find(p=>p.id===id)),setups=structuredClone(s.data.setups),installations=structuredClone(s.data.installations),cars=structuredClone(s.data.cars);
 act(s,'catalogue.apply',{input:input([product({price:price()})]),selections:[{index:0,targetId:id}],confirmed:true});
 const after=s.data.parts.find(p=>p.id===id);for(const key of Object.keys(before))if(!['updated','catalogue'].includes(key))assert.deepEqual(after[key],before[key],key);
 assert.deepEqual(s.data.setups,setups);assert.deepEqual(s.data.installations,installations);assert.deepEqual(s.data.cars,cars);assert.deepEqual(migrate(s.data).parts.find(p=>p.id===id).catalogue.product.price,price());
 const legacy=new Store();act(legacy,'catalogue.apply',{input:input([product()]),selections:[{index:0,create:true}],confirmed:true});assert.equal(Object.hasOwn(migrate(legacy.data).parts[0].catalogue.product,'price'),false);
});
test('price and currency differences remain conflicts in combined files',()=>{
 const file=(name,p)=>({name,input:input([product({price:p})])});
 assert.equal(B.combine([file('a',price()),file('b',price())]).collapsed,1);
 for(const change of [{amount:25},{currency:'GBP'},{basis:'piece'}])assert.equal(B.combine([file('a',price()),file('b',price(change))]).conflicts.length,1);
});
test('parts and supplies retain prices across SQLite restart and deferred catalogue updates',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-prices-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'collection.sqlite'),s=new Store(file);
 const pack=input([product({price:price()}),product({kind:'supply',name:'Oil',reference:'O1',category:'Cleaning & lubrication',partType:'Bearing oil',supplyKind:'Consumable',price:price({amount:5,basis:'item'})})]);
 act(s,'catalogue.apply',{input:pack,selections:[{index:0,create:true},{index:1,create:true}],confirmed:true});
 const reopened=new Store(file,{deferred:true}),id=s.data.parts[0].id;
 await reopened.mutateAsync('catalogue.apply',{revision:reopened.data.revision,input:input([product({price:price({amount:27})})]),selections:[{index:0,targetId:id}],confirmed:true},{snapshot:false});
 const final=new Store(file);assert.equal(final.data.parts[0].catalogue.product.price.amount,27);assert.equal(final.data.supplies[0].catalogue.product.price.amount,5);assert.equal(final.data.parts[0].quantity,0);assert.equal(final.data.supplies[0].quantity,0);
});
