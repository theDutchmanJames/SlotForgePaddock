const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({win,store,js,wait,click,fill,submit,qa})=>{
 const checks=[],visual=path.join(qa,'showroom-preview-car.jpg'),image=fs.existsSync(visual)?'data:image/jpeg;base64,'+fs.readFileSync(visual).toString('base64'):'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/icon.png')).toString('base64');
 const a=store.mutate('car.save',{data:{name:'Showroom Corvette',maker:'NSR',scale:'1:32',usage:['Club racing'],picture:image,photos:[{id:'alternate',name:'Alternate',data:'data:image/png;base64,'+fs.readFileSync(path.join(__dirname,'../assets/slotforge-footer-light.png')).toString('base64')}]}}).result;
 const b=store.mutate('car.save',{data:{name:'Showroom Mini <b>literal</b>',maker:'Scalextric',usage:['Home racing']}}).result;
 const c=store.mutate('car.save',{data:{name:'Showroom Archived',archived:true}}).result;
 const group=store.mutate('planning.shelf.save',{revision:store.data.revision,name:'Club racers',carIds:[b,a,c]}).result;
 store.transact(db=>{db.cars.find(c=>c.id===a).realHistory={team:'AC München',event:'Spezial-Tourenwagen-Trophy (STT), Int. Großer Preis der Tourenwagen, Nürburgring, 9 July 1988',year:'1988',history:'A saved racing story. <script>literal text</script> '+('The car raced through the season. '.repeat(100))};});
 store.mutate('planning.focus',{revision:store.data.revision,carId:a,photoKey:'main',x:65,y:45});
 const before=store.snapshot();
 await js(`(async()=>{page='Showroom';showroom.context='';await loadView()})()`);await wait('!!document.querySelector(".showroom-hero")&&!viewPendingKey');
 const search=async value=>{await js(`(()=>{const el=document.querySelector('#showroom-search');el.focus();el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await new Promise(r=>setTimeout(r,180));await wait('!viewPendingKey');};
 const set=async values=>{for(const [key,value]of Object.entries(values)){await fill({[key]:value});await js(`document.querySelector('[name="${key}"]').dispatchEvent(new Event('change',{bubbles:true}))`);}};
 const cover=async values=>{await click('[data-action="showroom-cover-options"]');await set(values);await submit();await wait('!viewPendingKey');};
 const present=async values=>{await click('[data-action="showroom-presentation"]');await set(values);await submit();await wait('!!showroom.viewer&&document.querySelector("#showroom-viewer").open');};
 assert.equal(await js('document.querySelector("#showroom-shelf").parentElement.textContent.startsWith("Group")'),true);
 assert.equal(await js('!!document.querySelector(".showroom-page [data-action=photo-fit]")'),false);
 await cover({mode:'fixed',carId:a});
 assert.equal(await js('showroomCoverCar().id'),a);assert.equal(await js('getComputedStyle(document.querySelector(".showroom-hero-photo img")).objectFit'),'cover');
 assert.equal(await js('document.querySelectorAll(".showroom-story script").length'),0);
 assert.ok(await js('document.querySelector(".showroom-hero").getBoundingClientRect().height<=560'),JSON.stringify(await js('Array.from(document.querySelectorAll(".showroom-hero,.showroom-hero-copy,.showroom-hero-copy>*")).map(el=>({class:el.className,height:el.getBoundingClientRect().height,margin:getComputedStyle(el).margin}))')));
 await search('Mini');assert.equal(await js('showroomCars().length'),1);assert.equal(await js('showroomCoverCar().id'),a);
 await click('[data-action="showroom-history"]');assert.ok((await js('document.querySelector(".is-full").textContent')).length>3000);await click('[data-action="close-modal"]');
 await click('.showroom-hero-photo');await wait('!!showroom.viewer');assert.equal(await js('showroom.viewer.id'),a);assert.equal(await js('document.querySelector("#showroom-viewer img").style.objectPosition'),'65% 45%');await click('[data-action="showroom-photo-next"]');assert.equal(await js('showroom.viewer.photo'),1);await click('[data-action="showroom-photo-prev"]');await click('[data-action="showroom-close"]');
 assert.deepEqual(store.snapshot(),before);checks.push('Groups; bounded story; full history; cover independent of search; preferences do not mutate the database');
 await search('Showroom');await click('[data-action="showroom-favourite"][data-id="'+a+'"]');await click('[data-action="showroom-filter"][data-id="favourites"]');assert.equal(await js('showroomCars().length'),1);await click('[data-action="showroom-favourite"][data-id="'+a+'"]');assert.equal(await js('showroomCars().length'),0);await click('[data-action="showroom-clear"]');
 await cover({mode:'visit',source:'all'});const first=await js('showroomCoverCar().id');await search('Showroom');assert.equal(await js('showroomCoverCar().id'),first);
 await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="nav"][data-id="Showroom"]');assert.notEqual(await js('showroomCoverCar().id'),first);
 await cover({mode:'startup',source:'all'});const startup=await js('showroomCoverCar().id');
 await click('[data-action="nav"][data-id="Cars"]');await click('[data-action="nav"][data-id="Showroom"]');assert.equal(await js('showroomCoverCar().id'),startup);
 await win.webContents.reload();await wait('typeof db!=="undefined"&&!!db');await click('[data-action="nav"][data-id="Showroom"]');assert.notEqual(await js('showroomCoverCar().id'),startup);
 checks.push('Visit mode changes only on visits; startup mode remains stable until reopening');
 await cover({mode:'rotate',source:'all',seconds:5});const timed=await js('showroomCoverCar().id');await js('document.activeElement.blur()');await new Promise(r=>setTimeout(r,5300));await wait('!viewPendingKey');assert.notEqual(await js('showroomCoverCar().id'),timed);
 await click('[data-action="showroom-cover-pause"]');assert.equal(await js('showroom.coverTimer'),null);const paused=await js('showroomCoverCar().id');await search('Mini');assert.equal(await js('showroomCoverCar().id'),paused);
 await click('[data-action="showroom-cover-options"]');await set({mode:'rotate',source:'usage'});await js('document.querySelector("#modal-form").requestSubmit()');await wait('!modalSaving&&!document.querySelector("#form-error").hidden');await click('[data-action="close-modal"]');
 checks.push('Timed covers advance and pause; empty usage selections cannot be saved');
 await present({source:'group',groupId:group,seconds:5,layout:'history'});assert.deepEqual(await js('showroomSequence().map(c=>c.id)'),[b,a]);assert.equal(await js('showroom.viewer.id'),b);
 await click('[data-action="showroom-toggle-play"]');assert.equal(await js('showroom.timer'),null);await click('[data-action="showroom-next"]');assert.equal(await js('showroom.viewer.id'),a);
 assert.equal(await js('document.querySelectorAll(".showroom-viewer-stage>.showroom-story").length'),1);
 await click('#showroom-viewer [data-action="showroom-history"]');assert.equal(await js('showroom.viewer.playing'),false);await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))");assert.equal(await js('showroom.viewer.id'),a);await click('[data-action="close-modal"]');
 await click('[data-action="showroom-close"]');await wait('!document.fullscreenElement');assert.equal(await js('showroom.timer'),null);
 await click('[data-action="showroom-presentation"]');await set({source:'usage',layout:'photo'});await js(`document.querySelector('[name="usage-0"]').checked=true`);await submit();await wait('!!showroom.viewer&&document.querySelector("#showroom-viewer").open');
 {// usage-0 is the first label alphabetically ("Club racing"). Earlier smoke steps add more
 // Club racing cars, so check the rule rather than a fixed count.
 const ids=await js('showroomSequence().map(c=>c.id)');assert.ok(ids.includes(a));assert.ok(!ids.includes(b));assert.ok(await js('showroomSequence().every(c=>(c.usage||[]).includes("Club racing"))'));}assert.equal(await js('document.querySelectorAll(".showroom-viewer-stage>.showroom-story").length'),0);
 await click('[data-action="showroom-close"]');await wait('!document.fullscreenElement');checks.push('Presentation uses ordered Groups or usage labels independently of gallery; both layouts, reading, pause and exit work');
 await cover({mode:'fixed',carId:a});
 for(const [width,height,theme]of [[1440,980,'dark'],[1280,1000,'dark'],[960,800,'light'],[700,900,'light']]){win.setSize(width,height);await js(`db.settings.theme=${JSON.stringify(theme)};render()`);await wait('!viewPendingKey');await new Promise(r=>setTimeout(r,700));assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);assert.equal(await js('(()=>{const el=document.querySelector(".showroom-hero-copy");return el.scrollHeight<=el.clientHeight})()'),true);assert.equal(await js('(()=>{const copy=document.querySelector(".showroom-hero-copy"),box=copy.getBoundingClientRect(),actions=copy.querySelector(".actions").getBoundingClientRect(),title=copy.querySelector("h2").getBoundingClientRect();return getComputedStyle(copy).overflowY!=="auto"&&title.top>=box.top&&actions.bottom<=box.bottom;})()'),true);fs.writeFileSync(path.join(qa,'showroom-'+width+'-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());}
 // Long user text and UI zoom must grow the cover instead of hiding its controls.
 win.setSize(960,800);win.webContents.setZoomFactor(1.25);
 await js(`(()=>{const car=showroomCoverCar();car.name='A very long car name with a special edition and detailed racing description';car.usage=['Club racing and competitions','Private collection and display','Testing and development'];render()})()`);
 await new Promise(r=>setTimeout(r,300));
 assert.equal(await js('(()=>{const el=document.querySelector(".showroom-hero-copy"),actions=el.querySelector(".actions");return el.scrollHeight<=el.clientHeight&&actions.getBoundingClientRect().bottom<=el.getBoundingClientRect().bottom&&document.documentElement.scrollWidth<=innerWidth;})()'),true);
 win.webContents.setZoomFactor(1);win.setSize(1440,980);await js('loadView()');await wait('!viewPendingKey');checks.push('Dark/light desktop and narrow layouts; long titles and usage labels at 125% zoom remain visible without internal scrolling');
 await present({source:'all'});await js(`page='Cars';render()`);await wait('!viewPendingKey');assert.equal(await js('showroom.viewer'),null);assert.equal(await js('showroom.timer'),null);assert.equal(await js('showroom.coverTimer'),null);
 await js(`remote={id:'showroom-remote',settings:{name:'Club showroom'},cars:[{id:'remote-only',name:'Club car',technical:{},usage:[],picture:''}],parts:[],installations:[],setups:[],events:[],views:[],customFields:[],submissions:[]};switchCollection('remote');page='Showroom';render()`);
 assert.equal(await js('document.querySelectorAll(".showroom-star").length'),0);assert.equal(await js('showroomCoverCar().id'),'remote-only');await click('.showroom-card-open');await js(`switchCollection('local');render()`);await wait('!viewPendingKey');assert.equal(await js('showroom.viewer'),null);
 checks.push('Navigation and collection changes clear timers and viewers; remote collections remain read-only');return checks;
};
