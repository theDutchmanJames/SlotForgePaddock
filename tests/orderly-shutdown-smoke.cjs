'use strict';
// Real main/preload/renderer verification with a disposable profile.
// Run with Electron; --load-failure rejects loading after IPC accepted a save.
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'paddock-quit-smoke-')),failure=process.argv.includes('--load-failure');app.setPath('userData',folder);BrowserWindow.prototype.show=function(){};
const errors=[];dialog.showErrorBox=(title,message)=>errors.push({title,message});
const tasks=require('../src/domain-tasks.cjs'),run=tasks.run;let accepted=false,started=false,lateRejected=false;
tasks.run=async(...args)=>{if(args[1].kind==='command'){accepted=true;await new Promise(r=>setTimeout(r,400));}return run(...args);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function save(win){
 const js=code=>win.webContents.executeJavaScript(code);
 for(let i=0;!(await js("typeof db!=='undefined'&&!!db?._view?.token?.epoch"));i++){if(i>100)throw Error('Renderer not ready');await wait(20);}
 await js("void api('mutate','car.save',{data:{name:'Accepted before closing'}}).then(r=>window.quitSave=r,e=>window.quitError=e.message); true");
 for(let i=0;!accepted;i++){if(i>100)throw Error('Save not accepted');await wait(5);}
}
const load=BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile=async function(file,...args){
 const result=await load.call(this,file,...args);
 if(path.basename(file)!=='index.html'||started)return result;started=true;
 try{await save(this);if(failure)throw Error('Injected main page load failure');app.quit();const result=await this.webContents.executeJavaScript("api('mutate','car.save',{data:{name:'Too late'}}).then(()=>null,e=>e.code)");lateRejected=result==='APP_CLOSING';return result;}
 catch(e){if(failure)throw e;console.error(e);app.exit(1);}
};
const deadline=setTimeout(()=>{console.error('Shutdown did not complete');app.exit(1);},15000);
app.on('will-quit',()=>{
 clearTimeout(deadline);
 try{const store=new (require('../src/store.cjs').Store)(path.join(folder,'database.json'));assert.equal(store.data.cars.filter(c=>c.name==='Accepted before closing').length,1);assert.equal(store.data.cars.some(c=>c.name==='Too late'),false);assert.equal(accepted,true);if(failure){assert.equal(errors.length,1);assert.match(errors[0].message,/Injected/);}else{assert.equal(errors.length,0);assert.equal(lateRejected,true);}console.log('PASS '+(failure?'main-page failure':'ordinary quit')+': accepted save persisted, no late write, clean shutdown');}
 catch(e){console.error(e);process.exitCode=1;}
});
require('../src/main.cjs');
