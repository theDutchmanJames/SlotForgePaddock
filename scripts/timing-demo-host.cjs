// Standalone local test host; never opens or writes a user's Paddock collection.
const {Network}=require('../src/network.cjs');
const {fixtures}=require('../tests/support/timing-fixtures.cjs');
const {store}=fixtures();const network=new Network(store);
network.start().then(()=>{console.log(JSON.stringify({address:'http://127.0.0.1:'+network.port,databaseId:store.data.id,timingCode:network.timingCode,notice:'Artificial in-memory demo. Existing Paddock databases are untouched. Ctrl+C stops.'},null,2));}).catch(e=>{console.error(e.message);process.exitCode=1;});
process.on('SIGINT',async()=>{await network.stop();process.exit(0);});
process.on('SIGTERM',async()=>{await network.stop();process.exit(0);});
