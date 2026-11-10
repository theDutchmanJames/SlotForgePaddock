'use strict';
// Persistent same-user launch registration. This is not a login service, a
// network endpoint, a shell command or a second SQLite owner.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PREFIX='--slotforge-library-start=';
const key=profile=>crypto.createHash('sha256').update(path.resolve(profile)).digest('hex');
function noRedirect(file){for(let p=file;;p=path.dirname(p)){if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Redirected local launcher path.');if(p===path.dirname(p))break;}}
function command({packaged,execPath=process.execPath,appPath,env=process.env}){const executable=packaged?(env.PORTABLE_EXECUTABLE_FILE||env.APPIMAGE||execPath):execPath;if(!path.isAbsolute(executable)||!fs.statSync(executable).isFile())throw Error('Local launcher executable is unavailable.');return {executable:path.resolve(executable),args:packaged?[]:[path.resolve(appPath)]};}
function privateFile(file){
 noRedirect(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>16384)throw Error('Invalid local launcher file.');
 if(process.platform!=='win32'){for(const target of [file,path.dirname(file)]){const s=fs.statSync(target);if(s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('Unsafe local launcher ownership or permissions.');}return;}
 const script=`$ErrorActionPreference='Stop'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
foreach($p in @($env:SLOTFORGE_LAUNCH_FILE,[IO.Path]::GetDirectoryName($env:SLOTFORGE_LAUNCH_FILE))){
 $a=if([IO.Directory]::Exists($p)){[IO.Directory]::GetAccessControl($p)}else{[IO.File]::GetAccessControl($p)}
 if($a.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid){throw 'Wrong launcher owner'}
 foreach($r in $a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){if($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -ne $sid){throw 'Unsafe launcher access'}}
}`;
 require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,stdio:'pipe',env:{...process.env,SLOTFORGE_LAUNCH_FILE:file}});
}
class Launcher {
 constructor({folder,profile,command:launch}){this.folder=path.join(folder,'launchers');this.profile=path.resolve(profile);this.key=key(profile);this.file=path.join(this.folder,this.key+'.json');this.command=launch;this.ready=false;}
 async prepare(){await require('./local-library-security.cjs').secureDirectory(this.folder);this.ready=true;}
 publish(store){if(!this.ready)return;const value={format:'slotforge-local-library-launcher',version:1,libraryKey:this.key,databaseId:store.data.id,name:store.data.settings.name,profile:this.profile,executable:this.command.executable,args:[...this.command.args,PREFIX+this.key]};const temporary=this.file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(temporary,this.file);}finally{try{fs.unlinkSync(temporary);}catch{}}}
 remove(){try{noRedirect(this.file);if(fs.existsSync(this.file))fs.unlinkSync(this.file);}catch{throw Error('Could not remove the local startup registration.');}}
}
function readStart(argv,{folder,command:launch}){
 const flags=argv.filter(a=>a.startsWith(PREFIX));if(!flags.length)return null;if(flags.length!==1||! /^[a-f0-9]{64}$/.test(flags[0].slice(PREFIX.length)))throw Error('Invalid local library startup request.');
 const libraryKey=flags[0].slice(PREFIX.length),file=path.join(folder,'launchers',libraryKey+'.json');privateFile(file);const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.format!=='slotforge-local-library-launcher'||r.version!==1||r.libraryKey!==libraryKey||typeof r.profile!=='string'||!path.isAbsolute(r.profile)||key(r.profile)!==libraryKey||r.executable!==launch.executable||JSON.stringify(r.args)!==JSON.stringify([...launch.args,flags[0]]))throw Error('This launcher registration belongs to another installation. Open Paddock normally to register its current location.');
 noRedirect(r.profile);if(!fs.statSync(r.profile).isDirectory()||!['database.sqlite','database.json'].some(n=>fs.existsSync(path.join(r.profile,n))))throw Error('The registered library is missing. Open Paddock normally; no replacement was created.');
 const settings=path.join(r.profile,'local-library-settings.json');if(fs.existsSync(settings)){noRedirect(settings);if(fs.statSync(settings).size>8192)throw Error('Invalid local settings.');const p=JSON.parse(fs.readFileSync(settings));if(p.version!==1||p.enabled!==true)throw Error('Local library access is disabled.');}
 return r;
}
module.exports={Launcher,readStart,command,key,PREFIX,privateFile};
