'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
module.exports=async(win,store,root,{sharedPreviews,sharedEncoder,media})=>{
 win.webContents.setBackgroundThrottling(false);const errors=[],checks=[];win.webContents.on('console-message',(event,...args)=>{for(const a of [event.message,...args])if(typeof a==='string'&&/Uncaught|ReferenceError|TypeError/.test(a))errors.push(a);});
 const js=async code=>{try{return await win.webContents.executeJavaScript(code,true);}catch(e){throw Error(e.message+'\nScript: '+code.slice(0,260)+'\nRenderer: '+errors.join('\n'));}},wait=async expression=>{for(let i=0;i<250;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('Thumbnail UI wait failed: '+expression);};
 const click=async selector=>{await wait(`!!document.querySelector(${JSON.stringify(selector)})`);await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await wait('!actionBusy&&!viewPendingKey');};
 await wait('typeof db!=="undefined"&&!!db');await wait('!!window.slotforge.sharedThumbnailReady');assert(sharedEncoder.ready);
 const makePhoto=colour=>js(`(()=>{const c=document.createElement('canvas');c.width=1600;c.height=1000;const x=c.getContext('2d');x.fillStyle=${JSON.stringify(colour)};x.fillRect(0,0,1600,1000);x.fillStyle='#ffffff';x.font='80px sans-serif';x.fillText('Full-resolution test photograph',90,480);return c.toDataURL('image/png');})()`);
 const original=await makePhoto('#285a70'),replacement=await makePhoto('#905025');
 const id=store.mutate('car.save',{data:{name:'A thumbnail test car',maker:'NSR',picture:original,photos:[{id:'extra-photo',name:'Gallery original',data:replacement}]}}).result;
 const duplicate=store.mutate('car.save',{data:{name:'B shared photograph',picture:original}}).result;
 for(let i=0;i<53;i++)store.mutate('car.save',{data:{name:'Z test car '+String(i).padStart(2,'0')}});
 const cacheFile=path.join(root,'shared/thumbnails/png-512-v1/cache.sqlite'),rows=()=>{if(!fs.existsSync(cacheFile))return [];const db=new DatabaseSync(cacheFile);try{return db.prepare('SELECT key,data FROM thumbnails WHERE data IS NOT NULL').all();}finally{db.close();}};
 for(let i=0;i<200&&rows().length<1;i++)await new Promise(r=>setTimeout(r,40));assert.equal(rows().length,1,'saving warms the shared cache before visiting Cars');
 await click('[data-action="nav"][data-id="Cars"]');await wait(`!!document.querySelector('img[alt="A thumbnail test car"]')?.naturalWidth`);
 const dimensions=selector=>js(`(()=>{const i=document.querySelector(${JSON.stringify(selector)});return {width:i.naturalWidth,height:i.naturalHeight,src:i.getAttribute('src')};})()`);
 const small=await dimensions('img[alt="A thumbnail test car"]');assert.equal(small.width,512);assert.equal(small.height,320);assert(small.src.endsWith('?thumbnail=1'));assert.equal(await js('db.cars.length'),48);assert.equal(rows().length,1);
 checks.push('55-car collection loads a 48-car page; two cars share one persistent 512px PNG; save warms cache before browsing');
 await js("mode='table';render()");await wait('document.querySelector(".table-thumb")?.naturalWidth===512');assert((await dimensions('.table-thumb')).src.endsWith('?thumbnail=1'));await js("tableColumns=['name','picture'];render()");await wait('document.querySelector(".table-thumb")?.naturalWidth===512');await js("mode='gallery';render()");
 checks.push('Cars table uses thumbnails in both the name column and dedicated picture column');
 await click(`[data-action="open-car"][data-id="${id}"]`);await wait('!!document.querySelector(".hero-photo img")?.naturalWidth');assert.equal((await dimensions('.hero-photo img')).width,1600);
 await click('[data-action="nav"][data-id="Showroom"]');await wait(`Array.from(document.images).some(i=>i.alt==='A thumbnail test car'&&i.naturalWidth===1600)&&Array.from(document.images).some(i=>i.alt==='A thumbnail test car'&&i.naturalWidth===512)`);
 const revision=store.data.revision;
 const load=url=>js(`new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve({width:i.naturalWidth,height:i.naturalHeight});i.onerror=()=>reject(Error('Image failed'));i.src=${JSON.stringify(url)};})`);
 const car=()=>store.data.cars.find(c=>c.id===id);const gallery=media.project({cars:[car()]}).cars[0].photos[0].data;assert.equal((await load(gallery)).width,1600);assert.equal(store.data.revision,revision);assert.equal(car().picture,original);
 checks.push('detail, spotlight and gallery retain exact 1600px originals; reading thumbnails does not change collection revision');
 // Exercise the production IPC save path, then read from a separate Timing handle.
 await js(`(async()=>{await api('mutate','car.save',{id:${JSON.stringify(id)},revision:${car().revision},data:{picture:${JSON.stringify(replacement)}}});})()`);
 for(let i=0;i<200&&rows().length<2;i++)await new Promise(r=>setTimeout(r,40));assert.equal(rows().length,2);
 await click('[data-action="nav"][data-id="Cars"]');await wait('!!document.querySelector("img[alt^=A]")?.naturalWidth');const changed=await dimensions('img[alt="A thumbnail test car"]');assert.equal(changed.width,512);assert.notEqual(changed.src,small.src);
 const timing=require(process.env.SF_TIMING_THUMBNAIL_ENGINE||'../packages/shared-library/index.cjs'),reader=await timing.open({application:'SlotForge Timing',installationId:'thumbnail-ui-reader',sharedRoot:path.join(root,'shared'),legacyProfiles:[]});
 try{const read=await reader.thumbnail({carId:id});assert(rows().some(r=>r.data===read),'Timing reads the Paddock-generated derivative without an encoder');assert.equal((await reader.car(id,{includeMedia:true})).picture,replacement);}finally{await reader.close();}
 checks.push('IPC main-photo replacement gets a fresh derivative; independent Timing handle reuses it without encoding and sees exact original');
 await js(`(async()=>{await api('mutate','car.save',{id:${JSON.stringify(id)},revision:${car().revision},data:{picture:''}});})()`);await click('[data-action="nav"][data-id="Overview"]');await click('[data-action="nav"][data-id="Cars"]');assert.equal(await js('!!document.querySelector("img[alt^=A]")'),false);
 await wait('!!document.querySelector("img[alt^=B]")?.naturalWidth');assert.equal((await dimensions('img[alt="B shared photograph"]')).width,512);assert.equal(store.data.cars.find(c=>c.id===duplicate).picture,original);
 checks.push('removal clears the car image while another car sharing its old photo retains its preview');
 const beforeReload=rows().length;win.webContents.reload();await wait('typeof db!=="undefined"&&!!db&&!viewPendingKey');await click('[data-action="nav"][data-id="Cars"]');await wait('document.querySelector("img[alt^=B]")?.naturalWidth===512');assert.equal(rows().length,beforeReload);assert.equal(sharedEncoder.pending.size,0);
 for(const [width,theme]of [[1440,'dark'],[960,'light']]){win.setSize(width,980);await js(`db.settings.theme='${theme}';render()`);await wait('document.querySelector("img[alt^=B]")?.naturalWidth===512');await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert(await js('document.documentElement.scrollWidth<=innerWidth'));fs.writeFileSync(path.join(root,'thumbnails-'+theme+'.png'),(await win.webContents.capturePage({}, {stayHidden:true,stayAwake:true})).toPNG());}
 checks.push('renderer reload reuses cache and resets pending jobs; dark and light layouts remain within viewport');
 assert.deepEqual(errors,[]);await sharedPreviews.close();fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,checks,rendererErrors:errors},null,2));
};
