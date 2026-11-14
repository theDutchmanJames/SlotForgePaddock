'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({store,js,wait,click,qa})=>{
 const id=store.mutate('part.save',{data:{name:'Benchmark motor',maker:'NSR',reference:'BENCH',quantity:0,tracking:'quantity'}}).result;
 const line=store.mutate('planning.shopping.add',{revision:store.data.revision,partId:id,quantity:1}).result;
 store.transact(db=>{const p=db.parts[0],l=db.planning.shopping[0];for(let i=0;i<3000;i++)db.parts.push({...p,id:'catalogue-'+i,name:'Catalogue part '+i,reference:'REF'+i});for(let i=0;i<199;i++)db.planning.shopping.push({...JSON.parse(JSON.stringify(l)),id:'shopping-'+i,partId:'catalogue-'+i,purchase:{...JSON.parse(JSON.stringify(l.purchase)),item:{kind:'part',id:'catalogue-'+i}}});});
 await js(`(async()=>{page='Shopping List';source='local';await loadView()})()`);await wait('!viewPendingKey');
 await js(`document.querySelector('[name=finderQuery]').value='BENCH';document.querySelector('[name=finderQuery]').dispatchEvent(new Event('input',{bubbles:true}))`);await wait(`!!document.querySelector('[data-action="shop-quick-add"][data-id="${id}"]')`);
 await js(`window.shoppingPerformanceCalls=[];window.originalShoppingApi=api;api=async function(method,...args){const start=performance.now(),revision=db.revision,filters=args[0]?.queryView?.shoppingFinder;try{return await originalShoppingApi(method,...args);}finally{shoppingPerformanceCalls.push({method,revision,filters,action:method==='mutate'?args[0]:args[0]?.queryView?.editor?.action||'',finder:!!args[0]?.queryView?.shoppingFinder,ms:Math.round(performance.now()-start)});}};true`);
 const phases=[],originalMutate=store.mutateAsync,views=require('../src/view-query.cjs'),originalView=views.view;
 store.mutateAsync=async function(...args){const t=performance.now();try{return await originalMutate.apply(this,args);}finally{phases.push({phase:'database command',ms:Math.round(performance.now()-t)});}};
 views.view=function(...args){const t=performance.now();try{return originalView(...args);}finally{phases.push({phase:'screen projection',ms:Math.round(performance.now()-t)});}};
 const sample=async(selector)=>{await js('shoppingPerformanceCalls=[]');phases.length=0;const start=performance.now();await click(selector);await new Promise(r=>setTimeout(r,250));return {wallMs:Math.round(performance.now()-start-250),calls:await js('shoppingPerformanceCalls'),phases:[...phases]};};
 const add=await sample('[data-action="shop-quick-add"][data-id="'+id+'"]');assert.equal(store.data.planning.shopping.length,201);
 const newest=store.data.planning.shopping.at(-1).id;const remove=await sample('[data-action="shop-delete"][data-id="'+newest+'"]');assert.equal(store.data.planning.shopping.at(-1).purchase.checklist.deleted,true);
 for(const sample of [add,remove])assert.ok(!sample.calls.some(c=>c.method==='read'&&c.action.startsWith('shop-')),'Immediate shopping actions must not request an editor context');
 for(const sample of [add,remove])assert.ok(sample.calls.filter(c=>c.finder).length<=1,'A save must not launch a queued stale search followed by a duplicate refresh');
 assert.equal(store.lastWrite.recordWrites,2,'Delete changes its shopping row and collection revision only');
 // Deleting the last visible row must return to the preceding page. Adding
 // from that page must still show the new item immediately on the first page.
 await js(`(async()=>{viewOffset=180;await loadView()})()`);await wait('!viewPendingKey');
 for(let i=0;i<20;i++)await click('[data-action="shop-delete"]');
 await wait('viewOffset===150&&!viewPendingKey');assert.ok(await js('document.querySelectorAll("[data-shopping-row]").length>0'));
 await wait(`!!document.querySelector('[data-action="shop-quick-add"][data-id="${id}"]')`);await click('[data-action="shop-quick-add"][data-id="'+id+'"]');await wait('viewOffset===0&&!viewPendingKey');
 assert.equal(await js('document.querySelector("[data-shopping-row]").dataset.shoppingRow'),store.data.planning.shopping.at(-1).id);
 store.mutateAsync=originalMutate;views.view=originalView;await js('api=originalShoppingApi;true');const report={parts:3001,shoppingRows:200,add,remove};fs.writeFileSync(path.join(qa,process.env.SHOPPING_PERF_FILE||'shopping-performance.json'),JSON.stringify(report,null,2));return report;
};

