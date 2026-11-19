'use strict';
const assert=require('node:assert/strict');
module.exports=async({store,js,wait,click,submit})=>{
 const act=(a,p={})=>store.mutate(a,{revision:store.data.revision,...p}).result;
 const part=act('part.save',{data:{name:'Legacy tyres',quantity:0,tracking:'quantity'}}),line=act('planning.shopping.add',{partId:part,quantity:4,supplier:'Original supplier'});
 act('planning.order.place',{entries:[{id:line,quantity:4}],confirmed:true});act('planning.receive',{partId:part,shoppingId:line,quantity:2,confirmed:true});
 await js(`(async()=>{page='Shopping List';source='local';await loadView();render()})()`);await wait(`!!document.querySelector('[data-shopping-row]')&&!viewPendingKey`);
 assert.equal(await js(`!!document.querySelector('[data-action="shop-bulk-order"]')`),false);
 await click('[data-action="shop-history"]');assert.match(await js(`document.querySelector('#dialog').innerText`),/Ordered 4/i);assert.match(await js(`document.querySelector('#dialog').innerText`),/Received 2/i);
 await click('[data-action="shop-correct"]');await js(`document.querySelector('#dialog [name=quantity]').value='1';document.querySelector('#dialog [name=reason]').value='One counted twice';document.querySelector('#dialog [name=confirmed]').checked=true`);await submit();await wait('!viewPendingKey');assert.equal(store.data.parts[0].quantity,1);assert.equal(store.data.planning.shopping[0].purchase.receiptCorrections.length,1);
 await click('[data-action="shop-done"]');await submit();await wait('!viewPendingKey');assert.equal(store.data.parts[0].quantity,1);
 await click('[data-action="shop-history"]');assert.match(await js(`document.querySelector('#dialog').innerText`),/Reversed 1/i);await click('[data-action="close-modal"]');
 return ['legacy order and receipt history remains accessible from checklist rows','receipt correction updates stock atomically and refreshes the UI','marking Done preserves stock and original history'];
};
