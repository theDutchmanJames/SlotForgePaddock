'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process');
async function secureDirectory(folder){
 if(!path.isAbsolute(folder))throw Error('Local discovery needs an absolute user directory.');
 for(let ancestor=folder;;ancestor=path.dirname(ancestor)){if(fs.existsSync(ancestor)&&fs.lstatSync(ancestor).isSymbolicLink())throw Error('Local discovery cannot use redirected paths.');if(ancestor===path.dirname(ancestor))break;}
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const stat=fs.lstatSync(folder);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Local discovery needs a real private directory.');
 if(process.platform!=='win32'){
  if(stat.uid!==process.getuid())throw Error('The local discovery directory belongs to another user.');
  fs.chmodSync(folder,0o700);return;
 }
 // chmod does not secure Windows files. Create an explicit inheritable DACL
 // for this user, so every temporary/renamed descriptor inherits protection.
 // The path is an environment value, never interpolated into PowerShell code.
 const script=`$ErrorActionPreference='Stop'
$directory=$env:SLOTFORGE_LOCAL_DIRECTORY
$item=New-Object IO.DirectoryInfo($directory)
if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Redirected discovery directory' }
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true,$false)
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
$acl.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($directory,$acl)
$actual=[IO.Directory]::GetAccessControl($directory)
if (!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Discovery permissions were not applied' }
foreach ($r in $actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) { if ($r.IdentityReference.Value -ne $sid.Value) { throw 'Discovery directory permits another user' } }
`;
 await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:16384,env:{...process.env,SLOTFORGE_LOCAL_DIRECTORY:folder}},(error,_stdout,stderr)=>error?reject(Object.assign(Error('Could not secure local discovery for this Windows account.'),{cause:stderr||error.message})):resolve()));
}
module.exports={secureDirectory};
