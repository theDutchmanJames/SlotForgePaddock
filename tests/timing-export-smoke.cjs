const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({win,store,js,wait,click,fill,submit,qa,dialog})=>{
  const id=store.mutate('car.save',{data:{name:'Export smoke car',maker:'NSR',raceClass:'GT3',technical:{rearTyres:'Rear QA',frontTyres:'Front QA',pinion:'9',gear:'27'}}}).result;
  await js(`(async()=>{const r=await api('read');db=r.data;net=r.network;source='local';carId=${JSON.stringify(id)};page='Cars';section='Overview';render();})()`);
  const previous=dialog.showSaveDialog,file=path.join(qa,'timing-export-ui.json');let saveOptions;
  try{
    dialog.showSaveDialog=async(_win,options)=>{saveOptions=options;return {canceled:false,filePath:file};};
    await click('[data-action="car-more"]');await click('[data-action="export-car"]');
    assert.equal(await js(`document.querySelector('#car-export-format').value`),'paddock');
    await js(`const select=document.querySelector('#car-export-format');select.value='timing';select.dispatchEvent(new Event('change',{bubbles:true}));`);
    assert.equal(await js(`document.querySelector('[name="setups"]').disabled`),true);assert.equal(await js(`document.querySelector('#car-export-timing').hidden`),false);
    fs.writeFileSync(path.join(qa,'timing-export-dialog.png'),(await win.webContents.capturePage()).toPNG());
    await submit();const out=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(out.format,'slotforge-timing-export');assert.equal(out.items.slotcars[0].tyres,'Rear QA');assert.equal(out.items.slotcars[0].gearing,'9/27');assert.equal(saveOptions.defaultPath,'slotforge-timing-export.json');
    const second=store.mutate('car.save',{data:{name:'Second export car'}}).result;
    await js(`(async()=>{db=(await api('read')).data;selected=new Set(${JSON.stringify([id,second])});carId=null;page='Cars';render();})()`);
    await click('[data-action="export-selected"]');await submit();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).format,'slotforge-car-package');
    await click('[data-action="export-selected"]');await js(`document.querySelector('#car-export-format').value='timing';updateCarExportFormat();`);await submit();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).items.slotcars.length,2);
    const before=fs.readFileSync(file);dialog.showSaveDialog=async()=>({canceled:true});await click('[data-action="export-selected"]');await submit();assert.ok(fs.readFileSync(file).equals(before));
  }finally{dialog.showSaveDialog=previous;}
  return ['Timing export works from a single car and multi-selection','Timing selection disables saved setups; native package stays the default','cancelled exports do not overwrite the file'];
};
