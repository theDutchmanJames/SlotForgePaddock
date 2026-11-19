'use strict';
// The groups and labels of a car's technical specification, used by the app and the printed reports.
(function (root) {
  const groups = {
    'Motor & transmission': [
      ['motor', 'Motor'],
      ['motorLayout', 'Motor layout'],
      ['pod', 'Motor pod'],
      ['podSettings', 'Pod settings'],
      ['ratedRpm', 'Rated no-load RPM'],
      ['ratedVoltage', 'Rated at (V)'],
      ['motorType', 'Motor type'],
      ['motorTorque', 'Motor torque (gf·cm)'],
      ['torqueType', 'Torque rating type'],
      ['torqueVoltage', 'Torque rated at (V)'],
      ['measuredRpm', 'Measured RPM'],
      ['measuredVoltage', 'Measured at (V)'],
      ['measuredDate', 'Measurement date'],
      ['pinionPart', 'Pinion component'],
      ['pinion', 'Pinion teeth'],
      ['gearPart', 'Driven gear component'],
      ['gear', 'Driven gear teeth'],
      ['gearType', 'Gear type / pitch']
    ],
    'Body & chassis': [
      ['body', 'Body'],
      ['bodyMaterial', 'Body material'],
      ['bodySettings', 'Body screw settings'],
      ['chassis', 'Chassis'],
      ['wheelbase', 'Wheelbase (mm)'],
      ['weight', 'Total weight (g)'],
      ['clearance', 'Ground clearance (mm)']
    ],
    'Wheels tyres & axles': [
      ['frontAxle', 'Front axle'],
      ['rearAxle', 'Rear axle'],
      ['frontBearings', 'Front bearings'],
      ['rearBearings', 'Rear bearings'],
      ['frontWheels', 'Front wheels'],
      ['rearWheels', 'Rear wheels'],
      ['frontTyres', 'Front tyres'],
      ['rearTyres', 'Rear tyres'],
      ['frontDiameter', 'Front tyre diameter (mm)'],
      ['rearDiameter', 'Rear tyre diameter (mm)'],
      ['frontWidth', 'Front track width (mm)'],
      ['rearWidth', 'Rear track width (mm)'],
      ['frontAxlePlay', 'Front axle play'],
      ['rearAxlePlay', 'Rear axle play']
    ],
    'Guide electrical & fittings': [
      ['guide', 'Guide'],
      ['braids', 'Braids'],
      ['wiring', 'Wiring'],
      ['lights', 'Lighting'],
      ['digitalSystem', 'Digital system'],
      ['chip', 'Decoder'],
      ['magnets', 'Magnets'],
      ['ballast', 'Ballast / placement'],
      ['suspension', 'Suspension'],
      ['fasteners', 'Fasteners'],
      ['technicalNotes', 'Technical notes']
    ]
  };
  if (typeof module === 'object' && module.exports) module.exports = groups;
  else root.TechGroups = groups;
})(globalThis);
