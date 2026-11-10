'use strict';
// Real desktop lifecycle in a synthetic profile. The only launch override is
// the test entry point, so the second process executes this observer too.
const {app,BrowserWindow,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(process.env.SF_SHARED_LAUNCH_TEST_ROOT||'');if(path.dirname(root)!==path.resolve(__dirname,'..','..','.qa')||!path.basename(root).startsWith('shared-launch-'))throw Error('Synthetic profile required.');
app.setPath('userData',path.join(root,'profile'));process.env.LOCALAPPDATA=root;process.env.XDG_RUNTIME_DIR=root;
const L=require('../../src/local-library-launcher.cjs'),makeCommand=L.command;L.command=options=>makeCommand({...options,appPath:__filename});
const isLaunch=process.argv.some(a=>a.startsWith(L.PREFIX)),errors=[];dialog.showErrorBox=(title,message)=>errors.push({title,message});
const show=BrowserWindow.prototype.show;BrowserWindow.prototype.show=function(){this.setOpacity(0);const result=show.call(this);return result;};
let service;const Local=require('../../src/local-library.cjs').LocalLibrary,start=Local.prototype.start;Local.prototype.start=function(){service=this;return start.call(this);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=setTimeout(()=>{console.error('Shared launch test timed out',errors);app.exit(1);},60000);
require('../../src/main.cjs');
(async()=>{
 let win;for(let n=0;n<500;n++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/index.html'));if(win&&service?.status().available&&fs.existsSync(service.launcher.file)&&await win.webContents.executeJavaScript("typeof db!=='undefined'&&!!db?._view?.token"))break;if(n===499)throw Error('Desktop/library unavailable: '+JSON.stringify(errors));await wait(30);}await wait(150);assert.deepEqual(errors,[]);
 const registration=JSON.parse(fs.readFileSync(service.launcher.file));
 if(!isLaunch){for(let n=0;!win.isVisible();n++){if(n>300)throw Error('Normal startup did not show window');await wait(20);}assert.equal(win.isVisible(),true);fs.writeFileSync(path.join(root,'registration.json'),JSON.stringify(registration));clearTimeout(deadline);app.quit();return;}
 assert.equal(win.isVisible(),false);const headers={Authorization:'Bearer '+service.token,'X-SlotForge-Instance':service.instanceId,'X-SlotForge-Database':service.store.data.id,'Content-Type':'application/json'};
 const url='http://127.0.0.1:'+service.network.port,schema=await (await fetch(url+'/v1/local-library/car-schema',{headers})).json();
 const response=await fetch(url+'/v1/local-library/car-operations',{method:'POST',headers,body:JSON.stringify({version:1,databaseId:service.store.data.id,recoveryId:schema.recoveryId,sourceId:'timing-native',operationId:'create-hidden',action:'create',set:{name:'Created while Paddock was hidden',weight:81}})});const receipt=await response.json();assert.equal(response.status,200,JSON.stringify(receipt));assert.equal(win.isVisible(),false);
 const launch=args=>new Promise((resolve,reject)=>{const p=spawn(registration.executable,args,{env:process.env,windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',code=>code?reject(Error('Second launch failed: '+code)):resolve());});
 await launch(registration.args);await wait(100);assert.equal(win.isVisible(),false);assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().endsWith('/index.html')).length,1);
 await launch(registration.args.filter(a=>!a.startsWith(L.PREFIX)));for(let n=0;!win.isVisible();n++){if(n>500)throw Error('Normal app launch did not reveal existing window');await wait(20);}assert.equal(service.store.data.cars.length,1);
 fs.writeFileSync(path.join(root,'native-result.json'),JSON.stringify({passed:true,checks:['registered exact command starts existing profile','background launch leaves window hidden','hidden host accepts direct car create','repeated library launch reuses process without opening window','normal launch reveals same window','one car and one database owner'],carId:receipt.car.id}));clearTimeout(deadline);app.quit();
})().catch(e=>{console.error(e.stack);app.exit(1);});
