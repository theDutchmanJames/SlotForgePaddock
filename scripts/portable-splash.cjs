'use strict';
// electron-builder's stock portable splash also appears for background launches.
// Adapt only that launcher's initialization, without changing the registered
// command used by Timing. The builder is pinned; fail closed if its template moves.
function adapt(script){
 const marker='Function .onInit';
 if(!script.includes('SPLASH_IMAGE')||script.split(marker).length!==2)throw Error('Portable splash template changed; review background launch suppression before packaging.');
 return '!include "FileFunc.nsh"\n'+script.replace(marker,[marker,
  '  ${GetParameters} $R0',
  '  ClearErrors',
  '  ${GetOptions} $R0 "--slotforge-library-start=" $R1',
  '  ${IfNot} ${Errors}',
  '    SetSilent silent',
  '  ${EndIf}',
  ''
 ].join('\n'));
}
module.exports=async context=>{
 for(const target of context.targets||[]){
  if(target.name!=='portable'||target.paddockSplashPatched)continue;
  if(typeof target.computeFinalScript!=='function')throw Error('Portable launcher builder changed; review splash support.');
  target.paddockSplashPatched=true;
  const original=target.computeFinalScript;
  target.computeFinalScript=function(script,...args){return original.call(this,adapt(script),...args);};
 }
};
module.exports.adapt=adapt;
