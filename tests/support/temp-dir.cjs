'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=prefix=>{const root=path.resolve(__dirname,'../../.qa');fs.mkdirSync(root,{recursive:true});return fs.mkdtempSync(path.join(root,prefix));};
