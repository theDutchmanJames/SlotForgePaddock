(function(root){
  const catalogue=typeof module==='object'&&module.exports?require('./catalogue.js'):root.slotforgeCatalogue;
  const groups={
    'Body & interior':['body-shell','rear-wing','door-mirrors','window-insert','front-bumper','front-splitter','cockpit-interior','driver-figure','dashboard','racing-seat','decal-sheet','racing-number-panels'],
    'Chassis & mounting':['chassis','chassis-section','chassis-subframe','body-mounting-posts','body-mounting-brackets','motor-pod','motor-bracket','motor-adapter-plate','motor-retainer','body-retaining-clips'],
    'Motors & motor parts':['short-can-motor','long-can-motor','brushless-motor','motor-armature','motor-endbell','motor-brushes','motor-brush-springs','brush-holders','motor-magnets'],
    'Gears & transmission':['motor-pinion','crown-gear','spur-gear','anglewinder-gear','pulley','drive-belt','belt-and-pulleys'],
    'Axles & bearings':['steel-axles','independent-axle','axle-support-blocks','flanged-bushings','ball-bearing','axle-spacers','axle-stopper'],
    'Wheels & tyres':['wheel-rim','wheel-hub','decorative-wheel-inserts','racing-tire','wheel-tyre-set'],
    'Guides & pickups':['guide-flag','guide-pin','guide-holder','guide-nut-and-spacers','pickup-braids','pickup-shoes','pickup-shoe-springs','electrical-contact-plates'],
    'Wiring & electronics':['wires-and-eyelets','plug-connectors','terminal-eyelet','digital-decoder','brushless-esc','lighting-kit','suppression-capacitor'],
    'Suspension & handling':['suspension-kit','suspension-springs','traction-magnet','magnet-holder','ballast-weights'],
    'Screws & fixings':['body-screws','grub-screws','hex-nut','washers'],
    'Other & custom parts':['custom-part','other-part','assembly'],
    'Hand tools':['screwdriver','hex-driver','pliers','cutter','tweezers','hand-file'],
    'Measuring & setup tools':['calipers','scales','setup-plate','ride-height-gauge','gear-mesh-tool'],
    'Tyre & wheel equipment':['tyre-truer','sanding-equipment','wheel-puller','wheel-balancer'],
    'Motor & electrical equipment':['motor-tester','rpm-meter','multimeter','soldering-iron','bench-power-supply'],
    'Cleaning & lubrication':['cleaner','cleaning-brush','cloth','bearing-oil','gear-grease'],
    'Adhesives & consumables':['glue','tape','solder','flux','heat-shrink','abrasive','paint'],
    'Storage & transport':['toolbox','race-case','parts-organiser','storage-tray']
  };
  const types={
    'Body detail':'body-shell','Gear set':'crown-gear','Wrench / spanner':'hex-driver','Driver bit':'screwdriver','Setup gauge':'ride-height-gauge','Work mat':'setup-plate','Tyre treatment':'bearing-oil',
    'Body shell':'body-shell','Wing / spoiler':'rear-wing','Mirror':'door-mirrors','Glazing':'window-insert','Bumper / splitter':'front-bumper','Cockpit':'cockpit-interior','Driver':'driver-figure','Interior detail':'dashboard','Decals':'decal-sheet',
    'Chassis':'chassis','Chassis section':'chassis-section','Subframe':'chassis-subframe','Body mount':'body-mounting-posts','Motor pod':'motor-pod','Motor bracket':'motor-bracket','Adapter':'motor-adapter-plate','Retainer':'motor-retainer',
    'Motor':'short-can-motor','Brushless motor':'brushless-motor','Armature':'motor-armature','Endbell':'motor-endbell','Brushes':'motor-brushes','Brush springs':'motor-brush-springs','Brush holders':'brush-holders','Motor magnets':'motor-magnets',
    'Pinion':'motor-pinion','Crown gear':'crown-gear','Spur gear':'spur-gear','Anglewinder gear':'anglewinder-gear','Pulley':'pulley','Drive belt':'drive-belt',
    'Axle':'steel-axles','Independent axle':'independent-axle','Axle support':'axle-support-blocks','Bushing':'flanged-bushings','Bearing':'ball-bearing','Spacer / shim':'axle-spacers','Axle collar':'axle-stopper',
    'Wheel':'wheel-rim','Hub':'wheel-hub','Wheel insert':'decorative-wheel-inserts','Tyre':'racing-tire','Wheel & tyre set':'wheel-tyre-set',
    'Guide':'guide-flag','Guide pin':'guide-pin','Guide holder':'guide-holder','Braids':'pickup-braids','Pickup shoe':'pickup-shoes','Pickup spring':'pickup-shoe-springs','Contact plate':'electrical-contact-plates',
    'Wire':'wires-and-eyelets','Connector':'plug-connectors','Terminal / eyelet':'terminal-eyelet','Digital decoder':'digital-decoder','Brushless ESC':'brushless-esc','Lighting':'lighting-kit','Suppression component':'suppression-capacitor',
    'Suspension kit':'suspension-kit','Suspension spring':'suspension-springs','Traction magnet':'traction-magnet','Magnet holder':'magnet-holder','Ballast':'ballast-weights',
    'Screw':'body-screws','Grub screw':'grub-screws','Nut':'hex-nut','Washer':'washers','Clip':'body-retaining-clips','Mounting hardware':'body-mounting-brackets','Custom part':'custom-part','Other':'other-part',
    'Screwdriver':'screwdriver','Hex driver':'hex-driver','Pliers':'pliers','Cutter':'cutter','Tweezers':'tweezers','File':'hand-file',
    'Calipers':'calipers','Scales':'scales','Setup plate':'setup-plate','Ride-height gauge':'ride-height-gauge','Gear-mesh tool':'gear-mesh-tool',
    'Tyre truer':'tyre-truer','Sanding equipment':'sanding-equipment','Wheel puller':'wheel-puller','Balancing equipment':'wheel-balancer',
    'Motor tester':'motor-tester','RPM meter':'rpm-meter','Multimeter':'multimeter','Soldering equipment':'soldering-iron','Bench power supply':'bench-power-supply',
    'Cleaner':'cleaner','Cleaning brush':'cleaning-brush','Cloth':'cloth','Bearing oil':'bearing-oil','Gear grease':'gear-grease',
    'Glue':'glue','Tape':'tape','Solder':'solder','Flux':'flux','Heat-shrink':'heat-shrink','Abrasive':'abrasive','Paint':'paint',
    'Toolbox':'toolbox','Race case':'race-case','Parts organiser':'parts-organiser','Storage tray':'storage-tray'
  };
  const labels={'racing-tire':'Racing tyre','brushless-esc':'Brushless ESC','rpm-meter':'RPM meter','terminal-eyelet':'Terminal / eyelet','wheel-tyre-set':'Wheel & tyre set'};
  const icons=Object.entries(groups).flatMap(([group,ids])=>ids.map(id=>({id,group,label:labels[id]||id.replaceAll('-',' ').replace(/^./,s=>s.toUpperCase())}))),ids=new Set(icons.map(i=>i.id));
  const colours={auto:'Theme default',red:'Red',blue:'Blue',green:'Green',amber:'Amber',purple:'Purple'};
  const typeLookup=new Map(Object.entries(types).map(([key,value])=>[key.toLowerCase(),value]));
  function automatic(item){const type=String(item.partType||'').trim().toLowerCase(),valid=Object.hasOwn(catalogue.parts,item.category)?catalogue.parts[item.category]:Object.hasOwn(catalogue.supplies,item.category)?catalogue.supplies[item.category]:[];return (valid.some(t=>t.toLowerCase()===type)?typeLookup.get(type):null)||(Object.hasOwn(groups,item.category)?groups[item.category][0]:'other-part');}
  function resolve(item){return ids.has(item.iconId)?item.iconId:automatic(item);}
  function validate(item){if(item.iconId!==undefined&&(typeof item.iconId!=='string'||item.iconId!==''&&!ids.has(item.iconId)))throw Error('Choose an icon from the library.');if(item.iconColour!==undefined&&(typeof item.iconColour!=='string'||!Object.hasOwn(colours,item.iconColour)))throw Error('Choose a preset icon colour.');}
  function fields(data,previous={}){const value={iconId:data.iconId??previous.iconId??'',iconColour:data.iconColour??previous.iconColour??'auto'};validate(value);return value;}
  const api={groups,types,icons,colours,automatic,resolve,validate,fields};if(typeof module==='object'&&module.exports)module.exports=api;else root.slotforgeIcons=api;
})(globalThis);
