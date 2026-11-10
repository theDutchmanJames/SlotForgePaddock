'use strict';
module.exports=function totals(output){
 const result={};for(const key of ['tests','pass','fail','cancelled','skipped','todo']){const values=[...output.matchAll(new RegExp('^# '+key+' (\\d+)\\r?$','gm'))];if(values.length!==1)throw Error('Missing or ambiguous TAP total: '+key);result[key]=Number(values[0][1]);}
 if(result.tests<1||result.pass!==result.tests||result.fail||result.cancelled||result.skipped||result.todo)throw Error('Qualification requires every test to pass: '+JSON.stringify(result));
 return result;
};
