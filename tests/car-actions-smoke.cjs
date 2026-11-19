'use strict';
// Quick archive and delete on car cards and for selected cars (including cars on another page).
const assert=require('node:assert/strict');
module.exports=async({store,js,wait,click,submit})=>{
 const checks=[];
 const idle=()=>wait('!viewPendingKey&&!actionBusy&&!modalSaving');
 const names=Array.from({length:52},(_,i)=>'Quick '+String(i+1).padStart(3,'0'));
 for(const name of names)store.mutate('car.save',{data:{name,maker:'NSR',scale:'1:32'}});
 const idOf=name=>store.data.cars.find(c=>c.name===name).id;
 const car=name=>store.data.cars.find(c=>c.name===name);
 await js(`(async()=>{const r=await api('read');acceptSnapshot(r.data);switchCollection('local');page='Cars';carId=null;query='Quick';usage=[];archived=false;selected.clear();sort='name';sortDirection='asc';await loadView();})()`);
 await idle();
 // One car: archive, then restore from the archived view.
 const first=idOf('Quick 001');
 assert.equal(await js(`!!document.querySelector('.car-card [data-action="car-quick-archive"][data-id="${first}"]')`),true);
 assert.equal(await js(`document.querySelector('[data-action="car-quick-archive"][data-id="${first}"]').getAttribute('aria-label')`),'Archive Quick 001');
 await click(`[data-action="car-quick-archive"][data-id="${first}"]`);await idle();
 assert.equal(car('Quick 001').archived,true);
 assert.equal(await js(`!!document.querySelector('[data-action="car-quick-archive"][data-id="${first}"]')`),false);
 await js(`(async()=>{archived=true;await loadView();})()`);await idle();
 assert.equal(await js(`document.querySelector('[data-action="car-quick-archive"][data-id="${first}"]').getAttribute('aria-label')`),'Restore Quick 001');
 await click(`[data-action="car-quick-archive"][data-id="${first}"]`);await idle();
 assert.equal(car('Quick 001').archived,false);
 await js(`(async()=>{archived=false;await loadView();})()`);await idle();
 checks.push('Card archive icon archives a car and restores it from the archived view');
 // One car: the bin asks once, Cancel keeps the car, Delete permanently removes it.
 const second=idOf('Quick 002');
 await click(`[data-action="car-quick-delete"][data-id="${second}"]`);
 assert.equal(await js('document.querySelector("#dialog").open'),true);
 assert.match(await js('document.querySelector("#dialog").textContent'),/cannot be undone/);
 await click('[data-action="close-modal"]');await idle();
 assert.ok(car('Quick 002'),'Cancel keeps the car');
 await click(`[data-action="car-quick-delete"][data-id="${second}"]`);await submit();await idle();
 assert.equal(car('Quick 002'),undefined);
 assert.equal(await js(`!!document.querySelector('[data-id="${second}"]')`),false);
 checks.push('Card bin deletes one car after one confirmation; Cancel keeps it');
 // Selected cars, one of them on the second page (not loaded).
 const onPage=['Quick 003','Quick 004'].map(idOf),later=idOf('Quick 052');
 assert.equal(await js(`db.cars.some(c=>c.id==='${later}')`),false,'the last car is on another page');
 await js(`selected=new Set(${JSON.stringify([...onPage,later])});render()`);
 assert.equal(await js('!!document.querySelector(".selection-bar [data-action=cars-archive-selected]")'),true);
 await click('[data-action="cars-archive-selected"]');await idle();
 assert.deepEqual([...onPage,later].map(id=>store.data.cars.find(c=>c.id===id).archived),[true,true,true]);
 assert.equal(await js('selected.size'),0);
 await js(`(async()=>{archived=true;await loadView();selected=new Set(${JSON.stringify([...onPage,later])});render()})()`);await idle();
 assert.match(await js('document.querySelector("[data-action=cars-archive-selected]").textContent'),/Restore selected/);
 await click('[data-action="cars-archive-selected"]');await idle();
 assert.deepEqual([...onPage,later].map(id=>store.data.cars.find(c=>c.id===id).archived),[false,false,false]);
 await js(`(async()=>{archived=false;await loadView();})()`);await idle();
 checks.push('Archive selected and Restore selected change every selected car, also on other pages');
 const doomed=['Quick 005','Quick 006','Quick 051'].map(idOf);
 await js(`selected=new Set(${JSON.stringify(doomed)});render()`);
 await click('[data-action="cars-delete-selected"]');
 assert.match(await js('document.querySelector("#dialog").textContent'),/Delete 3 cars/i);
 assert.match(await js('document.querySelector("#dialog").textContent'),/Quick 051/);
 await submit();await idle();
 assert.deepEqual(doomed.map(id=>!!store.data.cars.find(c=>c.id===id)),[false,false,false]);
 assert.ok(car('Quick 007'),'cars that were not selected stay');
 assert.equal(await js('selected.size'),0);
 checks.push('Delete selected removes exactly the selected cars after one confirmation');
 // Leave the collection as other checks expect it.
 for(const c of store.data.cars.filter(c=>/^Quick \d{3}$/.test(c.name)))store.mutate('car.delete',{id:c.id,revision:store.data.revision,confirmName:c.name,confirmed:true});
 await js(`(async()=>{const r=await api('read');acceptSnapshot(r.data);query='';selected.clear();page='Overview';render();})()`);
 return checks;
};
