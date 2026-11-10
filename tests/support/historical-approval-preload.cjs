'use strict';
// Qualification only. Inherited by the synthetic host's real domain worker.
// No receiver/schema substitution and no shipped activation mechanism.
require('./history-gates.cjs').install({historical:true});
