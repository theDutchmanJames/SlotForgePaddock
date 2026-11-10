'use strict';
// Legacy Timing history never had a Paddock capture key. Establish one before
// adoption, or repair only a provably unsigned historical-only cutover.
function ensure(file){
 const {Store,validateDatabase}=require('./store.cjs'),store=new Store(file,{deferred:true}),key=store.data.timing.key;
 if(key!==null){if(typeof key==='string'&&/^[a-f0-9]{64}$/.test(key))return false;throw Object.assign(Error('Invalid shared-library capture key. Restore a verified backup.'),{code:'CAPTURE_KEY_INVALID'});}
 store.ensureLoaded();const db=store.data;
 const unsigned=b=>b?.provenance?.kind==='historical'&&Array.isArray(b.race?.participants)&&b.race.participants.every(p=>!p.configuration||p.configuration.kind==='historical');
 const historical=r=>r?.format==='history-v1'&&r.provenanceKind==='historical'&&(r.payload?.state==='withdrawn'||unsigned(r.bundle));
 if(db.club?.replica||!db.timing.sessions.every(historical)||!(db.timing.audit||[]).every(a=>historical(a.record))||!(db.timing.imports||[]).every(i=>unsigned(i.item?.bundle)))throw Object.assign(Error('The library has captured racing evidence but its signing key is missing. Restore a verified backup; no new key was created.'),{code:'CAPTURE_KEY_MISSING'});
 validateDatabase(db);
 store.transact(d=>{d.timing.key=require('node:crypto').randomBytes(32).toString('hex');});return true;
}
module.exports={ensure};
