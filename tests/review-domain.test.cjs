const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {reminders,componentFields}=require('../renderer/domain.js');
const {COMPONENT_FIELDS}=require('../src/store.cjs');
test('backdated work does not replace a more recent service reminder',()=>{
  const events=[{carId:'car',type:'maintenance',title:'Braids',task:' BRAIDS ',date:'2026-10-30T12:00:00Z',performedDate:'2026-09-01',nextDue:'2026-09-20'},{carId:'car',type:'maintenance',title:'Braids',task:'Braids',date:'2026-10-29T12:00:00Z',performedDate:'2026-10-29',nextDue:'2026-11-29'}];assert.deepEqual(reminders(events),[events[1]]);
  events.unshift({...events[1],date:'2026-10-31T12:00:00Z',performedDate:'2026-10-31',nextDue:''});assert.deepEqual(reminders(events),[]);
});
test('calendar dates and today use local dates on either side of UTC',()=>{
  const modulePath=require.resolve('../renderer/domain.js');
  for(const [zone,expected]of [['America/Los_Angeles','2026-01-01'],['Pacific/Kiritimati','2026-01-02']]){
    const code=`const d=require(${JSON.stringify(modulePath)});console.log(JSON.stringify([d.displayDate('2026-10-30'),d.today(new Date('2026-01-01T11:30:00Z'))]));`;
    const child=spawnSync(process.execPath,['-e',code],{encoding:'utf8',env:{...process.env,TZ:zone}});assert.equal(child.status,0,child.stderr);const [display,today]=JSON.parse(child.stdout);assert.match(display,/30/);assert.equal(today,expected);
  }
});
test('the component selectors match the backend allowed fields',()=>assert.deepEqual(componentFields,COMPONENT_FIELDS));
