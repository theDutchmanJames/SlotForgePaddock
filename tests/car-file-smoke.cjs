'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async ctx=>{
 const {win,store,js,wait,click,submit,qa,dialog}=ctx;
 const checks=await require('./timing-export-smoke.cjs')(ctx);
 const wish=store.mutate('car.save',{data:{name:'Export Wishlist QA',collectionStatus:'wishlist',maker:'NSR'}}).result;
 const prev=dialog.showSaveDialog,prevOpen=dialog.showOpenDialog,file=path.join(qa,'wishlist-export-ui.json');
 try{
  dialog.showSaveDialog=async()=>({canceled:false,filePath:file});
  await js('page="Cars";carId=null;switchCarScope("wishlist");render()');await wait('!viewPendingKey');
  await click('[data-action="nav"][data-id="Import & Export"]');await wait('!viewPendingKey');
  await click('[data-action="choose-export-cars"]');await wait('!viewPendingKey');assert.equal(await js('carScope'),'collection');assert.ok(await js('document.body.textContent.includes("Choose cars to export")'));
  await click('[data-action="cars-tab"][data-id="wishlist"]');await wait('!viewPendingKey');
  await click('[data-select-car="'+wish+'"]');await wait('!!document.querySelector("[data-action=export-selected]")');await click('[data-action="export-selected"]');
  assert.equal(await js('document.querySelector("#car-export-format").options.length'),1);assert.ok(await js('document.querySelector("#dialog").textContent.includes("Wishlist entries stay on Wishlist")'));
  await new Promise(resolve=>setTimeout(resolve,500));
  fs.writeFileSync(path.join(qa,'wishlist-export-dialog.png'),(await win.webContents.capturePage()).toPNG());
  await submit();let out=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(out.version,2);assert.equal(out.cars[0].collectionStatus,'wishlist');
  await click('[data-action="open-car"][data-id="'+wish+'"]');await wait('!viewPendingKey');await click('[data-action="car-more"]');await click('[data-action="export-car"]');assert.equal(await js('document.querySelector("#car-export-format").options.length'),1);await submit();
  // A new source identity exercises the actual file importer and Review UI.
  out.packageId='wishlist-ui-import';out.cars[0].id='wishlist-ui-new-car';fs.writeFileSync(file,JSON.stringify(out));dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
  await click('[data-action="nav"][data-id="Import & Export"]');await wait('!viewPendingKey');await click('[data-action="import"]');await wait('document.body.textContent.includes("Destination: Wishlist")');
  await click('[data-action="accept-review"]');await wait('!actionBusy');assert.equal(store.data.cars.find(c=>c.id==='wishlist-ui-new-car').collectionStatus,'wishlist');assert.equal(store.data.cars.find(c=>c.id==='wishlist-ui-new-car').ownership,'Wanted');
  checks.push('Choose cars starts My Cars with export instructions; Wishlist selection and More export work','Wishlist format preserves membership and omits Timing export','Actual JSON import and Review create a Wishlist car without purchasing it');
 }finally{dialog.showSaveDialog=prev;dialog.showOpenDialog=prevOpen;}
 return checks;
};
