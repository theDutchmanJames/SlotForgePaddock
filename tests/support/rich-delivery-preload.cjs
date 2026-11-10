'use strict';
// Test-only preload inherited by a disposable host and its actual domain worker.
// Compile the gate in memory; do not replace receivers, HTTP routes or schemas.
// This file is outside the packaged app. Production has no override mechanism.
require('./history-gates.cjs').install({rich:true});
