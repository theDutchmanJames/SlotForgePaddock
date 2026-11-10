'use strict';
// Synthetic contract artifacts only; no application database is opened.
const crypto=require('node:crypto');
const {schema,capability}=require('../fixtures/contracts/shared-racing-history-v1/contract.cjs');
const {fixtures}=require('./timing-fixtures.cjs'),{digest}=require('../../src/timing-integration.cjs');
const clone=structuredClone,sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function examples(){
 const f=fixtures(),base={version:1,databaseId:f.normal.databaseId,recoveryId:'recovery-example-1'},editor={installationId:'timing-editor-a',application:'SlotForge Timing',name:'Example race director'};
 const tuple=(payload)=>({revision:payload.revision,contentHash:digest(payload),state:payload.state});
 const make=(payload,action='create',expected=null,operationId='create-normal')=>({...base,operationId,editor:clone(editor),sourceId:payload.source.id,sessionId:payload.sessionId,expected,reason:action==='create'?'Finalised by race director':'Review correction',action,...(action==='withdraw'?{withdrawalReason:payload.reason}:{bundle:{format:'timing-v1',payload:clone(payload)}})});
 const normal=make(f.normal),correction=make(f.correction,'replace',tuple(f.normal),'correct-normal'),withdrawal=make(f.withdrawal,'withdraw',tuple(f.correction),'withdraw-normal');
 const receipt=(op,accepted)=>({...base,operationId:op.operationId,sourceId:op.sourceId,sessionId:op.sessionId,requestHash:digest(op),status:'committed',accepted,duplicate:false,committedAt:'2026-11-09T12:00:00.000Z',current:clone(accepted)});
 const error=(code,message,current=null)=>({code,error:message,databaseId:base.databaseId,recoveryId:base.recoveryId,current});
 const records=[],add=(file,definition,value,http=200,status='proposed')=>{records.push({file,definition,http,status,value});return value;};
 add('capability.json','capability',capability);add('status.json','status',{...base,capability,cursor:'opaque-results-cursor-example'});
 add('create.json','operation',normal);add('create-receipt.json','receipt',receipt(normal,tuple(f.normal)));
 add('duplicate-after-correction.json','receipt',{...receipt(normal,tuple(f.normal)),duplicate:true,current:tuple(f.correction)});
 add('correction.json','operation',correction);add('correction-receipt.json','receipt',receipt(correction,tuple(f.correction)));
 add('withdrawal.json','operation',withdrawal);
 // Withdrawal content has the same canonical payload as legacy v1 for this case.
 add('withdrawal-receipt.json','receipt',receipt(withdrawal,tuple(f.withdrawal)));
 add('stale-editor.json','operation',{...clone(correction),operationId:'other-editor-stale',editor:{...editor,installationId:'timing-editor-b'}});
 add('revision-conflict.json','error',error('REVISION_CONFLICT','Reload the accepted revision; keep your local draft.',tuple(f.correction)),409);
 add('operation-conflict.json','error',error('OPERATION_CONFLICT','This operation ID already has different content.'),409);
 add('recovery-changed.json','error',{...error('RECOVERY_CHANGED','Reconcile the restored library; do not rewrite the queued generation.'),recoveryId:'recovery-example-2'},409);
 add('guard-required.json','error',error('HISTORY_GUARD_REQUIRED','Use the negotiated shared-history operation for this session.',tuple(f.correction)),409);
 add('multi-heat.json','operation',make(f.multi,'create',null,'create-multi'));
 add('endurance.json','operation',make(f.endurance,'create',null,'create-endurance'));
 const history=toHistory(f.multi);history.context.classes=[{id:'gt3',name:'GT3'},{id:'prototype',name:'Prototype'}];
 history.context.classification.push(...history.context.classification.filter(c=>c.scope==='overall').map((c,i)=>({...clone(c),scope:'class',scopeId:i?'prototype':'gt3',classId:i?'prototype':'gt3',position:1,points:i?15:20})));
 history.race.participants[0].laps[0].trackRecordEligible=false;
 history.context.scoringSnapshot={resultBy:'points',countBestHeats:2,finalMode:null,awardsAlreadyApplied:true};
 const enriched={...make(f.multi,'create',null,'create-class-race'),sessionId:'session-class-race',bundle:history};
 add('classes-and-eligibility.json','operation',clone(enriched));
 const guest=clone(history.race.participants[0]);guest.id='guest';guest.carId=null;guest.configuration=null;guest.laps.forEach(l=>{l.id='guest-'+l.id;l.originLapId=null;});history.race.participants.push(guest);
 const virtual=clone(guest);virtual.id='virtual';virtual.kind='virtual';virtual.laps.forEach(l=>{l.id='virtual-'+l.id;l.countsForDistance=false;l.personalRecordEligible=false;l.trackRecordEligible=false;});history.race.participants.push(virtual);
 add('unlinked-and-virtual.json','operation',{...make(f.multi,'create',null,'context-entries'),sessionId:'session-context',bundle:clone(history)});
 const historical=toHistory(f.normal);historical.provenance={kind:'historical',evidence:'Original saved Timing laps; no pre-race capture or crossing clock survived.',missing:['configuration','crossing-times','driver-boundaries','lane-lengths','record-eligibility','race-date']};historical.race.startedAt=null;historical.race.endedAt=null;historical.race.heats.forEach(h=>{h.startedAtMs=null;h.endedAtMs=null;});historical.race.track.lanes.forEach(l=>l.lengthM=null);
 for(const p of historical.race.participants){p.configuration=null;p.stints=[];for(const l of p.laps){l.stintId=null;l.endedAtMs=null;l.distanceM=null;l.personalRecordEligible=false;l.trackRecordEligible=false;}}
 const oldId={sourceId:'timing-original-installation',sessionId:'historical-session-1'};
 const originEvidence={session:{id:oldId.sessionId,setupName:'Synthetic original saved race'},laps:historical.race.participants[0].laps.map(l=>({id:l.id,sessionId:oldId.sessionId,time:l.durationMs})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)};
 add('origin-evidence.json','originEvidence',originEvidence);
 const imported={...base,operationId:'import-batch-1',editor,items:[{itemId:'item-1',...oldId,originHash:digest(originEvidence),bundle:historical}]};
 add('historical-import.json','importRequest',imported);
 const pending={...base,operationId:imported.operationId,requestHash:digest(imported),items:[{itemId:'item-1',...oldId,status:'pending',accepted:null,message:'Awaiting Review in Paddock'}]};
 add('import-pending.json','importReceipt',pending);
 add('import-approved.json','importReceipt',{...clone(pending),items:[{...pending.items[0],status:'approved',accepted:{revision:1,contentHash:digest(historical),state:'active'},message:'Accepted after review'}]});
 add('import-cancel.json','importCancel',{...base,operationId:imported.operationId,itemIds:['item-1']});
 add('import-cancelled.json','importReceipt',{...clone(pending),items:[{...pending.items[0],status:'cancelled',message:'Cancelled before approval'}]});
 const deliveredImport={...clone(imported),operationId:'import-already-delivered'};Object.assign(deliveredImport.items[0],{sourceId:normal.sourceId,sessionId:normal.sessionId,originHash:digest({session:{id:normal.sessionId},laps:originEvidence.laps.map(l=>({...l,sessionId:normal.sessionId}))})});
 add('already-delivered-request.json','importRequest',deliveredImport);
 add('already-delivered.json','importReceipt',{...base,operationId:deliveredImport.operationId,requestHash:digest(deliveredImport),items:[{itemId:'item-1',sourceId:normal.sourceId,sessionId:normal.sessionId,status:'already-present',accepted:tuple(f.normal),message:'Identity and retained delivery evidence reconciled; no second contribution'}]});
 const mixed=clone(imported);mixed.operationId='import-two-items';mixed.items.push({...clone(mixed.items[0]),itemId:'item-2',sessionId:'historical-session-2',originHash:digest({session:{id:'historical-session-2'},laps:originEvidence.laps.map(l=>({...l,sessionId:'historical-session-2'}))})});
 add('partial-import.json','importRequest',mixed);
 add('partial-import-cancel.json','importCancel',{...base,operationId:mixed.operationId,itemIds:['item-1','item-2']});
 add('partial-import-outcome.json','importReceipt',{...base,operationId:mixed.operationId,requestHash:digest(mixed),items:mixed.items.map((item,i)=>({itemId:item.itemId,sourceId:item.sourceId,sessionId:item.sessionId,status:i?'cancelled':'approved',accepted:i?null:{revision:1,contentHash:digest(item.bundle),state:'active'},message:i?'Pending item cancelled':'Already approved; cancellation leaves it intact'}))});
 const head=clone(f.normal);head.participants.forEach(p=>delete p.laps);
 add('session-head.json','head',{...base,sourceId:normal.sourceId,sessionId:normal.sessionId,accepted:tuple(f.normal),resultToken:'opaque-session-token-1',body:{format:'timing-v1',payload:head},lapCounts:f.normal.participants.map(p=>({participantId:p.id,count:p.laps.length}))});
 add('withdrawn-head.json','head',{...base,sourceId:normal.sourceId,sessionId:normal.sessionId,accepted:tuple(f.withdrawal),resultToken:'opaque-session-token-3',body:null,lapCounts:[]});
 add('lap-page.json','laps',{...base,sourceId:normal.sourceId,sessionId:normal.sessionId,participantId:'entry-1',resultToken:'opaque-session-token-1',format:'timing-v1',offset:0,total:3,nextOffset:null,laps:clone(f.normal.participants[0].laps)});
 add('session-list.json','list',{...base,snapshot:'opaque-snapshot-1',cursor:'opaque-results-cursor-example',entries:[{sourceId:normal.sourceId,sessionId:normal.sessionId,accepted:tuple(f.normal),name:f.normal.name,startedAt:f.normal.startedAt,trackId:f.normal.track.id,trackName:f.normal.track.name,carIds:['car-a'],resultToken:'opaque-session-token-1',format:'timing-v1',provenance:'measured'}],nextPage:null});
 add('car-statistics.json','statistics',{...base,carId:'car-a',snapshot:'opaque-snapshot-1',cursor:'opaque-results-cursor-example',acceptedSessions:1,historicalSessions:0,measuredLaps:3,validLaps:2,personalRecordLaps:2,trackRecordLaps:2,measuredTimeMs:21000,averageLapMs:10500,bestPersonalLapMs:10000,bestTrackLapMs:10000,distanceM:60,distanceComplete:true,unknownDistanceLaps:0,overallWins:1,classWins:0,manualIncluded:false,quarantinedSessions:0});
 const bytes=Buffer.from(JSON.stringify(normal)),uploadId='upload-example-1',rawHash=sha(bytes);
 add('upload-start.json','uploadStart',{...base,uploadId,editor,kind:'operation',byteLength:bytes.length,sha256:rawHash});
 add('upload-chunk.json','chunk',{...base,uploadId,index:0,sha256:rawHash,data:bytes.toString('base64')});
 add('upload-status.json','uploadStatus',{...base,uploadId,state:'staging',byteLength:bytes.length,sha256:rawHash,chunkBytes:262144,received:[0],expiresAt:'2026-11-10T12:00:00.000Z',receipt:null});
 add('upload-commit.json','uploadCommit',{...base,uploadId,sha256:rawHash});
 add('upload-incomplete.json','error',error('UPLOAD_INCOMPLETE','Missing chunks; current accepted result is unchanged.'),409);
 add('chunk-conflict.json','error',error('CHUNK_CONFLICT','This chunk index already contains different bytes.'),409);
 return records;
}
function toHistory(payload){
 const race=clone(payload);for(const k of ['integrationVersion','databaseId','source','sessionId','revision','state','standings','adjustments','notes'])delete race[k];
 for(const p of race.participants){delete p.summary;p.teamId=null;for(const l of p.laps){const s=p.stints.find(s=>s.id===l.stintId);Object.assign(l,{originLapId:null,heatId:s.heatId,driverId:s.driverId,lane:s.lane,personalRecordEligible:l.recordEligible?true:null,trackRecordEligible:l.recordEligible?true:null,flags:[]});delete l.recordEligible;}}
 return {format:'history-v1',provenance:{kind:'measured',evidence:'Synthetic recorded race with original signed configurations.',missing:[]},race,context:{savedAt:payload.endedAt,endedBy:'race completed',resumed:0,weather:null,teams:[],classes:[],classification:payload.standings.map(s=>({participantId:s.participantId,scope:'overall',scopeId:null,classId:null,position:s.position,status:s.status,laps:s.classifiedLaps,elapsedMs:s.classifiedElapsedMs,points:s.points,score:null,scoreUnit:null,gap:null,countedHeatIds:payload.heats.map(h=>h.id),droppedHeatIds:[],incomplete:false,estimated:false,effects:payload.adjustments.filter(a=>a.participantId===s.participantId).map(({participantId,...a})=>a)})),systemChanges:[],scoringSnapshot:null,notes:payload.notes}};
}
module.exports={examples,toHistory};
