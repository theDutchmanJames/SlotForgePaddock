const assert=require('node:assert/strict');
const {Store,makePackage}=require('../src/store.cjs');
const {Network}=require('../src/network.cjs');
module.exports=async({store,network,js,wait,click})=>{
  const hostStore=new Store();hostStore.mutate('car.save',{data:{name:'Review fixture'}});const host=new Network(hostStore),status=await host.start(),failures=[];
  try{
    await network.connect('127.0.0.1:'+status.port,status.code);await wait('!!net.remote');
    await js(`source='local';page='Connections';page='Connections';render();`);await click('[data-action="connect"]');host.controls({allowSubmissions:false});network.nextPoll=0;await network.poll();await wait('net.remote.permissions.submit===false');await click('[data-action="close-modal"]');
    try{await wait(`document.querySelector('#main').innerText.includes('Browse only')`);}catch{failures.push('Connection permissions remain stale after closing a dialog.');}
    await js(`switchCollection('local');page='Cars';render();document.querySelector('#car-search').focus();document.querySelector('#car-search').value='Smoke';document.querySelector('#car-search').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#car-search').setSelectionRange(2,2);`);
    store.mutate('submission.add',{package:makePackage(hostStore.data,[hostStore.data.cars[0].id])});network.onChange();await wait('db.revision==='+store.data.revision);
    if(await js('document.activeElement.id')!=='car-search')failures.push('A new submission steals focus from the local car search.');
    else assert.equal(await js(`document.querySelector('#car-search').selectionStart`),2);
    assert.deepEqual(failures,[]);return ['deferred connection permissions update after dialog closes','incoming submissions preserve local search focus and caret'];
  }finally{network.disconnect();await host.stop();}
};
