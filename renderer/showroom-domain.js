(function(root){
  function cars(data,filters={}){
    const query=String(filters.query||'').trim().toLocaleLowerCase();
    return data.cars.filter(c=>!c.archived&&(!filters.favourites||c.favourite===true)&&(!filters.usage||(c.usage||[]).includes(filters.usage))&&(!query||[c.name,c.number,c.maker,c.marque,c.model,c.reference,...(c.tags||[])].join(' ').toLocaleLowerCase().includes(query))).sort((a,b)=>{
      const value=filters.sort==='maker'?String(a.maker||'').localeCompare(String(b.maker||'')):filters.sort==='updated'?String(b.updated||'').localeCompare(String(a.updated||'')):0;
      return value||String(a.name).localeCompare(String(b.name))||String(a.id).localeCompare(String(b.id));
    });
  }
  function photos(car){const result=[],seen=new Set();for(const p of [{data:car.picture,name:'Main photograph'},...(car.photos||[])])if(typeof p.data==='string'&&(/^data:image\/(png|jpeg|webp);base64,/.test(p.data)||/^paddock-media:\/\/image\/[0-9a-f-]{36}$/.test(p.data))&&!seen.has(p.data)){seen.add(p.data);result.push({data:p.data,name:p.name||'Photograph'});}return result;}
  function featured(list,id){return list.find(c=>c.id===id)||list.find(c=>photos(c).length)||list[0]||null;}
  const api={cars,photos,featured};root.ShowroomModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
