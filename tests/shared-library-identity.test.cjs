'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {open}=require('../packages/shared-library/index.cjs');
test('original source identity stays authoritative if Timing initializes a new private identity later',async t=>{
 const root=require('./support/temp-dir.cjs')('library-identity-'),appData=path.join(root,'profiles'),profile=path.join(appData,'slotforge-timing'),sharedRoot=path.join(root,'shared');fs.mkdirSync(profile,{recursive:true});const file=path.join(profile,'slotforge-timing.json'),raw={version:1,slotcars:[{id:'old',model:'Old car'}],sessions:[],laps:[]};fs.writeFileSync(file,JSON.stringify(raw));const handles=[];t.after(async()=>{await Promise.all(handles.map(h=>h.close()));fs.rmSync(root,{recursive:true,force:true});});
 const p=await open({application:'SlotForge Paddock',installationId:'Paddock',sharedRoot,appData});handles.push(p);const info=await p.bootstrapInfo(),receipt=info.adoption[0];assert.ok(receipt.sourceId.startsWith('legacy-'));assert.equal(receipt.originKey.length,64);await p.close();
 raw.paddock={sourceId:'newly-initialized-private-id'};fs.writeFileSync(file,JSON.stringify(raw));
 const timing=await open({application:'SlotForge Timing',installationId:'Timing',sharedRoot,appData});handles.push(timing);assert.equal((await timing.bootstrapInfo()).adoption[0].sourceId,receipt.sourceId);assert.ok((await timing.origin({sourceId:receipt.sourceId,originalId:'old'})).carId);assert.equal((await timing.catalogue()).total,1);
});
