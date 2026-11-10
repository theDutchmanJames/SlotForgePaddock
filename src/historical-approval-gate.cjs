'use strict';
// Paddock 1.3.0 activation candidate; owner review remains mandatory.
// No preference, environment variable or client override.
const VERIFIED = true;
module.exports=Object.freeze({enabled:()=>VERIFIED});
