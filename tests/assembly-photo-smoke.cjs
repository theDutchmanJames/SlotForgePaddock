'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{dialog,net,nativeImage}=require('electron');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const png=require('./support/thumbnail-images.cjs'),original=png(1000,600,150),replacement=png(400,800,80),file=path.join(qa,'assembly-original.png');fs.writeFileSync(file,Buffer.from(original.split(',')[1],'base64'));
 const part=store.mutate('part.save',{data:{name:'QA axle',quantity:2,tracking:'quantity',category:'Axles & bearings'}}).result;
 const open=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
 const refresh=()=>js(`(async()=>{acceptSnapshot((await api('read',{queryView:{page:'Parts',partsTab:'Assemblies'}})).data);page='Parts';partsTab='Assemblies';render()})()`);
 try{
  await refresh();await click('[data-action="add-assembly"]');assert.ok(await js("document.querySelector('#assembly-photo-editor').innerText.includes('optional')"));await click('[data-action="assembly-photo-pick"]');await wait('!assemblyPhotoState.busy');await fill({name:'Rear axle assembly',component0:part,quantity0:'1'});await submit();
  const a=store.data.assemblies.find(a=>a.name==='Rear axle assembly');assert.ok(a);assert.equal(a.picture,original);
  await wait("document.querySelector('.assembly-photo-preview img')?.naturalWidth===512");
  await click('[data-action="assembly-photo-view"]');await wait("document.querySelector('.assembly-photo-full')?.naturalWidth===1000");await click('[data-action="close-modal"]');
  await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-clear"]');await click('[data-action="close-modal"]');assert.equal(store.data.assemblies.find(x=>x.id===a.id).picture,original);
  fs.writeFileSync(file,Buffer.from(replacement.split(',')[1],'base64'));await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-pick"]');await submit();assert.equal(store.data.assemblies.find(x=>x.id===a.id).picture,replacement);
  await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-clear"]');await submit();assert.equal(store.data.assemblies.find(x=>x.id===a.id).picture,'');await wait("!!document.querySelector('.assembly-photo-placeholder')");
  // Decoder rejects corrupt compressed content even with a plausible header.
  const broken=Buffer.from(original.split(',')[1],'base64');broken.fill(0,45,Math.min(100,broken.length-12));fs.writeFileSync(file,broken);await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-pick"]');assert.equal(await js('assemblyPhotoState.picture'),'');assert.ok(await js("document.querySelector('#toast').textContent.includes('could not be opened')"));await click('[data-action="close-modal"]');
  const formats=await js(`(()=>{const c=document.createElement('canvas');c.width=24;c.height=10;const g=c.getContext('2d');g.fillStyle='#00aa55';g.fillRect(12,0,12,10);return [c.toDataURL('image/jpeg'),c.toDataURL('image/webp')];})()`);
  for(const picture of formats){fs.writeFileSync(file,Buffer.from(picture.split(',')[1],'base64'));await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-pick"]');await submit();assert.equal(store.data.assemblies.find(x=>x.id===a.id).picture,picture);}
  await wait("document.querySelector('.assembly-photo-preview img')?.naturalWidth===24");
  const thumbnail=await net.fetch(await js("document.querySelector('.assembly-photo-preview img').src")),decoded=nativeImage.createFromBuffer(Buffer.from(await thumbnail.arrayBuffer()));assert.equal(decoded.toBitmap()[(24+1)*4+3],0);
  fs.writeFileSync(file,Buffer.from(original.split(',')[1],'base64'));await click('[data-action="assembly-photo"]');await click('[data-action="assembly-photo-pick"]');await submit();await js("document.querySelector('#toast').hidden=true");
  await wait("document.querySelector('.assembly-photo-preview img')?.naturalWidth===512");fs.writeFileSync(path.join(qa,'assembly-photo-dark.png'),(await win.webContents.capturePage()).toPNG());
  await js("applyTheme({...db.settings,theme:'light'})");fs.writeFileSync(path.join(qa,'assembly-photo-light.png'),(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(qa,'assembly-photo-smoke.json'),JSON.stringify({passed:true,checks:['optional creation','original bytes preserved','512px card','full-size viewer','cancel preserves original','replacement','removal and icon fallback','corrupt content rejected','JPEG and WebP originals','WebP transparency and no enlargement','light and dark captures']},null,2));
 }finally{dialog.showOpenDialog=open;}
};
