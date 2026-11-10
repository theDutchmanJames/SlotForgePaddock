const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initial}=require('../src/store.cjs');
const product=(extra={})=>({kind:'part',name:'Review motor',manufacturer:'Review Racing',reference:'R1',category:'Motors & motor parts',partType:'Motor',supplyKind:'',packSize:1,packUnit:'piece',packDescription:'',sourceUrl:'https://example.com/motor',checkedDate:'2026-10-31',reviewNotes:'',specifications:[],...extra});
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
  const checks=[],failures=[];store.data=initial();store.persist(store.data);
  const act=(a,p)=>store.mutate(a,{revision:store.data.revision,...p}).result;
  const review=async products=>{
    await js(`(async()=>{document.querySelector('#dialog').close();const r=await api('read');db=r.data;collectionMeta=r.collection;switchCollection('local');const input=${JSON.stringify({format:'slotforge-catalogue',version:1,products})};catalogueReview={input,name:'review-regressions.json',databaseId:db.id,active:true,preview:await api('plan','catalogue.preview',{input})};catalogueSelected=new Set();catalogueDecisions=new Map();catalogueOpen=new Set(catalogueReview.preview.rows.map(catalogueGroup));catalogueQuery='';catalogueStatus='';page='Import & Export';render();})()`);
  };
  const run=async(name,fn)=>{try{await fn();checks.push(name);}catch(e){failures.push({name,error:e.message});}};
  await run('malformed catalogue categories remain reviewable and can be corrected',async()=>{
    await review([product({category:'__proto__'})]);await js('catalogueProductDialog(0)');assert.equal(await js(`document.querySelector('#dialog').open`),true);
    await js(`document.querySelector('#catalogue-category').value='Motors & motor parts';document.querySelector('#catalogue-category').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#catalogue-type').value='Motor'`);await submit();assert.equal(await js('catalogueReview.preview.rows[0].status'),'new');
  });
  await run('select-all respects a product explicitly left unresolved',async()=>{
    await review([product()]);await click('[data-action="catalogue-product"]');await fill({decision:''});await submit();
    assert.equal(await js('catalogueChoice(catalogueReview.preview.rows[0])'),null);await click('[data-action="catalogue-select-new"]');assert.equal(await js('catalogueSelected.size'),0);
  });
  await run('refreshing catalogue matches clears a selection whose destination changed',async()=>{
    const id=act('part.save',{data:{name:'Existing lot',maker:'Review Racing',reference:'R1',quantity:0,tracking:'quantity'}});
    await review([product()]);assert.equal(await js('catalogueReview.preview.rows[0].status'),'update');await js('catalogueSelected.add(0)');act('part.delete',{id});
    await click('[data-action="catalogue-refresh"]');assert.equal(await js('catalogueReview.preview.rows[0].status'),'new');assert.equal(await js('catalogueSelected.size'),0);
  });
  await run('changing a diagram position keeps the current zoomed viewport',async()=>{
    await js(`(async()=>{page='Build from Scratch';buildContext='';buildZoom=3;await loadView();const scroller=document.querySelector('.build-diagram-scroll');scroller.scrollTop=180;scroller.scrollLeft=130;})()`);
    const before=await js(`[document.querySelector('.build-diagram-scroll').scrollTop,document.querySelector('.build-diagram-scroll').scrollLeft]`);assert.ok(before.every(n=>n>0));
    await click('.build-hotspot[data-id="pod"]');await wait('!viewPendingKey');assert.deepEqual(await js(`[document.querySelector('.build-diagram-scroll').scrollTop,document.querySelector('.build-diagram-scroll').scrollLeft]`),before);
  });
  await run('typing while a draft save completes remains marked as unsaved',async()=>{
    await js(`buildContext='';buildZoom=1;render();buildState.name='Before saving';markBuildDirty();window.reviewOriginalApi=api;api=async(...args)=>{const result=await window.reviewOriginalApi(...args);if(args[0]==='mutate'&&args[1]==='build.draft.save')await new Promise(resolve=>window.reviewReleaseSave=resolve);return result;};window.reviewSavePromise=buildAction('build-save-draft');void 0;`);
    try{await wait('!!window.reviewReleaseSave');await js(`buildState.name='Typed while saving';markBuildDirty();window.reviewReleaseSave();`);await js('window.reviewSavePromise');assert.equal(store.data.buildDrafts[0].data.name,'Before saving');assert.equal(await js('buildState.name'),'Typed while saving');assert.equal(await js('buildDirty'),true);}finally{await js('api=window.reviewOriginalApi;delete window.reviewReleaseSave;delete window.reviewSavePromise;delete window.reviewOriginalApi;');}
  });
  await run('contour colours follow the light or dark tone of every theme',async()=>{
    await js(`buildSlot='motor';db.settings.theme='dark';render()`);const expected=await js(`getComputedStyle(document.querySelector('#build-outline-motor feFlood')).floodColor`);
    for(const theme of ['midnight','forest','sunset','violet','carbon','custom']){await js(`db.settings.theme='${theme}';render()`);assert.equal(await js(`getComputedStyle(document.querySelector('#build-outline-motor feFlood')).floodColor`),expected,theme);}
    await js(`db.settings.theme='light';render()`);assert.notEqual(await js(`getComputedStyle(document.querySelector('#build-outline-motor feFlood')).floodColor`),expected);
  });
  await js(`db.settings.theme='dark';buildZoom=1;buildContext='';catalogueReview=null;catalogueSelected.clear();page='Overview';render()`);
  fs.writeFileSync(path.join(qa,'new-additions-review-result.json'),JSON.stringify({passed:!failures.length,checks,failures},null,2));
  assert.deepEqual(failures,[]);return checks;
};
