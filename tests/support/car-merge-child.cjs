'use strict';
const repository=require('../../src/car-merge-storage.cjs').openQualification(process.argv[2]);
const result=repository.command(JSON.parse(process.argv[3]));
if(process.argv[4]==='lost-ack')process.exit(72);
process.stdout.write(JSON.stringify(result));
