'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{shell}=require('electron');
module.exports=async({win,store,js,wait,click,qa})=>{
 const opened=[],original=shell.openExternal;let fail=false;
 shell.openExternal=async url=>{if(fail)throw Error('Browser could not be opened.');opened.push(url);};
 try{
  const ids=[store.mutate('car.save',{data:{name:'Owned BMW',maker:'Sideways',marque:'BMW',model:'M1',reference:'SW85',privateNotes:'Never send this'}}).result,store.mutate('car.save',{data:{name:'Wanted vintage car',collectionStatus:'wishlist'}}).result],before=store.snapshot();
  for(let i=0;i<ids.length;i++){
   await js(`wishlistUi=true;page='Cars';carId=${JSON.stringify(ids[i])};section='Overview';loadView()`);await wait('!viewPendingKey&&!!document.querySelector("[data-action=google-car]")');
   assert.equal(await js('document.querySelector("[data-action=google-car]").textContent.trim()'),'Google');
   await click('[data-action="google-car"]');assert.equal(opened.at(-1),i?'https://www.google.com/search?q=Wanted+vintage+car':'https://www.google.com/search?q=Sideways+BMW+M1+SW85');
   assert.equal(await js('carId'),ids[i]);assert.equal(await js('document.querySelector("#dialog").open'),false);
   win.setSize(i?960:1440,i?760:980);await js(`applyTheme({...db.settings,theme:${JSON.stringify(i?'light':'dark')}})`);await new Promise(r=>setTimeout(r,350));
   assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);assert.ok(await js('(()=>{const r=document.querySelector("[data-action=google-car]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()'));
   fs.writeFileSync(path.join(qa,i?'car-google-wishlist-light.png':'car-google-owned-dark.png'),(await win.webContents.capturePage()).toPNG());
  }
  fail=true;await click('[data-action="google-car"]');assert.ok(await js('document.querySelector("#toast").textContent.includes("Browser could not be opened")'));assert.equal(opened.length,2);
  assert.deepEqual(store.snapshot(),before);return ['Owned and Wishlist Google buttons open the exact search through Electron’s default-browser launcher','Display-name fallback, browser failure feedback, light/dark narrow layouts, no database changes or Review items'];
 }finally{shell.openExternal=original;}
};
