'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {libraryStatus}=require('../src/library-status.cjs');
function renderer(){
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const c=vm.createContext({net:{portal:{enabled:false,available:true},localLibrary:{enabled:false,name:'Personal'},sharedFile:{shared:true,databaseId:'personal',name:'Personal',file:'C:/personal/library.sqlite',folder:'C:/personal'}},db:{settings:{name:'Personal'}},clubState:{},document:{querySelectorAll:()=>[]},local:()=>true,esc,icon:()=>'',btn:(s,a)=>`<button data-action="${a}">${s}</button>`,panel:(t,b)=>`<section><h2>${t}</h2>${b}</section>`,heading:t=>`<h1>${t}</h1>`,badge:s=>s,dl:()=>'',renderClubConnections:()=>'<h2>Dealership Mode</h2>',renderDealershipExit:()=>'',switchCollection:()=>{},render:()=>{},simpleForm:(title,body,save)=>{c.form={title,body,save};}});
 vm.runInContext(fs.readFileSync(require.resolve('../renderer/connections.js'),'utf8'),c);return c;
}
test('desktop library status reads only main identity/settings/file and does not hydrate collection records',()=>{
 const data={id:'canonical',settings:{name:'Main'}};for(const k of ['cars','events','parts','timing'])Object.defineProperty(data,k,{get(){throw Error('Hydrated '+k);}});
 const store={data,file:'C:/shared/library.sqlite'};assert.equal(libraryStatus(store,'root').databaseId,'canonical');assert.equal(libraryStatus(store,null).shared,false);
});
test('Connections has Dealership before Portal with no legacy or local HTTP toggles',()=>{
 const c=renderer(),html=vm.runInContext('renderConnections()',c);assert(html.indexOf('Dealership Mode')<html.indexOf('Paddock Portal'));assert(!html.includes('start-sharing'));assert(!html.includes('local-library-access'));assert(html.includes('connection-settings'));
});
test('fresh settings hide legacy controls behind explicit recovery; recovery does not call any service',async()=>{
 const c=renderer();c.api=()=>{throw Error('Service changed');};const before=vm.runInContext('renderIntegrationSettings()',c);assert(!before.includes('start-sharing'));assert(before.includes('legacy-recover'));assert(before.includes('Local service disabled'));assert(!before.includes('data-connection-panel="advanced" open'));
 await vm.runInContext("connectionSettingsAction('legacy-recover')",c);await assert.rejects(c.form.save({}),/Confirm/);assert(!vm.runInContext('legacyRecoveryEnabled',c));await c.form.save({confirmed:'yes'});assert(vm.runInContext('renderIntegrationSettings()',c).includes('start-sharing'));
});
test('active legacy connections remain reachable without recovery acknowledgement, even while Dealership is enabled',()=>{
 const c=renderer();c.net.remote={id:'remote',name:'Old host',state:'offline',permissions:{submit:true}};assert(vm.runInContext('renderIntegrationSettings()',c).includes('refresh-remote'));
 c.db.club={id:'club'};c.clubState={role:'coordinator'};c.net.sharing=true;c.net.hostingMode='dealership';const html=vm.runInContext('renderIntegrationSettings()',c);assert(html.includes('disconnect'));assert(!html.includes('start-sharing'));assert(!html.includes('set-host-password'));
});
test('pending submissions stay outside collapsed services and a replica offers the personal collection before retry',()=>{
 const c=renderer();c.net.pending={hostId:'remote',name:'Old host',count:1};c.net.remote={id:'remote',name:'Old host',state:'connected',permissions:{submit:true}};c.db.club={replica:true};c.clubState={active:true};const html=vm.runInContext('renderIntegrationSettings()',c);assert(html.indexOf('Submission awaiting acknowledgement')<html.indexOf('data-connection-panel="advanced"'));assert(html.includes('legacy-personal'));assert(!html.includes('data-action="retry-submission"'));
 assert(vm.runInContext('renderSharedLibraryStatus()',c).includes('C:/personal/library.sqlite'));assert(vm.runInContext('renderSharedLibraryStatus()',c).includes('viewing a Dealership copy'));
});
test('wrong-host retry asks for original host; paths and network-controlled names are escaped',()=>{
 const c=renderer();c.net.pending={hostId:'original',name:'<script>bad</script>',count:1};c.net.remote={id:'other'};const html=vm.runInContext('renderPendingSubmission()',c);assert(html.includes('Reconnect to original host'));assert(!html.includes('data-action="retry-submission"'));assert(!html.includes('<script>'));
 c.net.sharedFile.file='<img src=x>';assert(vm.runInContext('renderSharedLibraryStatus()',c).includes('&lt;img src=x&gt;'));
});
test('desktop shared-file path is not exposed by public status HTTP',async t=>{
 const {Network}=require('../src/network.cjs'),{Store}=require('../src/store.cjs');const host=new Network(new Store());host.sharedFileStatus=()=>({file:'private-library-path'});await host.start();t.after(()=>host.stop());assert.equal(host.status().sharedFile.file,'private-library-path');const r=await fetch('http://127.0.0.1:'+host.port+'/v1/status',{headers:{Authorization:'Bearer '+host.browseCode}});assert.equal(r.status,200);assert(!JSON.stringify(await r.json()).includes('private-library-path'));
});
