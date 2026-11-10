'use strict';
const JobTypes=(()=>{
 const types=[['general','General Work','tool','amber'],['maintenance','Maintenance','tool','blue'],['upgrades','Upgrades','plus','green'],['overhaul','Overhaul','tool','violet'],['rebuild','Rebuild','assembly','amber'],['chassis','Chassis','box','blue'],['tyres','Tyres','car','green'],['motor','Motor','box','amber'],['braids','Braids','tool','blue'],['balancing','Balancing','setup','violet'],['front-assembly','Front Assembly','assembly','blue'],['rear-assembly','Rear Assembly','assembly','green'],['bodywork','Bodywork','car','violet']].map(([id,label,icon,tone])=>({id,label,icon,tone}));
 const valid=value=>types.some(t=>t.id===value),get=value=>types.find(t=>t.id===value)||types[0];
 return {types,valid,get};
})();
if(typeof module==='object')module.exports=JobTypes;
