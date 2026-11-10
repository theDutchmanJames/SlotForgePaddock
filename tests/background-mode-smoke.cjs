'use strict';
// Native Electron, real main/preload/HTTP, isolated profile and discovery.
const {app,BrowserWindow,Menu,dialog,powerMonitor}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-background-ui-'));app.setPath('userData',root);process.env.LOCALAPPDATA=root;process.env.XDG_RUNTIME_DIR=root;
fs.writeFileSync(path.join(root,'desktop-settings.json'),JSON.stringify({version:1,background:true}));
const {Store}=require('../src/store.cjs'),f=require('./support/timing-fixtures.cjs').fixtures();new Store(path.join(root,'database.json')).replace(f.store.snapshot());
const Local=require('../src/local-library.cjs').LocalLibrary,originalStart=Local.prototype.start;let service;
Local.prototype.start=function(){service=this;return originalStart.call(this);};
const buildMenu=Menu.buildFromTemplate;let trayMenu;Menu.buildFromTemplate=function(items){if(items.some(i=>i.label==='Quit Paddock completely'))trayMenu=items;return buildMenu.call(this,items);};
const errors=[];dialog.showErrorBox=(title,message)=>errors.push({title,message});
const wait=ms=>new Promise(r=>setTimeout(r,ms));let success=false,started=false;
const load=BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile=async function(file,...args){const result=await load.call(this,file,...args);if(path.basename(file)!=='index.html'||started)return result;started=true;const win=this;win.setPosition(-20000,-20000);
 setTimeout(()=>run(win).catch(e=>{console.error(e.stack);app.exit(1);}),100);return result;};
async function run(win){
 win.webContents.setBackgroundThrottling(false);
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error('RENDERER',event.message);});
 const js=async code=>{try{return await win.webContents.executeJavaScript(code.includes('await ')?'(async()=>{'+code+'})()':code);}catch(e){console.error('FAILED JS',code);throw e;}};for(let i=0;!(await js("typeof db!=='undefined'&&!!db?._view?.token"));i++){if(i>150)throw Error('Renderer did not start');await wait(20);}await service.start();assert.ok(trayMenu);
 await js("await api('network','background-mode',{enabled:true}); true");win.close();assert.equal(win.isDestroyed(),false);assert.equal(win.isVisible(),false);
 async function send(payload){const r=await fetch('http://127.0.0.1:'+service.network.port+'/v1/timing/sessions',{method:'POST',headers:{Authorization:'Bearer '+service.token,'X-SlotForge-Instance':service.instanceId,'X-SlotForge-Database':service.store.data.id,'Content-Type':'application/json'},body:JSON.stringify(payload)});const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;}
 await send(f.normal);assert.equal(win.isVisible(),false);trayMenu[0].click();assert.equal(win.isVisible(),true);
 await js("page='Review';reviewTab='Race results';await loadView();true");assert.match(await js("document.querySelector('#main').innerText"),/Club race/);
 win.setSize(1442,982);await wait(200);await win.webContents.capturePage();await wait(100);
 fs.writeFileSync(path.join(__dirname,'..','.qa','phase-two-review.png'),(await win.webContents.capturePage()).toPNG());
 await js("await reviewAction('result-session','0');true");assert.match(await js("document.querySelector('#dialog').innerText"),/Measured laps/);await js("document.querySelector('#dialog').close()");await wait(50);
 await js("await reviewAction('result-open-car','car-a'); true");for(let i=0;i<100&&!(await js("!!db._view?.timing"));i++)await wait(20);assert.equal(await js("section"),'Performance');assert.match(await js("document.querySelector('#main').innerText"),/Club race/);
 await js("page='Review';reviewTab='Race results';await loadView();await reviewAction('result-seen','0');true");assert.equal(await js("db._view.resultInbox.total"),0);
 await send(f.correction);await js("await loadView();true");assert.equal(await js("db._view.resultInbox.total"),1);assert.match(await js("document.querySelector('#main').innerText"),/Corrected/);
 const token=service.token;powerMonitor.emit('suspend');powerMonitor.emit('resume');await service.recover();assert.equal(service.token,token);
 win.close();app.emit('activate');assert.equal(win.isVisible(),true);win.close();await js("await api('network','background-mode',{enabled:false});true");assert.equal(win.isVisible(),true);
 await js("page='Settings';settingsSection='Appearance';await loadView();true");assert.match(await js("document.querySelector('#main').innerText"),/Keep Paddock available/);
 await js("document.querySelector('[data-action=background-mode]').click()");for(let i=0;i<100&&!(await js("net.background.enabled"));i++)await wait(20);assert.equal(await js("net.background.enabled"),true);
 await js("document.querySelector('[data-action=background-mode]').scrollIntoView({block:'center'})");win.setSize(1440,980);await wait(150);await win.webContents.capturePage();await wait(50);fs.writeFileSync(path.join(__dirname,'..','.qa','phase-two-settings.png'),(await win.webContents.capturePage()).toPNG());
 await js("page='Connections';await loadView();true");assert.match(await js("document.querySelector('#main').innerText"),/Local connection ready/);assert.match(await js("document.querySelector('#main').innerText"),/Retry local connection/);
 assert.equal(errors.length,0);success=true;trayMenu.at(-1).click();
}
const deadline=setTimeout(()=>{console.error('Background smoke timed out');app.exit(1);},30000);
app.on('will-quit',()=>{clearTimeout(deadline);try{assert.equal(success,true);assert.equal(fs.existsSync(service.file),false);const reopened=new Store(path.join(root,'database.json'));assert.equal(reopened.data.timing.sessions[0].payload.revision,2);assert.equal(errors.length,0);console.log('PASS native background lifecycle: hidden delivery, Review notice, correction, car navigation, wake, reopen, disable and complete quit');}catch(e){console.error(e);process.exitCode=1;}});
require('../src/main.cjs');
