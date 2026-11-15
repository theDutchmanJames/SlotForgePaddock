'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const config=require('../package.json'),script=fs.readFileSync(path.resolve(__dirname,'..',config.build.nsis.include),'utf8');
test('Windows builds publish distinct installer/portable artifacts with stable data identity',()=>{
 assert.deepEqual(config.build.win.target,['nsis','portable']);assert.equal(config.scripts.dist,'electron-builder --win');
 assert.equal(config.build.appId,'nl.slotforge.database');assert.equal(config.name,'slotforge-database');assert.equal(config.build.productName,'SlotForge Paddock');
 assert.match(config.build.nsis.artifactName,/-Setup\./);assert.match(config.build.portable.artifactName,/-Portable\./);
 assert.equal(config.build.nsis.oneClick,false);assert.equal(config.build.nsis.allowToChangeInstallationDirectory,true);assert.equal(config.build.nsis.deleteAppDataOnUninstall,false);assert.equal(config.build.nsis.perMachine,false);
});
test('installer/uninstaller never force-kill the database owner or opt into data deletion',()=>{
 assert.match(script,/!macro customCheckAppRunning/);assert.match(script,/nsProcess::_FindProcess/);assert.match(script,/Quit Paddock completely/);assert.match(script,/SetErrorLevel 1618/);
 assert.doesNotMatch(script,/_KillProcess|taskkill|Stop-Process|RMDir|Delete\s+.*APPDATA/i);
 assert.match(script,/!macro customUnInit[\s\S]*--delete-app-data[\s\S]*SetErrorLevel 1639/);
 assert.match(script,/paddock-install\.ini/);assert.match(script,/\$\{APP_ID\}/);assert.match(script,/\*\.sqlite/);
 assert.match(script,/GetFileAttributesW/);assert.match(script,/FindFirst/);
});
