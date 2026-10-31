(function(root){
  const parts={
    'Body & interior':['Body shell','Wing / spoiler','Mirror','Glazing','Bumper / splitter','Cockpit','Driver','Interior detail','Decals','Body detail'],
    'Chassis & mounting':['Chassis','Chassis section','Subframe','Body mount','Motor pod','Motor bracket','Adapter','Retainer'],
    'Motors & motor parts':['Motor','Brushless motor','Armature','Endbell','Brushes','Brush springs','Brush holders','Motor magnets'],
    'Gears & transmission':['Pinion','Crown gear','Spur gear','Anglewinder gear','Pulley','Drive belt','Gear set'],
    'Axles & bearings':['Axle','Independent axle','Axle support','Bushing','Bearing','Spacer / shim','Axle collar'],
    'Wheels & tyres':['Wheel','Hub','Wheel insert','Tyre','Wheel & tyre set'],
    'Guides & pickups':['Guide','Guide pin','Guide holder','Braids','Pickup shoe','Pickup spring','Contact plate'],
    'Wiring & electronics':['Wire','Connector','Terminal / eyelet','Digital decoder','Brushless ESC','Lighting','Suppression component'],
    'Suspension & handling':['Suspension kit','Suspension spring','Traction magnet','Magnet holder','Ballast'],
    'Screws & fixings':['Screw','Grub screw','Nut','Washer','Clip','Mounting hardware'],
    'Other & custom parts':['Custom part','Other']
  };
  const supplies={
    'Hand tools':['Screwdriver','Hex driver','Pliers','Cutter','Tweezers','File','Wrench / spanner','Driver bit'],
    'Measuring & setup tools':['Calipers','Scales','Setup plate','Ride-height gauge','Gear-mesh tool','Setup gauge','Work mat'],
    'Tyre & wheel equipment':['Tyre truer','Sanding equipment','Wheel puller','Balancing equipment'],
    'Motor & electrical equipment':['Motor tester','RPM meter','Multimeter','Soldering equipment','Bench power supply'],
    'Cleaning & lubrication':['Cleaner','Cleaning brush','Cloth','Bearing oil','Gear grease','Tyre treatment'],
    'Adhesives & consumables':['Glue','Tape','Solder','Flux','Heat-shrink','Abrasive','Paint'],
    'Storage & transport':['Toolbox','Race case','Parts organiser','Storage tray']
  };
  const aliases={Body:['Body & interior','Body shell'],Chassis:['Chassis & mounting','Chassis'],'Motor pod':['Chassis & mounting','Motor pod'],Motor:['Motors & motor parts','Motor'],Gears:['Gears & transmission','Spur gear'],Axle:['Axles & bearings','Axle'],Bearings:['Axles & bearings','Bearing'],Wheels:['Wheels & tyres','Wheel'],Tyres:['Wheels & tyres','Tyre'],Guide:['Guides & pickups','Guide'],Braids:['Guides & pickups','Braids'],Wiring:['Wiring & electronics','Wire'],Decoder:['Wiring & electronics','Digital decoder'],Magnets:['Suspension & handling','Traction magnet'],Ballast:['Suspension & handling','Ballast'],Suspension:['Suspension & handling','Suspension kit'],Fasteners:['Screws & fixings','Screw'],Other:['Other & custom parts','Other']};
  function classify(category,type=''){if(Object.hasOwn(parts,category))return {category,partType:type};const pair=Object.hasOwn(aliases,category)?aliases[category]:['Other & custom parts',category||'Other'];return {category:pair[0],partType:type||pair[1]};}
  const value={parts,supplies,classify};if(typeof module==='object'&&module.exports)module.exports=value;else root.slotforgeCatalogue=value;
})(globalThis);
