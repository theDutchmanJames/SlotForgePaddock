(function(root){
  const componentFields=['body','chassis','motor','pod','pinionPart','gearPart','frontAxle','rearAxle','frontBearings','rearBearings','frontWheels','rearWheels','frontTyres','rearTyres','guide','braids','wiring','lights','chip','magnets','ballast','suspension','fasteners'];
  function today(date=new Date()){return date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');}
  function displayDate(value){if(!value)return '—';const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T12:00:00':value);return Number.isFinite(date.getTime())?date.toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):'Invalid date';}
  function reminders(events){const latest=new Map();for(const e of events.filter(e=>e.type==='maintenance')){const key=e.carId+'|'+(e.task||e.title).trim().toLowerCase(),prior=latest.get(key);const rank=x=>(x.performedDate||x.date.slice(0,10))+'|'+x.date;if(!prior||rank(e)>rank(prior))latest.set(key,e);}return [...latest.values()].filter(e=>e.nextDue).sort((a,b)=>a.nextDue.localeCompare(b.nextDue));}
  function gearRatio(pinion,gear){const teeth=value=>typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value.trim())?Number(value):NaN;const p=teeth(pinion),g=teeth(gear);return Number.isSafeInteger(p)&&Number.isSafeInteger(g)&&p>0&&g>0?g/p:null;}
  function gearRatioText(pinion,gear){const ratio=gearRatio(pinion,gear);return ratio===null?'':ratio.toFixed(3).replace(/(\.\d{2})0$/,'$1')+':1';}
  const isWishlist=car=>car?.collectionStatus==='wishlist';
  const activeCar=car=>!!car&&!car.archived&&!isWishlist(car);
  const api={isWishlist,activeCar,componentFields,today,displayDate,reminders,gearRatio,gearRatioText};if(typeof module==='object'&&module.exports)module.exports=api;else root.slotforgeDomain=api;
})(globalThis);
