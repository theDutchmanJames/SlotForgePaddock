(function(root){
  function cars(data,filters={}){
    const query=String(filters.query||'').trim().toLocaleLowerCase();
    return data.cars.filter(c=>!c.archived&&c.collectionStatus!=='wishlist'&&(!filters.favourites||c.favourite===true)&&(!filters.usage||(c.usage||[]).includes(filters.usage))&&(!query||[c.name,c.number,c.maker,c.marque,c.model,c.reference,...(c.tags||[])].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>{
      const value=filters.sort==='maker'?String(a.maker||'').localeCompare(String(b.maker||'')):filters.sort==='updated'?String(b.updated||'').localeCompare(String(a.updated||'')):0;
      return value||String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id));
    });
  }
  function photos(car){const result=[],seen=new Set();for(const p of [{data:car.picture,name:'Main photograph'},...(car.photos||[])])if(typeof p.data==='string'&&(/^data:image\/(png|jpeg|webp);base64,/.test(p.data)||/^paddock-media:\/\/image\/[0-9a-f-]{36}$/.test(p.data))&&!seen.has(p.data)){seen.add(p.data);result.push({data:p.data,name:p.name||'Photograph'});}return result;}
  function featured(list,id){return list.find(c=>c.id===id)||list.find(c=>photos(c).length)||list[0]||null;}
  function options(value={}){
    if(!value||typeof value!=='object')value={};
    return {mode:['fixed','startup','visit','rotate'].includes(value.mode)?value.mode:'fixed',
      carId:typeof value.carId==='string'?value.carId:'',
      source:['all','usage','group','favourites'].includes(value.source)?value.source:'all',
      groupId:typeof value.groupId==='string'?value.groupId:'',
      labels:Array.isArray(value.labels)?[...new Set(value.labels.filter(x=>typeof x==='string'))]:[],
      photosOnly:value.photosOnly===true,shuffle:value.shuffle===true,
      seconds:Number.isFinite(Number(value.seconds))?Math.min(3600,Math.max(5,Math.round(Number(value.seconds)))):15,
      layout:value.layout==='photo'?'photo':'history'};
  }
  function candidates(all,groups,value){
    const o=options(value),active=cars({cars:all}),group=groups.find(g=>g.id===o.groupId);
    const byId=new Map(active.map(c=>[c.id,c])),list=o.source==='group'?(group?.carIds||[]).map(id=>byId.get(id)).filter(Boolean):active;
    return list.filter(c=>(o.source!=='usage'||o.labels.some(x=>(c.usage||[]).includes(x)))&&(o.source!=='favourites'||c.favourite===true)&&(!o.photosOnly||(typeof c.hasPhoto==='boolean'?c.hasPhoto:!!c.picture)));
  }
  // Seeded order remains stable across page refreshes and lazy view requests.
  function ordered(list,shuffle,seed=1){
    const out=[...list];if(!shuffle)return out;let state=Number(seed)>>>0;
    for(let i=out.length-1;i>0;i--){state=(Math.imul(state,1664525)+1013904223)>>>0;const j=Math.floor(state/4294967296*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;
  }
  function cover(all,groups,value,{id='',avoid='',seed=1}={}){
    const o=options(value),active=cars({cars:all});
    if(o.mode==='fixed')return active.find(c=>c.id===o.carId)||active.find(c=>c.hasPhoto??!!c.picture)||active[0]||null;
    const list=candidates(all,groups,o);if(!list.length)return null;
    const selected=list.find(c=>c.id===id);if(selected)return selected;
    const pool=list.length>1?list.filter(c=>c.id!==avoid):list;
    return ordered(pool,o.mode!=='rotate'||o.shuffle,seed)[0];
  }
  const api={cars,photos,featured,options,candidates,ordered,cover};root.ShowroomModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
