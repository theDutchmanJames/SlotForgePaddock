const {Store}=require('../../src/store.cjs');
const timing=require('../../src/timing-integration.cjs');
function fixtures(store=new Store()){
  const add=(id,name)=>{store.mutate('car.save',{data:{name,maker:'Example maker',raceClass:'GT3',technical:{motor:'21.5k',pinion:'9',gear:'27',technicalNotes:'private technical note'},privateNotes:'private ownership note',owner:'Private owner'}});const original=store.data.cars.at(-1).id;store.data.cars.at(-1).id=id;for(const event of store.data.events)if(event.carId===original)event.carId=id;};
  // Deterministic, artificial database for documentation and tests; never user data.
  store.data.id='paddock-demo';store.data.settings.name='Timing integration demo';store.data.timing.key='1'.repeat(64);
  add('car-a','Example GT3');add('car-b','Example prototype');
  // Mutating fixture IDs above requires repairing the creation-event references.
  store.data.events=[];
  const profiles=['car-a','car-b'].map(id=>timing.profile(store,id));
  for(const p of profiles){p.configuration.capturedAt='2026-10-31T10:00:00.000Z';const {signature,...unsigned}=p.configuration;p.configuration.signature=require('node:crypto').createHmac('sha256',store.data.timing.key).update(timing.canonical(unsigned)).digest('hex');}
  const stint=(id='stint-1',heatId='heat-1',driverId='driver-1',lane=1,start=0,end=60000)=>({id,heatId,driverId,lane,startedAtMs:start,endedAtMs:end});
  const lap=(id,number,end,extra={})=>({id,stintId:'stint-1',number,durationMs:10000,endedAtMs:end,valid:true,pit:false,recordEligible:true,countsForDistance:true,distanceM:20,reason:'',...extra});
  const participant=(index=0)=>({id:'entry-'+(index+1),kind:'physical',carId:profiles[index].car.id,configuration:structuredClone(profiles[index].configuration),displayName:profiles[index].car.name,drivers:[{id:'driver-1',name:'Alex Example'}],stints:[stint('stint-1','heat-1','driver-1',index+1)],laps:[lap('entry-'+index+'-lap-1',1,10000),lap('entry-'+index+'-lap-2',2,21000,{durationMs:11000}),lap('entry-'+index+'-lap-3',3,31000,{pit:true,recordEligible:false,reason:'Pit lane'})]});
  const normal={integrationVersion:1,databaseId:store.data.id,source:{id:'timing-demo',name:'Club Timing PC',application:'SlotForge Timing'},sessionId:'session-normal',revision:1,state:'active',name:'Club race',type:'race',startedAt:'2026-10-31T10:01:00.000Z',endedAt:'2026-10-31T10:02:00.000Z',track:{id:'track-1',name:'Club circuit',lanes:[{lane:1,lengthM:20},{lane:2,lengthM:20}]},heats:[{id:'heat-1',name:'Heat 1',startedAtMs:0,endedAtMs:60000}],participants:[participant()],standings:[{participantId:'entry-1',position:1,status:'finished',classifiedLaps:3,classifiedElapsedMs:31000,points:10}],adjustments:[],notes:'Reviewed by the Race Director.'};
  const multi=structuredClone(normal);multi.sessionId='session-multi';multi.name='Two cars, two heats';multi.endedAt='2026-10-31T10:03:00.000Z';multi.heats.push({id:'heat-2',name:'Heat 2',startedAtMs:60000,endedAtMs:120000});multi.participants.push(participant(1));
  multi.participants.forEach((p,i)=>{p.stints.push(stint('stint-2','heat-2','driver-1',i===0?2:1,60000,120000));p.laps.push(lap('heat2-'+i,1,70000,{stintId:'stint-2'}));});multi.standings.push({participantId:'entry-2',position:2,status:'finished',classifiedLaps:4,classifiedElapsedMs:41000,points:8});multi.standings[0].classifiedLaps=4;multi.standings[0].classifiedElapsedMs=41000;
  const endurance=structuredClone(normal);endurance.sessionId='session-endurance';endurance.name='Endurance driver change';endurance.type='endurance';const p=endurance.participants[0];p.drivers.push({id:'driver-2',name:'Sam Example'});p.stints[0].endedAtMs=21000;p.stints.push(stint('stint-2','heat-1','driver-2',1,21000,60000));p.laps[2].stintId='stint-2';
  const correction=structuredClone(normal);correction.revision=2;correction.participants[0].laps[0].valid=false;correction.participants[0].laps[0].recordEligible=false;correction.participants[0].laps[0].reason='False trigger reviewed';correction.standings[0].classifiedLaps=2;correction.adjustments.push({participantId:'entry-1',kind:'laps',amount:-1,reason:'False trigger removed from classification'});
  const withdrawal={integrationVersion:1,databaseId:store.data.id,source:structuredClone(normal.source),sessionId:normal.sessionId,revision:3,state:'withdrawn',reason:'Session withdrawn by the Race Director.'};
  return {store,profiles,normal,multi,endurance,correction,withdrawal};
}
module.exports={fixtures};
