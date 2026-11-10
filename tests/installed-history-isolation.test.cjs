'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'support/installed-history-bootstrap.cjs'),'utf8');
function bootstrap(role,{outside=false}={}){
 const root=path.resolve('.qa/installed-history-isolation'),config={appData:path.join(root,'roaming'),localAppData:outside?path.resolve('outside-qa'):path.join(root,'local')};
 const calls={registry:0,main:0,mkdir:0},events={},paths={};
 const app={isPackaged:true,on:(name,fn)=>{events[name]=fn;},setPath:(name,value)=>{paths[name]=value;},getPath:name=>paths[name],getAppPath:()=>path.join(root,role,'app.asar'),disableHardwareAcceleration(){},setAsDefaultProtocolClient(){calls.registry++;},removeAsDefaultProtocolClient(){calls.registry++;}};
 const fileSystem={readFileSync:()=>JSON.stringify(config),mkdirSync:()=>{calls.mkdir++;},existsSync:()=>true,writeFileSync(){},appendFileSync(){}};
 const BrowserWindow=function(){};BrowserWindow.prototype.showInactive=function(){this.painted=true;};
 const context={require(name){if(name==='node:fs')return fileSystem;if(name==='node:path')return path;if(name==='electron')return {app,BrowserWindow,dialog:{}};if(name==='./package.json')return {installedQaRole:role};if(name===(role==='paddock'?'./src/main.cjs':'./main.js')){calls.main++;assert.equal(app.setAsDefaultProtocolClient('slotforge-paddock'),false);assert.equal(app.removeAsDefaultProtocolClient('slotforge-paddock'),false);return {};}throw Error('Unexpected dependency '+name);},process:{env:{SLOTFORGE_INSTALLED_QA:root},execPath:path.join(root,role,'app.exe'),on(){},pid:1},setInterval:()=>({unref(){}})};
 return {run:()=>vm.runInNewContext(source,context),calls,events};
}
for(const role of ['paddock','timing'])test(role+' packaged QA suppresses OS protocol changes before normal startup and paints without focus',()=>{
 const f=bootstrap(role);f.run();assert.equal(f.calls.main,1);assert.equal(f.calls.registry,0);
 const events={},win={webContents:{setBackgroundThrottling(){},on:(name,fn)=>{events[name]=fn;},getURL:()=>'/renderer/index.html'},setSize(){},setOpacity(v){this.opacity=v;}};
 f.events['browser-window-created'](null,win);events['did-finish-load']();assert.equal(win.opacity,0);assert.equal(win.painted,true);assert.equal(f.calls.registry,0);
});
test('packaged QA rejects profile paths outside its isolated root before file or app startup',()=>{
 const f=bootstrap('paddock',{outside:true});assert.throws(f.run,/QA profile must stay inside/);assert.equal(f.calls.mkdir,0);assert.equal(f.calls.main,0);assert.equal(f.calls.registry,0);
});
