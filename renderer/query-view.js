'use strict';
// One active page, no collection-sized renderer cache. Legacy multi-record
// editors request their working context explicitly and release it on close.
let viewOffset=0,viewSequence=0,viewPendingKey='',viewFilterKey='',viewTimer=null,reviewHistory=false,closedJobs=false;
const detailOffsets={reminders:0,partHistory:0};
function desiredView(){
 if(db)libraryContext();
 const request={page,historyView:page==='Cars'&&section==='Performance'&&!!window.slotforge.historyView,partsTab:page==='Parts'?partsTab:null,stockScope:page==='Parts'?stockScope:null,partId:page==='Parts'?partId:null,partCategory:page==='Parts'?partCategory:null,partType:page==='Parts'?partTypeFilter:null,partQuery:page==='Parts'?partQuery:null,carId:page==='Cars'?carId:null,section:page==='Cars'&&carId?section:null,sessionOffset:page==='Cars'&&section==='Performance'?timingListPage*10:0,reviewTab:page==='Review'?(reviewTab==='Car merges'?'Incoming cars':reviewTab):null,reviewHistory:page==='Review'&&reviewTab==='Club changes'?reviewHistory:false,query,usage:[...usage],matchAll,archived,sort,sortDirection};
 if(page==='Showroom')request.showroom={query:showroom.query,usage:showroom.usage,favourites:showroom.favourites,sort:showroom.sort,shelf:showroom.shelf,viewerId:showroom.viewer?.id||''};
 if(page==='Library')Object.assign(request,{libraryTab,catalogue:{query:catalogueManagerQuery,category:catalogueManagerCategory,maker:catalogueManagerMaker,scope:catalogueManagerScope}});
 if(page==='Workshop'&&toolboxTab==='Manuals and Part Guides')request.guides={query:guideQuery,carId:guideCar};
 if(page==='Workshop')Object.assign(request,{toolboxTab,jobId:workshopJob?.job.id||'',jobCategory,closedJobs,recentWorkLimit,supply:{query:supplyQuery,category:supplyCategory,archived:supplyArchived,low:supplyLow}});
 if(page==='Build from Scratch'||page==='Parts'&&partsTab==='Build from Scratch'){ensureBuild();request.build={rebuildCarId:buildState.rebuild?.carId||'',types:buildSlotInfo()?.types||[],all:buildAll,query:buildSearch,partIds:buildState.parts.map(p=>p.partId),assemblyIds:buildState.assemblies.map(a=>a.id)};}
 const filter={...request,partId:null};if(filter.showroom)filter.showroom={...filter.showroom,viewerId:null};if(filter.build)filter.build={...filter.build,partIds:null,assemblyIds:null};
 const key=JSON.stringify(filter);if(key!==viewFilterKey){viewOffset=0;detailOffsets.reminders=0;detailOffsets.partHistory=0;viewFilterKey=key;}return {...request,offset:viewOffset,detailOffsets:{...detailOffsets}};
}
async function readScreen(){try{return await api('read',{queryView:db?._view?.editor?db._view.request:desiredView()});}catch(e){if(e.code!=='CAR_NOT_FOUND')throw e;return api('read',{queryView:{page:'Overview'}});}}
function viewKey(value){return JSON.stringify(value);}
function queryGate(){
 if(!local()||!db||!db._view||$('#dialog').open)return false;const request=desiredView(),key=viewKey(request);
 if(!db._view.editor&&viewKey(db._view?.request)===key)return false;
 if(viewPendingKey!==key)void loadView(request);return true;
}
async function loadView(request=desiredView(),token){
 if($('#dialog').open)return;
 const serial=++viewSequence,key=viewKey(request),origin=dataPath;viewPendingKey=key;$('#main').setAttribute('aria-busy','true');
 try{
  const result=await api('read',{queryView:{...request,...(token?{token}:{})}});
  if(serial!==viewSequence||!local()||origin!==dataPath||key!==viewKey(desiredView()))return;
  const info=result.data._view?.list||result.data._view?.history;if(info&&request.offset>0&&request.offset>=info.total){viewOffset=Math.max(0,Math.floor((info.total-1)/info.limit)*info.limit);return loadView();}
  for(const key of ['reminders','partHistory']){const detail=result.data._view?.[key];if(detail&&detail.offset>0&&detail.offset>=detail.total){detailOffsets[key]=Math.max(0,Math.floor((detail.total-1)/detail.limit)*detail.limit);return loadView();}}
  acceptSnapshot(result.data);net=result.network;clubState=result.club;collectionMeta=result.collection;dataPath=result.dataPath;viewPendingKey='';
  const buildScroller=$('.build-diagram-scroll'),buildPosition=buildScroller&&[buildScroller.scrollLeft,buildScroller.scrollTop];
  const active=document.activeElement,hotspot=active?.matches('.build-hotspot')?active.dataset.id:null,focus=['car-search','part-search','showroom-search','supply-search','build-stock-search','guide-search','catalogue-manager-search'].includes(active?.id)?{id:active.id,start:active.selectionStart,end:active.selectionEnd}:null,scroll=window.scrollY;
  render();
  if(buildPosition&&$('.build-diagram-scroll')){const el=$('.build-diagram-scroll');el.scrollLeft=buildPosition[0];el.scrollTop=buildPosition[1];}if(hotspot)document.querySelector('.build-hotspot[data-id="'+CSS.escape(hotspot)+'"]')?.focus({preventScroll:true});
  if(focus){const input=document.getElementById(focus.id);input?.focus({preventScroll:true});input?.setSelectionRange(focus.start,focus.end);}window.scrollTo(0,scroll);
 }catch(e){if(serial===viewSequence){if(e.code==='QUERY_CHANGED'){viewOffset=0;detailOffsets.reminders=0;detailOffsets.partHistory=0;toast('The collection changed. Showing the first page.');return loadView();}if(e.code==='CAR_NOT_FOUND'){carId=null;viewOffset=0;toast(e.message,true);return loadView();}toast(e.message,true);}}finally{if(serial===viewSequence){viewPendingKey='';$('#main').removeAttribute('aria-busy');}}
}
function scheduleView(){clearTimeout(viewTimer);viewTimer=setTimeout(()=>loadView(),120);}
function viewPager(info){if(!info||info.total<=info.limit)return '';return `<div class="actions mt query-pagination"><button class="btn" data-action="query-prev" data-id="${info.pager||''}" ${info.offset?'':'disabled'}>Previous</button><span>${info.offset+1}–${Math.min(info.total,info.offset+info.limit)} of ${info.total}</span><button class="btn" data-action="query-next" data-id="${info.pager||''}" ${info.nextOffset===null?'disabled':''}>Next</button></div>`;}
async function queryAction(action,id){
 if(action.startsWith('original-history-'))return false;
 if(action==='select-part')detailOffsets.partHistory=0;
 if(action==='query-closed-jobs'){closedJobs=!closedJobs;viewOffset=0;await loadView();return true;}
 if(db._view?.timing&&(action==='timing-list-prev'||action==='timing-list-next')){const token=db._view.token;timingListPage=Math.max(0,timingListPage+(action==='timing-list-next'?1:-1));await loadView(desiredView(),token);return true;}
 if(action==='query-review-history'){reviewHistory=!reviewHistory;viewOffset=0;await loadView();return true;}
 if(action==='query-next'||action==='query-prev'){const info=id?db._view?.[id]:db._view?.list||db._view?.history;if(info){const offset=action==='query-next'?info.nextOffset:Math.max(0,info.offset-info.limit);if(id)detailOffsets[id]=offset;else viewOffset=offset;await loadView(desiredView(),db._view.token);}return true;}
 const browsing=new Set(['merge-hub','merge-start','compare-pace','history-import-inspect','result-session','result-seen','result-open-car','background-mode','local-library-access','local-library-retry','car-compare-open','car-compare-edit','car-compare-differences','guide-open','open-document','export-document','catalogue-manager-open','catalogue-manager-select-page','catalogue-manager-clear','library-tab','nav','parts-tab','stock-scope','part-group','part-groups','select-part','open-car','back-cars','section','mode','usage','clear-selection','photo-fit','close-modal','open-review','review-tab','review-select','timing-session','timing-list-prev','timing-list-next','timing-laps-prev','timing-laps-next','lane-record','toolbox-tab','settings-section','library-section','jobs-back','recent-work-more','recent-work-less','showroom-open','showroom-play','showroom-close','showroom-car','showroom-fullscreen','showroom-next','showroom-prev','showroom-photo-next','showroom-photo-prev','showroom-toggle-play','showroom-filter','showroom-clear','showroom-presentation','presentation-toggle','build-slot','build-pick','build-remove','build-remove-assembly','build-gearing-reset','build-performance-reference','build-performance-clear']);
 if(local()&&browsing.has(action)&&!db._view)db._view={request:null};
 if(local()&&db._view&&!browsing.has(action)){clearTimeout(viewTimer);++viewSequence;viewPendingKey='';if(!$('#dialog').open||!db._view.editor||['build-load-draft','catalogue-product','test-snapshot','edit-part','edit-supply','reports'].includes(action)){const desired=desiredView(),key=viewKey(desired),origin=dataPath,databaseId=db.id,serial=viewSequence;const request={...desired,editor:{action,id,selected:[...selected],matchIds:action==='catalogue-product'?(catalogueReview?.preview.rows[Number(id)]?.matches||[]).map(m=>m.id):[]}};const result=await api('read',{queryView:request});if(serial!==viewSequence||origin!==dataPath||databaseId!==db.id||!local()||key!==viewKey(desiredView()))return true;acceptSnapshot(result.data);collectionMeta=result.collection;}}
 return false;
}

document.getElementById('dialog').addEventListener('close',()=>{setTimeout(()=>{if(!$('#dialog').open){paceState=null;render();if(pendingDatabaseChange)scheduleDatabaseChange();}},0);});
