'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {create}=require('../src/startup-feedback.cjs');
test('startup feedback waits for painted content, blocks navigation and closes through the safe quit path',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let window,quits=0;
 class Window extends EventEmitter{
  constructor(options){super();window=this;this.options=options;this.shows=0;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=fn=>this.open=fn;}
  isDestroyed(){return !!this.destroyed;} show(){this.shows++;} focus(){this.focused=true;}
  destroy(){this.destroyed=true;} setTitle(v){this.title=v;} loadFile(file){this.file=file;return Promise.resolve();}
 }
 const feedback=create({BrowserWindow:Window,quit:()=>quits++});
 assert.equal(window.options.webPreferences.preload,undefined);assert.equal(window.options.webPreferences.sandbox,true);assert.equal(window.options.webPreferences.nodeIntegration,false);
 t.mock.timers.tick(300);assert.equal(window.shows,0);window.emit('ready-to-show');assert.equal(window.shows,1);assert.equal(await feedback.ready,true);
 assert.deepEqual(window.open(),{action:'deny'});let blocked=false;window.webContents.emit('will-navigate',{preventDefault(){blocked=true;}});assert.equal(blocked,true);
 let prevented=false;window.emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(quits,1);assert.match(window.title,/Finishing/);assert.equal(window.isDestroyed(),false);
 feedback.focus();assert.equal(window.focused,true);feedback.dispose();assert.equal(window.isDestroyed(),true);feedback.focus();assert.equal(window.shows,2);
 const hidden=create({BrowserWindow:Window,quit:()=>quits++,visible:false});window.emit('ready-to-show');t.mock.timers.tick(300);hidden.focus();assert.equal(window.shows,0);hidden.dispose();
 const fast=create({BrowserWindow:Window,quit:()=>quits++});fast.dispose();window.emit('ready-to-show');t.mock.timers.tick(300);assert.equal(window.shows,0);
}
);

test('first-screen handoff ignores other frames, then removes its listeners',async()=>{
 const ipcMain=new EventEmitter(),window=new EventEmitter();window.webContents=new EventEmitter();
 const {waitForPage}=require('../src/startup-feedback.cjs');
 const gate=waitForPage({ipcMain,window,trusted:e=>e.trusted});let finished=false;gate.ready.then(()=>finished=true);
 ipcMain.emit('sf:startup-ready',{trusted:false});await Promise.resolve();assert.equal(finished,false);
 ipcMain.emit('sf:startup-ready',{trusted:true});assert.equal(await gate.ready,'ready');
 assert.equal(ipcMain.listenerCount('sf:startup-ready'),0);assert.equal(window.webContents.listenerCount('render-process-gone'),0);assert.equal(window.listenerCount('closed'),0);
 gate.cancel();assert.equal(await gate.ready,'ready');
});
test('first-screen failure, cancellation and timeout cannot leave startup waiting forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const {waitForPage}=require('../src/startup-feedback.cjs');
 for(const result of ['failed','cancelled','closed','timeout']){
  const ipcMain=new EventEmitter(),window=new EventEmitter();window.webContents=new EventEmitter();
  const gate=waitForPage({ipcMain,window,trusted:()=>true});
  if(result==='failed')window.webContents.emit('render-process-gone');else if(result==='closed'){Object.defineProperty(window,'webContents',{get(){throw Error('Object has been destroyed');}});window.emit('closed');}else if(result==='cancelled')gate.cancel();else t.mock.timers.tick(30000);
  assert.equal(await gate.ready,result==='closed'?'cancelled':result);assert.equal(ipcMain.listenerCount('sf:startup-ready'),0);
 }
});
test('portable splash is a valid 24-bit bitmap and packaged with the startup page assets',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 const config=require('../package.json'),bmp=fs.readFileSync(path.join(root,config.build.portable.splashImage));
 assert.equal(bmp.toString('ascii',0,2),'BM');assert.equal(bmp.readUInt32LE(2),bmp.length);assert.equal(bmp.readUInt16LE(28),24);assert.equal(bmp.readInt32LE(18),500);assert.equal(bmp.readInt32LE(22),340);
 assert.ok(config.build.files.includes('assets/**/*'));assert.ok(config.build.files.includes('renderer/**/*'));
 const html=fs.readFileSync(path.join(root,'renderer/opening.html'),'utf8');for(const [,src]of html.matchAll(/(?:src|href)="([^"]+)"/g))assert.ok(fs.existsSync(path.resolve(root,'renderer',src)),src);
});
test('portable build hook keeps the established background command and suppresses only its splash',async()=>{
 const fs=require('node:fs'),hook=require('../scripts/portable-splash.cjs');
 const stock=fs.readFileSync(require.resolve('app-builder-lib/templates/nsis/portable.nsi'),'utf8');
 const patched=hook.adapt(stock);
 assert.match(patched,/GetOptions.*--slotforge-library-start=/);assert.match(patched,/IfNot.*Errors[\s\S]*?SetSilent silent/);
 assert.ok(patched.includes('BgImage::SetBg'));assert.ok(patched.includes('ExecWait'));assert.throws(()=>hook.adapt('unexpected template'),/template changed/);
 let received;const target={name:'portable',computeFinalScript:async script=>{received=script;return script;}};
 await hook({targets:[target]});await hook({targets:[target]});await target.computeFinalScript(stock);assert.equal(received,patched);
 const other={name:'dmg'};await hook({targets:[other]});assert.equal(other.paddockSplashPatched,undefined);
});
