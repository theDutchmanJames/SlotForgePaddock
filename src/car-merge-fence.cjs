'use strict';
// A schema-version check alone cannot fence an old connection that is already
// open. These persisted triggers require a transaction-local permit. The permit
// is removed before COMMIT; competing/old connections never observe it, and a
// crash rolls it back. No trusted_schema or foreign-key protection is weakened.
// This is an accidental-old-writer guard, not a security boundary against a
// person deliberately editing their own SQLite file.
const TABLE='merge_write_permit';
const tables=['state','records','record_fields','field_versions','assets','asset_refs','undo_records','undo_assets','change_log','change_assets','command_receipts'];
function begin(db,{install=false}={}){
 if(!db.isTransaction)throw Error('A merge write permit requires an active transaction.');
 const exists=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE);
 if(!exists&&!install)return ()=>{};
 if(!exists){
  db.exec(`CREATE TABLE ${TABLE}(version INTEGER PRIMARY KEY CHECK(version=1)) STRICT`);
  for(const name of tables)for(const action of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER merge_fence_${name}_${action.toLowerCase()} BEFORE ${action} ON ${name}
   WHEN NOT EXISTS(SELECT 1 FROM ${TABLE} WHERE version=1) BEGIN SELECT RAISE(ABORT,'MERGE_ENGINE_REQUIRED: update the shared-library engine before writing'); END`);
 }
 if(db.prepare(`SELECT 1 FROM ${TABLE}`).get())throw Object.assign(Error('An unexpected persisted merge write permit was found. Keep the file and restore a verified backup.'),{code:'MERGE_FENCE_INVALID'});
 db.exec(`INSERT INTO ${TABLE}(version) VALUES(1)`);
 return ()=>db.exec(`DELETE FROM ${TABLE}`);
}
module.exports={begin};
