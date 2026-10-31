(function(root){
  const defaults={details:['owner','location','raceClass','availability'],configuration:['tech_motor','gearing','gearRatio','tech_rearTyres','tech_weight']};
  function fields(columns,section){return section==='details'?columns.filter(f=>!f.key.startsWith('tech_')&&f.key!=='picture'):section==='configuration'?[{key:'gearing',label:'Gearing'},{key:'gearRatio',label:'Gear ratio'},...columns.filter(f=>f.key.startsWith('tech_'))]:[];}
  function read(settings){return Object.fromEntries(Object.entries(defaults).map(([section,keys])=>[section,[...(settings?.overviewLayout?.[section]||keys)]]));}
  function validate(layout,columns){
    if(!layout||typeof layout!=='object'||Array.isArray(layout)||Object.keys(layout).length!==2||Object.keys(layout).some(k=>!Object.hasOwn(defaults,k)))throw Error('Invalid car overview layout.');
    for(const section of Object.keys(defaults)){const keys=layout[section],allowed=new Set(fields(columns,section).map(f=>f.key));if(!Array.isArray(keys)||keys.length>16||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!allowed.has(k)))throw Error('Choose up to 16 different fields for each overview panel.');}
    return layout;
  }
  function value(car,key){if(key.startsWith('tech_'))return car.technical?.[key.slice(5)]??'';if(key.startsWith('custom_'))return car.custom?.[key.slice(7)]??'';return car[key]??'';}
  const api={defaults,fields,read,validate,value};if(typeof module==='object'&&module.exports)module.exports=api;else root.OverviewLayout=api;
})(globalThis);
