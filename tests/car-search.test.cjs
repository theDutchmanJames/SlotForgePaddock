'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {googleUrl}=require('../src/car-search.cjs');

test('Google search uses manufacturer, marque, model and reference in that order',()=>{
 assert.equal(googleUrl({maker:'Sideways',marque:'BMW',model:'M1',reference:'SW85',name:'My favourite'}),'https://www.google.com/search?q=Sideways+BMW+M1+SW85');
 assert.equal(googleUrl({maker:' Slot.it ',marque:' ',model:' Alfa\n155 ',reference:null}),'https://www.google.com/search?q=Slot.it+Alfa+155');
 assert.equal(googleUrl({maker:'NSR',name:'Fallback'}),'https://www.google.com/search?q=NSR');
});

test('display name is the fallback for owned and Wishlist cars without product fields',()=>{
 for(const collectionStatus of [undefined,'collection','wishlist'])assert.equal(googleUrl({collectionStatus,name:'  Vintage   racer ',maker:' ',model:null}),'https://www.google.com/search?q=Vintage+racer');
});

test('special characters stay within the Google query and private details are excluded',()=>{
 const car={maker:'Slot.it & NSR',marque:'Citroën',model:'C4 #1 + /?',reference:'SW85&client=bad',name:'Unused name',owner:'Secret owner',privateNotes:'Secret notes',picture:'data:secret',url:'https://example.com/'};
 const before=structuredClone(car),url=new URL(googleUrl(car));assert.equal(url.origin,'https://www.google.com');assert.equal(url.pathname,'/search');assert.equal(url.searchParams.get('q'),'Slot.it & NSR Citroën C4 #1 + /? SW85&client=bad');assert.deepEqual([...url.searchParams.keys()],['q']);assert.equal(url.hash,'');assert.deepEqual(car,before);
 assert.equal(new URL(googleUrl({name:'javascript:alert(1)'})).origin,'https://www.google.com');
});

test('empty or malformed searches cannot launch a browser URL',()=>{
 for(const input of [undefined,null,[],{}, {name:'  '},{maker:{}},{model:42},{reference:'x'.repeat(2001)}])assert.throws(()=>googleUrl(input));
});
