'use strict';
// Lookup structures can be recreated without touching their source rows.
const definitions={
 records_bucket:'ON records(bucket,identity)',
 record_fields_lookup:'ON record_fields(path,json) WHERE length(json)<=512',
 field_versions_revision:'ON field_versions(revision)',
 change_log_sizes:'ON change_log(sequence,bytes)',
 query_names:'ON query_records(bucket,archived,name,key)',
 query_makers:'ON query_records(bucket,archived,maker,key)',
 query_updated:'ON query_records(bucket,archived,updated,key)',
 query_car:'ON query_records(bucket,car_id,date,key)',
 query_status:'ON query_records(bucket,status,key)',
 query_reminders:'ON query_records(bucket,type,car_id,task,rank)',
 query_session_identity:'ON query_sessions(source,session)',
 query_session_notice:"ON query_sessions(received DESC,key,source,session,json_extract(json,'$.contentHash'))",
 query_lap_order:'ON query_laps(key,participant,ended,position)',
 query_car_results_session:'ON query_car_results(key,car_id)'
};
function ready(db){const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name));return Object.keys(definitions).every(name=>names.has(name));}
function ensure(db){const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r=>r.name));for(const [name,definition]of Object.entries(definitions))if(!names.has(name))db.exec('CREATE '+(name==='query_session_identity'?'UNIQUE ':'')+'INDEX IF NOT EXISTS '+name+' '+definition);}
module.exports={ready,ensure};
