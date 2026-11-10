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
 t.mock.timers.tick(300);assert.equal(window.shows,0);window.emit('ready-to-show');assert.equal(window.shows,1);
 assert.deepEqual(window.open(),{action:'deny'});let blocked=false;window.webContents.emit('will-navigate',{preventDefault(){blocked=true;}});assert.equal(blocked,true);
 let prevented=false;window.emit('close',{preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(quits,1);assert.match(window.title,/Finishing/);assert.equal(window.isDestroyed(),false);
 feedback.focus();assert.equal(window.focused,true);feedback.dispose();assert.equal(window.isDestroyed(),true);feedback.focus();assert.equal(window.shows,2);
 const hidden=create({BrowserWindow:Window,quit:()=>quits++,visible:false});window.emit('ready-to-show');t.mock.timers.tick(300);hidden.focus();assert.equal(window.shows,0);hidden.dispose();
 const fast=create({BrowserWindow:Window,quit:()=>quits++});window.emit('ready-to-show');fast.dispose();t.mock.timers.tick(300);assert.equal(window.shows,0);
}
);
