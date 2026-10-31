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
  const blank=()=>({name:'',maker:'',scale:'',notes:'',usage:[],saveSetup:true,parts:[],assemblies:[]});
  const signature=a=>JSON.stringify(a.components.map(c=>[c.partId,c.quantity,c.field,c.position]));
  const api={slots,blank,signature};if(typeof module==='object'&&module.exports)module.exports=api;else root.BuildModel=api;
})(globalThis);
