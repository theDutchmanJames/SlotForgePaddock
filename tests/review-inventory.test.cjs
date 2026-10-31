const test=require('node:test');
const assert=require('node:assert/strict');
const {Store}=require('../src/store.cjs');
const {available}=require('../src/workshop.cjs');
test('mixed workshop operations conserve physical stock and failed operations leave no partial changes',()=>{
  const s=new Store();let seed=73129;const random=n=>{seed=(seed*1664525+1013904223)>>>0;return (seed>>>8)%n;},pick=items=>items.length?items[random(items.length)]:null;
  for(let n=0;n<5;n++)s.mutate('car.save',{data:{name:'Car '+n}});
  for(let n=0;n<10;n++)s.mutate('part.save',{data:{name:'Component '+n,tracking:n<3?'individual':'quantity',quantity:n<3?1:8,category:'Other'}});
  const total=s.data.parts.reduce((n,p)=>n+p.quantity,0),successful=new Set();let count=0;
  for(let n=0;n<350;n++){
    const before=s.snapshot(),car=pick(s.data.cars),free=pick(s.data.parts.filter(p=>available(s.data,p)>0)),installed=pick(s.data.installations.filter(i=>!i.removed&&!i.assemblyId)),assembly=pick(s.data.assemblies.filter(a=>!a.dismantled)),setup=pick(s.data.setups);let action,payload;
    switch(random(8)){
      case 0:if(free){action='part.install';payload={carId:car.id,partId:free.id,quantity:1,field:pick(['motor','rearTyres',''])};}break;
      case 1:if(installed){action='part.remove';payload={id:installed.id,destination:'spares'};}break;
      case 2:if(free){action='assembly.create';payload={name:'Group '+n,components:[{partId:free.id,quantity:1,field:'',position:'Group component'}]};}break;
      case 3:if(assembly){action='assembly.install';payload={id:assembly.id,carId:car.id,allowTransfer:true};}break;
      case 4:if(assembly?.carId){action='assembly.remove';payload={id:assembly.id,location:'Drawer'};}break;
      case 5:if(assembly){action='assembly.dismantle';payload={id:assembly.id};}break;
      case 6:action='setup.save';payload={carId:car.id,name:'Setup '+n};break;
      case 7:if(setup){const options=s.plan('setup.options',{id:setup.id});action='setup.apply';payload={id:setup.id,confirmed:true,allowTransfers:true,selections:Object.fromEntries(options.rows.map(r=>[r.key,r.selected||r.choices[0]?.value||'']))};}break;
    }
    if(!action)continue;
    try{s.mutate(action,{...payload,revision:s.data.revision});successful.add(action);count++;}catch(e){assert.match(e.message,/stock|component|position|already|assembly|Choose|Insufficient|available|occupied/i);assert.deepEqual(s.snapshot(),before);}
    assert.equal(s.data.parts.reduce((n,p)=>n+p.quantity,0),total,'Physical stock count changed during '+action);
    for(const p of s.data.parts)assert.ok(available(s.data,p)>=0);
    for(const p of s.data.parts.filter(p=>p.tracking==='individual'))assert.ok(s.data.installations.filter(i=>!i.removed&&i.partId===p.id).length<=1);
  }
  assert.ok(count>100);assert.equal(successful.size,8);
});
