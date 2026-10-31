# Theoretical performance

In **Parts → Build from Scratch**, enter tooth counts in **Gearing calculator**, then add optional **Motor & tyres** specifications. Results appear in **Theoretical performance** below the chassis drawing. Empty inputs are welcome: the panel calculates only what the available information supports.

## Inputs

- **No-load motor RPM** and the voltage at which that speed was specified.
- **Motor torque in gf·cm** (gram-force centimetres), commonly printed as g·cm. This is force multiplied by distance, not g/cm.
- The **torque test voltage**, recorded separately. Do not mix ratings measured at different voltages for a power calculation.
- **Torque rating type:** Stall, Rated running, or Unknown. Leave it Unknown if the manufacturer does not identify it.
- **Motor type:** Brushed DC, Brushless, or Unknown.
- **Rear tyre outside diameter in millimetres**, including the tyre on the wheel. Use the actual fitted diameter after truing where possible.

Motor and tyre entries are manual specifications, independent of inventory selection. Recheck them when changing parts. Pinion and crown / axle gear counts retain their existing automatic catalogue lookup and manual overrides.

## Results and formulas

Let R be driven-gear teeth divided by pinion teeth, n be no-load motor RPM, D be tyre diameter in metres, and T be motor torque in N·m. One gf·cm equals 0.0000980665 N·m.

| Result | Calculation |
| --- | --- |
| Gear ratio | Driven teeth ÷ pinion teeth |
| No-load axle RPM | n ÷ R |
| Rollout, mm per motor revolution | π × D × 1000 ÷ R |
| No-load theoretical speed, km/h | (n ÷ R) × π × D × 60 ÷ 1000 |
| Rear-axle torque from the entered rating | T × R |
| Driving force at that rating, N | (T × R) ÷ (D / 2) |

Axle torque and force require a confirmed Stall or Rated running torque type. Stall force describes zero speed; rated running torque describes the manufacturer's rated operating point. Neither is the torque available at the no-load speed shown elsewhere in the panel. Motor torque refers to the single driven axle's total torque, not torque per rear wheel.

These are ideal kinematic and torque calculations. They omit gear/bearing losses, tyre slip, track grip, supply sag, temperature, rotating inertia and aerodynamic load. They do not predict acceleration, lap time or actual top speed.

## Curves and peak power

Curves require all of the following:

1. A **Brushed DC** motor.
2. Confirmed **Stall** torque.
3. Positive no-load RPM and torque values.
4. Positive, matching RPM and torque test voltages.

The model assumes torque falls linearly from stall torque at zero RPM to zero external torque at no-load RPM. At speed fraction f, torque is Tstall × (1 − f), RPM is n × f, and shaft power is torque in N·m × RPM × 2π / 60.

Estimated peak mechanical power is Tstall × (n × 2π / 60) ÷ 4, at half the no-load RPM and half the stall torque. It is **not a continuous power rating**, electrical input power, or measured track performance. A gearbox trades speed for torque; it does not increase motor power. Brushless motors and unknown torque definitions do not use this model.

Move the motor-speed slider to inspect torque, power, axle RPM, theoretical speed and driving force at the same operating point. For example, 21,500 RPM, 285 gf·cm stall torque at 12 V, 9/27 gears and 20 mm tyres give about 7,167 no-load axle RPM, 27.02 km/h ideal no-load speed, 855 gf·cm axle stall torque and 15.73 W estimated peak motor power. These maxima occur at different operating points.

## Compare, save and revisit

Choose **Keep current as reference**, then change a specification. The table shows reference/current values and differences; changing a motor's rating conditions is identified rather than presented as a like-for-like torque/power comparison. Replace or clear the reference whenever needed. Reference snapshots do not reserve or move stock.

Drafts and complete backups preserve both inputs and the reference. Creating a car saves its specifications in **Technical & parts**, its creation history and, when enabled, its **As built** setup. The reference remains a planning aid in drafts and is not added to the car or shared packages. Motor specifications themselves follow the normal car/setup sharing rules. Saved setups remain unchanged when current car specifications are edited.

These calculations are included in **v0.17.0 and newer**. The original v0.16.3 release download predates this feature.

For background, see [Slot.it's explicit stall-torque specification](https://www.slot.it/immagini/schede_prod_EN/motors_GB/MN09ch_EN.pdf), [Pololu's explanation of motor torque, speed and power](https://www.pololu.com/docs/0j21/all), and [DIDEL's DC motor performance explanation](https://www.didel.com/microkit/moteurs/Motors.html).
