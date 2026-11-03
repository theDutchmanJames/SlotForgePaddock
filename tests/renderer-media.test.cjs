const test=require('node:test'),assert=require('node:assert/strict');
const {RendererMedia}=require('../src/renderer-media.cjs');
const photo='data:image/png;base64,AAAA';
test('renderer receives stable lightweight references while edits expand to exact original photos',()=>{
 const media=new RendererMedia(),original={cars:[{id:'c',picture:photo,photos:[{data:photo}]}],privateNotes:'unchanged'},copy=media.project(original);
 assert.match(copy.cars[0].picture,/^paddock-media:\/\/image\//);assert.equal(copy.cars[0].photos[0].data,copy.cars[0].picture);assert.deepEqual(media.expand(copy),original);assert.equal(original.cars[0].picture,photo);
 assert.equal(media.project(photo),copy.cars[0].picture);assert.equal(media.response(copy.cars[0].picture).mime,'image/png');assert.deepEqual(media.response(copy.cars[0].picture).bytes,Buffer.from('AAAA','base64'));assert.equal(media.response(copy.cars[0].picture+'?thumbnail=1').thumbnail,true);
});
test('opaque image URLs cannot read paths, stale references or unknown resources',()=>{
 const media=new RendererMedia(),url=media.project(photo);for(const u of ['file:///etc/passwd','paddock-media://image/../../secret',url+'?path=secret',url+'#fragment'])assert.equal(media.response(u),null);
 assert.throws(()=>media.expand('paddock-media://image/unknown'),/expired/);media.clear();assert.equal(media.response(url),null);assert.throws(()=>media.expand(url),/expired/);
});
test('image projection materially reduces initial payloads and preserves nonimage records',()=>{
 const media=new RendererMedia(),value={picture:'data:image/jpeg;base64,'+'A'.repeat(1000000),timing:{sessions:[{id:'s',laps:[1,2,3]}]},document:{data:'AAAA',mime:'text/plain'}};
 const projected=media.project(value);assert.ok(JSON.stringify(projected).length<300);assert.deepEqual(media.expand(projected),value);
});

test('Showroom accepts original images and opaque local media, but rejects external image URLs',()=>{
 const model=require('../renderer/showroom-domain.js'),media=new RendererMedia(),url=media.project(photo);
 assert.equal(model.photos({picture:url,photos:[{data:url},{data:photo},{data:'https://example.org/car.jpg'}]}).length,2);
 assert.equal(model.photos({picture:'paddock-media://image/not-a-valid-id'}).length,0);
});

test('media transport leaves literal photo-looking text and URLs in user fields unchanged',()=>{
 const media=new RendererMedia(),uri=media.project(photo),text={name:photo,privateNotes:'paddock-media:notes',technical:{technicalNotes:uri},description:photo};
 assert.deepEqual(media.project(text),text);assert.deepEqual(media.expand(text),text);
 assert.throws(()=>media.expand({picture:'paddock-media://image/unknown'}),/expired/);
});

test('sparse image patches retain lightweight URLs while custom values and choices remain literal',()=>{
 const media=new RendererMedia(),input={dataPatch:{changes:[{path:['cars'],order:['car'],records:[{id:'car',changes:[
  {path:['picture'],value:photo},{path:['privateNotes'],value:photo},{path:['custom','picture'],value:photo},{path:['custom'],value:{data:photo}}
 ]}]}]}};
 const result=media.project(input),changes=result.dataPatch.changes[0].records[0].changes;
 assert.match(changes[0].value,/^paddock-media:/);assert.equal(changes[1].value,photo);assert.equal(changes[2].value,photo);assert.deepEqual(changes[3].value,{data:photo});assert.deepEqual(media.expand(result),input);
 assert.deepEqual(media.project({choices:{picture:[photo]},custom:{picture:photo}}),{choices:{picture:[photo]},custom:{picture:photo}});
});
