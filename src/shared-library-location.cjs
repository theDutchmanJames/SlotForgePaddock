'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const VERSION=1;
function directory({platform=process.platform,env=process.env,home=os.homedir()}={}){
 if(platform==='win32'){if(!env.LOCALAPPDATA)throw Error('Local application data is unavailable.');return path.join(env.LOCALAPPDATA,'SlotForge','shared-library','v1');}
 if(platform==='darwin')return path.join(home,'Library','Application Support','SlotForge','shared-library','v1');
 return path.join(env.XDG_DATA_HOME||path.join(home,'.local','share'),'slotforge','shared-library','v1');
}
function fault(code,message){return Object.assign(Error(message),{code});}
function identity(file){const db=new DatabaseSync(file,{readOnly:true,timeout:5000});try{
 if(db.prepare('PRAGMA application_id').get().application_id!==0x53465044)throw fault('LIBRARY_FORMAT','The registered file is not a compatible shared library.');
 const version=db.prepare("SELECT value FROM state WHERE key='shared_engine_version'").get()?.value;
 if(version!==undefined&&version!==String(VERSION))throw fault('ENGINE_VERSION','Update both apps to use this library.');
 return JSON.parse(db.prepare("SELECT value FROM state WHERE key='identity'").get().value)[0];
}finally{db.close();}}
function read(root){const file=path.join(root,'library.json');if(!fs.existsSync(file))return null;const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)throw fault('LIBRARY_REGISTRATION','Invalid shared library registration.');
 const value=JSON.parse(fs.readFileSync(file,'utf8'));if(value.version!==VERSION||typeof value.databaseId!=='string'||typeof value.file!=='string'||!path.isAbsolute(value.file))throw fault('LIBRARY_REGISTRATION','Unsupported shared library registration.');
 if(!fs.existsSync(value.file))throw fault('LIBRARY_MISSING','The shared library is missing. Restore its location; an empty replacement has not been created.');
 if(identity(value.file)!==value.databaseId)throw fault('DATABASE_MISMATCH','The registered library was replaced by another collection.');return value;
}
async function lock(root,fn){
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 // SQLite supplies an OS-backed cross-process lock. Process death releases it;
 // there is no stale PID file to delete and no race between stale-lock owners.
 const db=new DatabaseSync(path.join(root,'coordination.sqlite'),{timeout:0});let acquired=false;
 try{
  for(let n=0;n<6000;n++){
   try{db.exec('BEGIN IMMEDIATE');acquired=true;break;}
   catch(e){if(e.errcode!==5&&e.code!=='SQLITE_BUSY'&&!/database is locked/.test(e.message))throw e;await new Promise(r=>setTimeout(r,100));}
  }
  if(!acquired)throw fault('LIBRARY_BUSY','Another app is preparing the shared library. Retry shortly.');
  db.exec('CREATE TABLE IF NOT EXISTS coordination(version INTEGER NOT NULL);');
  const result=await fn();db.exec('COMMIT');acquired=false;return result;
 }finally{if(acquired)try{db.exec('ROLLBACK');}catch{}db.close();}
}
async function resolve(options={}){
 const root=path.resolve(options.sharedRoot||directory());let known;try{known=read(root);}catch(error){if(error.code!=='DATABASE_MISMATCH')throw error;await recoverReplacement(root);known=read(root);}if(known)return {...known,root};
 return lock(root,async()=>{
  const existing=read(root);if(existing)return {...existing,root};
  let file=options.legacyPaddockPath&&path.resolve(options.legacyPaddockPath);
  if(file&&!fs.existsSync(file)&&!fs.existsSync(require('./sqlite-storage.cjs').sqlitePath(file)))file=null;
  file=file||path.join(root,'library.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true});
  // Store's established JSON/SQLite migration preserves its original source.
  const store=await require('./store.cjs').Store.open(file);if(store.expectedIdentity===null)store.persist(store.data);file=store.file;
  const db=new DatabaseSync(file,{timeout:5000});try{db.exec('BEGIN IMMEDIATE');const release=require('./car-merge-fence.cjs').begin(db);db.prepare("INSERT INTO state(key,value) VALUES('shared_engine_version',?) ON CONFLICT(key) DO NOTHING").run(String(VERSION));release();db.exec('COMMIT');}finally{db.close();}
  identity(file);const result={version:VERSION,file:fs.realpathSync(file),databaseId:store.data.id};const temporary=path.join(root,'library-'+nonce()+'.tmp'),fd=fs.openSync(temporary,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(result));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temporary,path.join(root,'library.json'));return {...result,root};
 });
}
const nonce=()=>crypto.randomUUID();
function saveRegistration(root,value){
 const temporary=path.join(root,'library-'+nonce()+'.tmp'),fd=fs.openSync(temporary,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,path.join(root,'library.json'));
}
// Called only after an explicitly requested restore/reset by the owning app.
// Existing handles retain their original ID; they cannot write into the new one.
function rebindLocked(root,file,previousId){
 const registration=path.join(root,'library.json'),old=JSON.parse(fs.readFileSync(registration,'utf8'));
 if(old.databaseId!==previousId||path.resolve(old.file)!==path.resolve(file))throw fault('DATABASE_MISMATCH','The shared library registration changed during replacement.');
 const result={version:VERSION,file:fs.realpathSync(file),databaseId:identity(file)};
 saveRegistration(root,result);return result;
}
async function rebind(root,file,previousId){return lock(root,()=>rebindLocked(root,file,previousId));}
function beginLocked(root,file,previousId,lockHeld=false){
 const old=read(root);if(!old||old.databaseId!==previousId||path.resolve(old.file)!==path.resolve(file))throw fault('DATABASE_MISMATCH','Shared library changed before replacement.');
 const existing=path.join(root,'replacement.json');if(fs.existsSync(existing)){
  const prior=JSON.parse(fs.readFileSync(existing,'utf8'));let gone=false;
  if(!Number.isInteger(prior.pid)||prior.pid<=0)throw fault('LIBRARY_REGISTRATION','Invalid pending replacement receipt.');
  try{process.kill(prior.pid,0);}catch(e){gone=e.code==='ESRCH';}
  if(!gone&&prior.lockHeld!==true)throw fault('LIBRARY_BUSY','Another app is already restoring the shared library.');
  // read(root) above proves replacement did not leave a different database ID.
  fs.unlinkSync(existing);
 }
 const ticket={version:1,file:old.file,previousId,pid:process.pid,nonce:nonce(),...(lockHeld?{lockHeld:true}:{})},name=path.join(root,'replacement.json'),temp=name+'.'+ticket.nonce+'.tmp',fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(ticket));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,name);return ticket;
}
async function beginReplacement(root,file,previousId){return lock(root,()=>beginLocked(root,file,previousId));}
function finishLocked(root,ticket){
 const name=path.join(root,'replacement.json');if(!fs.existsSync(name)||JSON.parse(fs.readFileSync(name,'utf8')).nonce!==ticket.nonce)throw fault('LIBRARY_BUSY','The replacement receipt changed before acknowledgement.');
 const current=JSON.parse(fs.readFileSync(path.join(root,'library.json'),'utf8'));
 if(current.databaseId===ticket.previousId)rebindLocked(root,ticket.file,ticket.previousId);
 else if(path.resolve(current.file)!==path.resolve(ticket.file)||current.databaseId!==identity(ticket.file))throw fault('DATABASE_MISMATCH','The shared library changed during replacement acknowledgement.');
 // Registration may already have been durably updated before the worker died.
 fs.unlinkSync(name);
}
async function finishReplacement(root,ticket){return lock(root,()=>finishLocked(root,ticket));}
async function withReplacement(root,file,previousId,fn){return lock(root,async()=>{
 const ticket=beginLocked(root,file,previousId,true),result=await fn(ticket);finishLocked(root,ticket);return result;
});}
async function recoverReplacement(root){return lock(root,()=>{
 const name=path.join(root,'replacement.json');if(!fs.existsSync(name))throw fault('DATABASE_MISMATCH','The registered library was replaced without a replacement receipt.');
 const ticket=JSON.parse(fs.readFileSync(name,'utf8')),registration=path.join(root,'library.json'),old=JSON.parse(fs.readFileSync(registration,'utf8'));
 if(ticket.version!==1||ticket.file!==old.file||ticket.previousId!==old.databaseId||!Number.isInteger(ticket.pid)||ticket.pid<=0)throw fault('DATABASE_MISMATCH','Invalid library replacement receipt.');
 // A lockHeld ticket is recoverable once this transaction owns the lock, even
 // when only the worker died and the parent application PID is still alive.
 let gone=false;try{process.kill(ticket.pid,0);}catch(e){gone=e.code==='ESRCH';}if(!gone&&ticket.lockHeld!==true)throw fault('LIBRARY_BUSY','Another app is finishing library replacement. Retry shortly.');
 const result={...old,databaseId:identity(old.file)};saveRegistration(root,result);fs.unlinkSync(name);
});}
module.exports={VERSION,directory,read,resolve,identity,lock,rebind,beginReplacement,finishReplacement,withReplacement};
