(function(root){
  // One inventory assignment per technical position; paired positions have editable quantities.
  const slots=[
    ['guideScrew','Guide screw','',1,['Screw']],
    ['guide','Guide','guide',1,['Guide','Guide holder']],
    ['braids','Pickup braids','braids',2,['Braids','Pickup shoe']],
    ['frontTyres','Front tyres','frontTyres',2,['Tyre','Wheel & tyre set']],
    ['frontWheels','Front wheels','frontWheels',2,['Wheel','Hub','Wheel & tyre set']],
    ['frontBearings','Front bearings / bushings','frontBearings',2,['Bearing','Bushing']],
    ['frontAxle','Front axle','frontAxle',1,['Axle','Independent axle']],
    ['chassis','Chassis','chassis',1,['Chassis','Chassis section']],
    ['fasteners','Mounting screws','fasteners',2,['Screw','Mounting hardware']],
    ['pod','Motor pod','pod',1,['Motor pod','Motor bracket']],
    ['wiring','Motor leads','wiring',1,['Wire','Connector','Terminal / eyelet']],
    ['motor','Motor','motor',1,['Motor','Brushless motor']],
    ['pinionPart','Pinion','pinionPart',1,['Pinion']],
    ['gearPart','Crown / axle gear','gearPart',1,['Crown gear','Spur gear','Anglewinder gear']],
    ['rearTyres','Rear tyres','rearTyres',2,['Tyre','Wheel & tyre set']],
    ['rearWheels','Rear wheels','rearWheels',2,['Wheel','Hub','Wheel & tyre set']],
    ['rearBearings','Rear bearings / bushings','rearBearings',2,['Bearing','Bushing']],
    ['rearAxle','Rear axle','rearAxle',1,['Axle','Independent axle']],
    ['body','Body','body',1,['Body shell']],
    ['lights','Lighting','lights',1,['Lighting']],
    ['chip','Decoder / electronics','chip',1,['Digital decoder','Brushless ESC']],
    ['magnets','Traction magnets','magnets',1,['Traction magnet']],
    ['ballast','Ballast','ballast',1,['Ballast']],
    ['suspension','Suspension','suspension',1,['Suspension kit','Suspension spring']]
  ].map(([id,label,field,quantity,types])=>({id,label,field,quantity,types}));
  const blank=()=>({name:'',maker:'',scale:'',notes:'',usage:[],saveSetup:true,parts:[],assemblies:[],gearing:{pinion:'',gear:''}});
  const signature=a=>JSON.stringify(a.components.map(c=>[c.partId,c.quantity,c.field,c.position]));
  const toothCount=value=>typeof value==='string'&&/^\d+$/.test(value.trim())&&Number.isSafeInteger(Number(value))&&Number(value)>0?String(Number(value)):'';
  function partTeeth(part){
    const specs=(part?.catalogue?.product?.specifications||part?.catalogue?.specifications||[]).filter(s=>['teeth','tooth count','number of teeth'].includes(s.name.trim().toLowerCase()));
    if(!specs.length||specs.some(s=>!toothCount(s.value)||!['','t','tooth','teeth'].includes(s.unit.trim().toLowerCase())))return '';
    const counts=[...new Set(specs.map(s=>toothCount(s.value)))];return counts.length===1?counts[0]:'';
  }
  function gearing(data,db){
    return Object.fromEntries([['pinion','pinionPart'],['gear','gearPart']].map(([key,field])=>{
      const ids=data.parts.filter(r=>r.slot===field).map(r=>r.partId);
      for(const chosen of data.assemblies){const a=db.assemblies.find(a=>a.id===chosen.id&&!a.dismantled);if(a)ids.push(...a.components.filter(c=>c.field===field).map(c=>c.partId));}
      const part=ids.length===1?db.parts.find(p=>p.id===ids[0]):null,automatic=partTeeth(part),manual=data.gearing?.[key]||'';
      return [key,{value:manual?toothCount(manual):automatic,automatic,manual:!!manual,partName:part?.name||''}];
    }));
  }
  const api={slots,blank,signature,toothCount,gearing};if(typeof module==='object'&&module.exports)module.exports=api;else root.BuildModel=api;
})(globalThis);
