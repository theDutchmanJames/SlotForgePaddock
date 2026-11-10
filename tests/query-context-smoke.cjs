const assert=require('node:assert/strict'),{initial}=require('../src/store.cjs');
module.exports=async({store,js,wait,click,fill,submit})=>{
 const saved=store.snapshot(),checks=[];
 const idle=()=>wait('!viewPendingKey&&!actionBusy&&!modalSaving');
 try{
  store.replace(initial());store.mutate('car.save',{data:{name:'Seed'}});store.mutate('part.save',{data:{name:'Motor',category:'Motors & motor parts',partType:'Motor',tracking:'quantity',quantity:5}});
  store.transact(db=>{const c=db.cars[0],p=db.parts[0];db.events=[];db.cars=Array.from({length:125},(_,i)=>({...c,id:'context-car-'+i,name:'Context car '+String(i).padStart(3,'0')}));db.parts=Array.from({length:125},(_,i)=>({...p,id:'context-part-'+i,name:'Context motor '+String(i).padStart(3,'0')}));});
  await js("(async()=>{switchCollection('local');page='Showroom';showroom.context=showroomKey();showroom.query='';showroom.shelf='';showroom.favourites=false;await loadView();})()");
  assert.equal(await js('document.querySelectorAll(".showroom-card").length'),48);await click('[data-action="query-next"]');await idle();assert.equal(await js('db._view.list.offset'),48);
  await click('[data-action="showroom-open"][data-id="context-car-95"]');await idle();assert.equal(await js('showroom.viewer.id'),'context-car-95');
  await click('[data-action="showroom-next"]');await idle();assert.equal(await js('showroom.viewer.id'),'context-car-96');assert.equal(await js('document.querySelector("#showroom-viewer h2").textContent'),'Context car 096');await click('[data-action="showroom-close"]');
  checks.push('showroom pages and viewer navigation cross page boundaries');
  await click('[data-action="nav"][data-id="Workshop"]');await idle();await click('[data-action="new-job"]');assert.equal(await js('document.querySelectorAll("#job-car option").length'),125);await fill({carId:'context-car-124',name:'Last car job',notes:'Instructions'});await submit();await idle();assert.equal(store.data.jobs[0].carId,'context-car-124');assert.equal(await js('db.cars.length'),1);
  await click('[data-action="job-plan"]');await fill({priority:'High'});await submit();await idle();assert.equal(store.data.planning.jobs[0].priority,'High');checks.push('job creation selects any car and opens a scoped job plan editor');
  await click('[data-action="nav"][data-id="Parts"]');await idle();await click('[data-action="nav"][data-id="Build from Scratch"]');await idle();assert.equal(await js('document.querySelectorAll(".build-stock-item").length'),40);
  await js("document.querySelector('#build-stock-search').value='124';document.querySelector('#build-stock-search').dispatchEvent(new Event('input',{bubbles:true}))");await wait('db._view?.list?.total===1&&!viewPendingKey');await click('[data-action="build-pick"]');await idle();assert.equal(await js('buildState.parts[0].partId'),'context-part-124');
  await js("document.querySelector('[data-build-value=name]').value='Query build';document.querySelector('[data-build-value=name]').dispatchEvent(new Event('input',{bubbles:true}))");await click('[data-action="build-save-draft"]');await idle();assert.equal(store.data.buildDrafts[0].data.name,'Query build');await click('[data-action="build-review"]');await wait('document.querySelector("#dialog").open');await js("document.querySelector('[name=confirmed]').checked=true");await submit();await idle();assert.ok(store.data.cars.some(c=>c.name==='Query build'));assert.ok(store.data.installations.some(i=>i.partId==='context-part-124'));checks.push('scratch building searches beyond page one, saves a draft and installs selected stock');
  for(const name of ['Settings','Library','Connections','Import & Export']){await click(`[data-action="nav"][data-id="${name}"]`);await idle();assert.equal(await js('db.parts.length'),0);assert.equal(await js('db.cars.length'),0);assert.equal(await js('db.timing.sessions.length'),0);}
  checks.push('settings, library, connections and exchange render without collection records');
  return checks;
 }finally{await js("document.querySelector('#dialog').close();closeShowroom();workshopJob=null;buildState=null");store.replace(saved);await js("(async()=>{page='Overview';carId=null;query='';await loadView();})()");}
};
