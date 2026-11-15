'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),frame=require('../src/application-frame.cjs');
test('Chromium Windows drive casing is normalized without broadening file URL equivalence',()=>{
 const lower='file:///c:/Users/Test%20User/app.asar/renderer/index.html',upper='file:///C:/Users/Test%20User/app.asar/renderer/index.html';
 assert.equal(frame.canonicalURL(lower,'win32'),upper);assert.equal(frame.canonicalURL(upper,'win32'),upper);
 assert.equal(frame.canonicalURL(lower,'linux'),lower);assert.equal(frame.canonicalURL(lower,'darwin'),lower);
 for(const url of ['https://example.test/c:/index.html','file://server/share/index.html','file:///tmp/c:/index.html','file:///C:/Users/test%20user/app.asar/renderer/index.html',upper+'?query',upper+'#fragment'])assert.equal(frame.canonicalURL(url,'win32'),url);
});
test('application IPC requires the actual main frame and the exact approved location',()=>{
 const url=frame.fileURL(__filename),mainFrame={url},sender={mainFrame,isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false},event={sender,senderFrame:mainFrame};
 assert.equal(frame.owns(window,event,url),true);
 assert.equal(frame.owns(window,{sender,senderFrame:{url}},url),false,'same-URL child frame');
 assert.equal(frame.owns(window,{sender:{...sender},senderFrame:mainFrame},url),false,'different web contents');
 assert.equal(frame.owns(null,event,url),false);
 assert.equal(frame.owns({...window,isDestroyed:()=>true},event,url),false);
 for(const other of [url+'#anchor',url+'?query',url.replace('application-frame','another-file'),'https://example.test/','file:///C:/elsewhere/index.html']){mainFrame.url=other;assert.equal(frame.owns(window,event,url),false,other);}
 mainFrame.url=url;sender.isDestroyed=()=>true;assert.equal(frame.owns(window,event,url),false);
});
test('portable short paths compare equally across Node and Chromium URL encodings',()=>{
 const expected=frame.canonicalURL('file:///c:/Users/THEDUT%7E1/AppData/Local/Temp/app/renderer/index.html','win32');
 assert.equal(expected,'file:///C:/Users/THEDUT~1/AppData/Local/Temp/app/renderer/index.html');
 assert.equal(frame.canonicalURL(expected,'win32'),expected);
 assert.equal(frame.canonicalURL('file:///C:/Users/THEDUT%7e1/AppData/Local/Temp/app/renderer/index.html','win32'),expected);
 for(const platform of ['win32','darwin','linux']){
  assert.equal(frame.canonicalURL('file:///tmp/a%7Eb/%69ndex.html',platform),'file:///tmp/a~b/index.html');
  assert.notEqual(frame.canonicalURL('file:///tmp/a%2Fb/index.html',platform),'file:///tmp/a/b/index.html');
  assert.notEqual(frame.canonicalURL('file:///tmp/a%5Cb/index.html',platform),'file:///tmp/a/b/index.html');
  assert.notEqual(frame.canonicalURL('file:///tmp/index.html%3Fquery',platform),'file:///tmp/index.html?query');
  assert.notEqual(frame.canonicalURL('file:///tmp/index.html%23anchor',platform),'file:///tmp/index.html#anchor');
 }
 const url=frame.fileURL(require('node:path').join(__dirname,'short~1','index.html')),actual=url.replace('%7E','~'),mainFrame={url:actual},sender={mainFrame,isDestroyed:()=>false},window={webContents:sender,isDestroyed:()=>false};
 assert.equal(frame.owns(window,{sender,senderFrame:mainFrame},url),true);
 assert.equal(frame.owns(window,{sender,senderFrame:{url:actual}},url),false,'equivalent URL still cannot authorize a child frame');
});
