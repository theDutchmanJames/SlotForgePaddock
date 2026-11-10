'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Store}=require('../src/store.cjs'),Model=require('../renderer/build-model.js');
const act=(s,a,p={})=>s.mutate(a,{revision:s.data.revision,...p}).result;
function fixture(){const s=new Store(),id=act(s,'part.save',{data:{name:'Catalogue motor',partType:'Motor',tracking:'quantity',quantity:0}}),data={...Model.blank(),name:'Future racer',parts:[{key:'motor',partId:id,name:'Catalogue motor',quantity:1,slot:'motor',position:'Motor'}]};return {s,id,data};}
test('catalogue-only plans create linked shopping without inventing inventory or a car',()=>{
 const {s,id,data}=fixture(),draft=act(s,'build.draft.save',{data});assert.equal(s.data.cars.length,0);assert.equal(s.data.parts[0].quantity,0);assert.equal(s.data.planning.shopping[0].buildId,draft);assert.equal(s.data.planning.shopping[0].partId,id);
 assert.throws(()=>act(s,'build.create',{draftId:draft,data,confirmed:true}),/insufficient/);
 const line=s.data.planning.shopping[0];act(s,'planning.receive',{shoppingId:line.id,partId:id,quantity:1,confirmed:true});const car=act(s,'build.create',{draftId:draft,data,confirmed:true});assert.equal(s.data.planning.shopping[0].buildCarId,car);assert.equal(s.data.installations[0].partId,id);
});
test('saving plans reconciles shortages, quantities and removals without duplicate shopping',()=>{
 const {s,data}=fixture(),draft=act(s,'build.draft.save',{data});act(s,'build.draft.save',{id:draft,data});assert.equal(s.data.planning.shopping.length,1);
 data.parts[0].quantity=4;act(s,'build.draft.save',{id:draft,data});assert.equal(s.data.planning.shopping[0].quantity,4);
 data.parts=[];act(s,'build.draft.save',{id:draft,data});assert.equal(s.data.planning.shopping.length,0);
});
test('partially received purchases survive edits and draft deletion as history',()=>{
 const {s,id,data}=fixture();data.parts[0].quantity=4;const draft=act(s,'build.draft.save',{data}),line=s.data.planning.shopping[0];act(s,'planning.receive',{shoppingId:line.id,partId:id,quantity:2,confirmed:true});act(s,'build.draft.save',{id:draft,data});assert.equal(s.data.planning.shopping[0].quantity,4);assert.equal(s.data.planning.shopping[0].received,2);
 act(s,'build.draft.delete',{id:draft});assert.equal(s.data.planning.shopping[0].quantity,2);assert.equal(s.data.planning.shopping[0].received,2);assert.equal(s.data.parts[0].quantity,2);
});
test('separate builds keep separate shopping and owned stock reduces only the shortage',()=>{
 const {s,id,data}=fixture();act(s,'planning.receive',{partId:id,quantity:1,confirmed:true});data.parts[0].quantity=3;act(s,'build.draft.save',{data});act(s,'build.draft.save',{data:{...data,name:'Second plan'}});assert.equal(s.data.planning.shopping.length,2);assert.deepEqual(s.data.planning.shopping.map(x=>x.quantity),[2,2]);assert.notEqual(s.data.planning.shopping[0].buildId,s.data.planning.shopping[1].buildId);
});

test('cancelling a rebuild cancels its outstanding shopping and keeps received stock',()=>{
 const {s,id,data}=fixture(),car=act(s,'car.save',{data:{name:'Old racer'}}),draft=act(s,'rebuild.start',{carId:car}),plan=structuredClone(s.data.buildDrafts[0].data);plan.parts=data.parts;plan.parts[0].quantity=3;act(s,'build.draft.save',{id:draft,data:plan});const line=s.data.planning.shopping[0];act(s,'planning.receive',{shoppingId:line.id,partId:id,quantity:1,confirmed:true});act(s,'job.cancel',{id:plan.rebuild.jobId,confirmed:true});assert.equal(s.data.buildDrafts.length,0);assert.equal(s.data.planning.shopping[0].quantity,1);assert.equal(s.data.planning.shopping[0].received,1);assert.equal(s.data.parts[0].quantity,1);
});
