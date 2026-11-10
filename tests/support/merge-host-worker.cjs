'use strict';
// Isolated qualification only. The shipped application has no runtime switch.
const file=require.resolve('../../src/car-merge-activation.json');
require(file);require.cache[file].exports={enabled:true,contractVersion:1};
require('../../src/domain-worker.cjs');
