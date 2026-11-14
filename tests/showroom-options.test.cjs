'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),model=require('../renderer/showroom-domain.js');
const all=[{id:'a',name:'A',usage:['Race'],hasPhoto:true},{id:'b',name:'B',usage:['Display'],favourite:true,hasPhoto:false},{id:'c',name:'C',usage:['Race','Display'],hasPhoto:true},{id:'d',name:'D',archived:true,hasPhoto:true}];
const groups=[{id:'g',carIds:['c','d','missing','a']}],ids=list=>list.map(c=>c.id);
test('presentation sources intersect photo filtering and exclude archives without mutating groups',()=>{
 const before=structuredClone({all,groups});
 assert.deepEqual(ids(model.candidates(all,groups,{source:'group',groupId:'g'})),['c','a']);
 assert.deepEqual(ids(model.candidates(all,groups,{source:'usage',labels:['Race','Display']})),['a','b','c']);
 assert.deepEqual(ids(model.candidates(all,groups,{source:'favourites'})),['b']);
 assert.deepEqual(model.candidates(all,groups,{source:'favourites',photosOnly:true}),[]);
 assert.deepEqual(model.candidates(all,groups,{source:'usage',labels:[]}),[]);
 assert.deepEqual(model.candidates(all,groups,{source:'group',groupId:'deleted'}),[]);
 assert.deepEqual(ids(model.candidates(all,groups,{photosOnly:true})),['a','c']);
 assert.deepEqual({all,groups},before);
});
test('cover choices are deterministic per visit, avoid last shown and recover from removal',()=>{
 for(const mode of ['startup','visit','rotate']){
  const options={mode,source:'group',groupId:'g'};
  assert.equal(model.cover(all,groups,options,{avoid:'c',seed:24}).id,'a');
  assert.equal(model.cover(all,groups,options,{id:'c',seed:24}).id,'c');
  assert.equal(model.cover(all,groups,options,{id:'missing',avoid:'a',seed:24}).id,'c');
 }
 assert.equal(model.cover(all,groups,{carId:'b'}).id,'b');
 assert.equal(model.cover(all,groups,{carId:'d'}).id,'a');
 assert.equal(model.cover(all,groups,{mode:'rotate',source:'group',groupId:'missing'}),null);
 assert.equal(model.cover([],[],{}),null);
 assert.equal(model.cover([all[0]],[],{mode:'visit'},{avoid:'a'}).id,'a');
});
test('shuffle has no repeats, is stable across reads and varies by seed',()=>{
 const list=Array.from({length:100},(_,i)=>({id:String(i)}));
 const first=ids(model.ordered(list,true,123));assert.equal(new Set(first).size,100);
 assert.deepEqual(first,ids(model.ordered(list,true,123)));assert.notDeepEqual(first,ids(model.ordered(list,true,321)));
 assert.deepEqual(model.ordered(list,false,123),list);assert.deepEqual(model.ordered([],true),[]);
});
test('damaged display preferences are bounded without changing stored app data',()=>{
 assert.equal(model.options(null).mode,'fixed');assert.equal(model.options({seconds:1}).seconds,5);
 assert.equal(model.options({seconds:999999}).seconds,3600);assert.equal(model.options({seconds:'bad'}).seconds,15);
 assert.deepEqual(model.options({labels:['Race','Race',null,5]}).labels,['Race']);
 assert.equal(model.options({mode:'bad',source:'bad',photosOnly:'true',layout:'bad'}).photosOnly,false);
});
