'use strict';
const fs=require('node:fs'),path=require('node:path');
const {dialog,shell}=require('electron');
// Audit sweep: on a seeded test collection, visit every page and every car section, click every button that is
// on screen, and inside each window that opens click its buttons too. Records renderer errors, error toasts and
// failed clicks per button, and screenshots each page. File dialogs and links to the outside are stubbed.
// Writes .qa/audit-sweep.json; does not fail on findings (they are reviewed by hand).
module.exports=async({win,store,js,qa})=>{
 const out=path.join(qa,'audit');fs.mkdirSync(out,{recursive:true});
 const restore={open:dialog.showOpenDialog,save:dialog.showSaveDialog,box:dialog.showMessageBox,ext:shell.openExternal,path:shell.openPath,show:shell.showItemInFolder};
 dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});dialog.showSaveDialog=async()=>({canceled:true});dialog.showMessageBox=async()=>({response:1});shell.openExternal=async()=>{};shell.openPath=async()=>'';shell.showItemInFolder=()=>{};
 const findings=[],log=[];let current='';
 const onConsole=(e,level,message)=>{const lvl=typeof e?.level==='string'?e.level:level,msg=typeof e?.message==='string'?e.message:message;if(lvl==='error'||lvl===3)findings.push({where:current,kind:'console',message:String(msg).slice(0,400)});};
 win.webContents.on('console-message',onConsole);
 await js(`window.addEventListener('unhandledrejection',e=>console.error('Unhandled rejection: '+(e.reason?.stack||e.reason)));window.addEventListener('error',e=>console.error('Uncaught: '+(e.error?.stack||e.message)))`);
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const idle=async(limit=60)=>{for(let i=0;i<limit;i++){if(await js('!actionBusy&&!viewPendingKey&&!modalSaving'))return true;await sleep(60);}return false;};
 const shot=async name=>{try{win.webContents.invalidate();await sleep(250);fs.writeFileSync(path.join(out,name.replace(/[^a-z0-9-]+/gi,'_').slice(0,80)+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());}catch{}};
 const toast=()=>js(`(()=>{const t=document.querySelector('#toast');return t&&!t.hidden&&getComputedStyle(t).display!=='none'?t.textContent.trim():''})()`);
 const closeAll=()=>js(`(()=>{for(let i=0;i<4;i++){const d=document.querySelector('#dialog');if(d?.open)d.close();}document.querySelectorAll('#car-more-menu,#ss-pop,#sheet-field-pop').forEach(x=>x.remove());document.querySelectorAll('dialog[open]').forEach(d=>d.close());if(typeof closeCarMore==='function')closeCarMore();})()`);
 // Seed a varied collection.
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result;
 const image='data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
 const cars=[act('car.save',{data:{name:'Sweep Porsche 962',maker:'Slot.it',scale:'1:32',number:'7',raceClass:'Group C',usage:['Club racing'],location:'Shelf 1',price:'85',currency:'EUR',picture:image,technical:{motor:'V12/6 21.5K',pinion:'11',gear:'32',weight:'74',rearTyres:'P6'},realHistory:{classification:'Real Racing Car',team:'Sweep team',drivers:'A. B, C. D',sources:[{title:'Results',url:'https://example.com'}]}}}),act('car.save',{data:{name:'Sweep BMW Z4',maker:'NSR',scale:'1:32',technical:{motor:'King'}}}),act('car.save',{data:{name:'Sweep wish',collectionStatus:'wishlist'}}),act('car.save',{data:{name:'Sweep archived',archived:true}})];
 const part=act('part.save',{data:{name:'Sweep motor',maker:'NSR',reference:'3042',partType:'Motor',category:'Motors & motor parts',quantity:2,tracking:'quantity'}});
 act('supply.save',{data:{name:'Sweep oil',maker:'NSR',kind:'Consumable',category:'Cleaning & lubrication',partType:'Bearing oil',quantity:1}});
 act('setup.save',{carId:cars[0],name:'Sweep setup',technical:{motor:'V12/6'}});
 act('test.add',{carId:cars[0],track:'Sweep track',lane:'2',best:'5.4',laps:'10'});
 act('job.start',{carId:cars[1],kind:'general',name:'Sweep job'});
 act('planning.shelf.save',{name:'Sweep group',carIds:[cars[0],cars[1]]});
 act('work.add',{carId:cars[0],title:'Sweep work',performedDate:'2026-11-01',category:'maintenance',type:'maintenance'});
 await js(`(async()=>{acceptSnapshot((await api('read')).data);render()})()`);await idle();
 const skip=/delete|discard|remove|reset|wipe|erase|purge|quit|relaunch|restart|reload|club-|host|dealership|connect|disconnect|portal|share-start|sharing|network|net-|update-install|install-update|backup-restore|restore-backup|library-move|move-library|sign-out|logout|close-modal|nav$|^nav|section$|^section|database-select|theme|ui-scale|zoom|fullscreen|presentation|showroom-play|showroom-viewer|kiosk/i;
 const buttons=scope=>js(`[...document.querySelectorAll(${JSON.stringify(scope)}+' [data-action]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&!b.disabled&&!b.closest('[hidden]')}).map((b,i)=>({action:b.dataset.action,id:b.dataset.id||'',label:(b.textContent||b.getAttribute('aria-label')||'').trim().slice(0,50),key:b.dataset.action+'|'+(b.dataset.id||'')+'|'+i}))`);
 const press=async(scope,b)=>js(`(()=>{const list=[...document.querySelectorAll(${JSON.stringify(scope)}+' [data-action]')].filter(x=>x.dataset.action===${JSON.stringify(b.action)}&&(x.dataset.id||'')===${JSON.stringify(b.id)});const el=list[0];if(!el)return false;el.click();return true;})()`);
 const goto=async(page,carId='',section='')=>{await closeAll();await js(`(async()=>{source='local';page=${JSON.stringify(page)};carId=${JSON.stringify(carId)}||null;${section?`section=${JSON.stringify(section)};`:''}await loadView()})()`);await idle(100);};
 const pages=await js(`[...document.querySelectorAll('[data-action="nav"]')].map(b=>b.dataset.id)`);
 const targets=[...pages.map(p=>({page:p})),...['Overview','Identity & ownership','Technical & parts','Real Car History','Setups','Maintenance','Performance','Photos & documents','History'].map(s=>({page:'Cars',carId:cars[0],section:s})),{page:'Cars',carId:cars[2],section:'Overview'},{page:'Cars',carId:cars[3],section:'Overview'}];
 const seen=new Set();
 for(const t of targets){
  const where=t.carId?`car:${t.section}`+(t.carId!==cars[0]?':'+t.carId.slice(0,4):''):t.page;current=where;
  try{await goto(t.page,t.carId,t.section);}catch(e){findings.push({where,kind:'navigate',message:e.message.slice(0,300)});continue;}
  await shot('page-'+where);
  const list=(await buttons('#main')).filter(b=>!skip.test(b.action));
  for(const b of list){
   const key=where+'|'+b.action+'|'+b.id;if(seen.has(b.action+'|'+(t.carId?'car':''))&&!t.carId&&seen.has(key))continue;seen.add(key);
   current=where+' → '+b.action+(b.label?` (${b.label})`:'');
   try{
    if(!(await press('#main',b)))continue;
    await sleep(120);const settled=await idle(80);
    if(!settled)findings.push({where:current,kind:'stuck',message:'Still busy after 5 s'});
    const opened=await js('document.querySelector("#dialog")?.open||!!document.querySelector("#car-more-menu")');
    const msg=await toast();if(msg&&/error|fail|cannot|not defined|undefined|invalid|unexpected|null/i.test(msg))findings.push({where:current,kind:'toast',message:msg});
    const formError=await js(`(()=>{const e=document.querySelector('#form-error');return e&&!e.hidden?e.textContent.trim():''})()`);if(formError)findings.push({where:current,kind:'form-error',message:formError});
    log.push({where:current,opened});
    if(opened){
     const title=await js('document.querySelector("#dialog h2")?.textContent||"menu"');
     const shotKey='win-'+title;if(!seen.has(shotKey)){seen.add(shotKey);await shot(shotKey);}
     // One level into the window: click its own buttons (not submit/close/destructive).
     const inner=(await buttons('#dialog')).filter(x=>!skip.test(x.action)).slice(0,25);
     for(const x of inner){
      const ik=title+'|'+x.action+'|'+x.id;if(seen.has(ik))continue;seen.add(ik);
      current=where+' → '+b.action+' → '+title+' → '+x.action+(x.label?` (${x.label})`:'');
      try{if(!(await js('document.querySelector("#dialog")?.open')))break;await press('#dialog',x);await sleep(120);if(!(await idle(80)))findings.push({where:current,kind:'stuck',message:'Still busy after 5 s'});const m=await toast();if(m&&/error|fail|cannot|not defined|undefined|invalid|unexpected|null/i.test(m))findings.push({where:current,kind:'toast',message:m});const fe=await js(`(()=>{const e=document.querySelector('#form-error');return e&&!e.hidden?e.textContent.trim():''})()`);if(fe)findings.push({where:current,kind:'form-error',message:fe});}catch(e){findings.push({where:current,kind:'exception',message:e.message.slice(0,300)});}
     }
    }
   }catch(e){findings.push({where:current,kind:'exception',message:e.message.slice(0,300)});}
   await closeAll();
   // Return to the same place for the next button.
   try{const still=await js(`page===${JSON.stringify(t.page)}&&(carId||'')===${JSON.stringify(t.carId||'')}${t.section?`&&section===${JSON.stringify(t.section)}`:''}`);if(!still)await goto(t.page,t.carId,t.section);}catch(e){findings.push({where,kind:'navigate',message:e.message.slice(0,300)});}
  }
 }
 // An empty collection: every page should still render.
 store.replace(require('../src/store.cjs').initial());await js(`(async()=>{acceptSnapshot((await api('read')).data);render()})()`);await idle();
 for(const p of pages){current='empty:'+p;try{await goto(p);await shot('empty-'+p);}catch(e){findings.push({where:current,kind:'navigate',message:e.message.slice(0,300)});}}
 win.webContents.removeListener('console-message',onConsole);
 Object.assign(dialog,{showOpenDialog:restore.open,showSaveDialog:restore.save,showMessageBox:restore.box});Object.assign(shell,{openExternal:restore.ext,openPath:restore.path,showItemInFolder:restore.show});
 fs.writeFileSync(path.join(qa,'audit-sweep.json'),JSON.stringify({clicks:log.length,windows:log.filter(x=>x.opened).length,findings},null,1));
 return [`${log.length} clicks, ${log.filter(x=>x.opened).length} opened a window or menu, ${findings.length} findings`];
};
