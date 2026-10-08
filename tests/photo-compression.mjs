// Unit checks for the photo-size search; the canvas encoder is replaced by a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=await readFile('lib/photo-compression.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {fitWithinLimit,compressPhoto,cropPhoto,PHOTO_LIMIT_BYTES,PhotoTooLargeError,PhotoUnreadableError}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

// Encoded size grows with pixel count, like a real JPEG encoder. Only size is read.
function fakeEncoder(bytesAtFullScale){const scales=[];return {scales,encode:async scale=>{scales.push(scale);return {size:Math.round(bytesAtFullScale*scale*scale)}}}}
// Stands in for the browser's image decoder and canvas; JPEG output size tracks the canvas pixel count.
function fakeBrowser({width,height,bytesPerPixel}){const canvases=[],bitmap={width,height,closed:false,close(){bitmap.closed=true}};globalThis.createImageBitmap=async()=>bitmap;globalThis.document={createElement:tag=>{assert.equal(tag,'canvas');const canvas={width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){canvas.drawn=args}}),toBlob:(done,type)=>done(new Blob([new Uint8Array(Math.round(canvas.width*canvas.height*bytesPerPixel))],{type}))};canvases.push(canvas);return canvas}};return {bitmap,canvases}}

test('photo that already fits the limit is uploaded unchanged', async()=>{
  // Arrange
  const photo=new File([new Uint8Array(1000)],'me.png',{type:'image/png'});
  // Act
  const prepared=await compressPhoto(photo);
  // Assert
  assert.equal(prepared,photo);
});

test('first encoding is kept when it fits the limit', async()=>{
  // Arrange
  const encoder=fakeEncoder(1_000_000);
  // Act
  const blob=await fitWithinLimit(encoder.encode,{limit:PHOTO_LIMIT_BYTES,initialScale:1,minScale:0.1});
  // Assert
  assert.equal(encoder.scales.length,1);
  assert.equal(blob.size,1_000_000);
});

test('oversized photo is scaled down until it fits the limit', async()=>{
  // Arrange
  const encoder=fakeEncoder(12_000_000);
  // Act
  const blob=await fitWithinLimit(encoder.encode,{limit:PHOTO_LIMIT_BYTES,initialScale:1,minScale:0.1});
  // Assert
  assert.ok(blob.size<=PHOTO_LIMIT_BYTES,`encoded ${blob.size} bytes`);
  assert.ok(encoder.scales.length<=3,`took ${encoder.scales.length} encodes`);
  assert.ok(blob.size>PHOTO_LIMIT_BYTES*0.5,'does not shrink far more than needed');
});

test('photo that cannot fit above the minimum size is rejected', async()=>{
  // Arrange
  const encoder=fakeEncoder(10_000_000_000);
  // Act / Assert
  await assert.rejects(fitWithinLimit(encoder.encode,{limit:PHOTO_LIMIT_BYTES,initialScale:1,minScale:0.2}),PhotoTooLargeError);
  assert.ok(encoder.scales.every(scale=>scale>=0.2),'never encodes below the minimum scale');
});

test('oversized photo is re-encoded as a JPEG under the limit', async()=>{
  // Arrange
  const browser=fakeBrowser({width:4000,height:3000,bytesPerPixel:1});
  const photo=new File([new Uint8Array(PHOTO_LIMIT_BYTES+1)],'match.day.png',{type:'image/png'});
  // Act
  const prepared=await compressPhoto(photo);
  // Assert
  assert.ok(prepared.size<=PHOTO_LIMIT_BYTES,`prepared ${prepared.size} bytes`);
  assert.equal(prepared.type,'image/jpeg');
  assert.equal(prepared.name,'match.day.jpg');
  assert.ok(browser.canvases.every(c=>Math.max(c.width,c.height)<=2560),'never encodes above the maximum edge');
  assert.ok(browser.bitmap.closed,'releases the decoded image');
});

test('oversized photo the browser cannot decode is rejected as unreadable', async()=>{
  // Arrange
  fakeBrowser({width:1,height:1,bytesPerPixel:1});
  globalThis.createImageBitmap=async()=>{throw new DOMException('bad image','InvalidStateError')};
  const photo=new File([new Uint8Array(PHOTO_LIMIT_BYTES+1)],'broken.webp',{type:'image/webp'});
  // Act / Assert
  await assert.rejects(compressPhoto(photo),PhotoUnreadableError);
});

test('cropped photo is the chosen square region, encoded as a JPEG', async()=>{
  // Arrange
  const browser=fakeBrowser({width:3000,height:2000,bytesPerPixel:1});
  const photo=new File([new Uint8Array(10)],'portrait.png',{type:'image/png'});
  // Act
  const cropped=await cropPhoto(photo,{x:400,y:200,width:600,height:600});
  // Assert
  const [canvas]=browser.canvases;
  assert.equal(canvas.width,600);
  assert.equal(canvas.height,600);
  assert.deepEqual(canvas.drawn.slice(1),[400,200,600,600,0,0,600,600]);
  assert.equal(cropped.type,'image/jpeg');
  assert.equal(cropped.name,'portrait.jpg');
  assert.ok(browser.bitmap.closed,'releases the decoded image');
});

test('a large cropped region is scaled down to the portrait size', async()=>{
  // Arrange
  const browser=fakeBrowser({width:6000,height:4000,bytesPerPixel:1});
  const photo=new File([new Uint8Array(10)],'camera.jpg',{type:'image/jpeg'});
  // Act
  await cropPhoto(photo,{x:0,y:0,width:4000,height:4000});
  // Assert
  const [canvas]=browser.canvases;
  assert.equal(canvas.width,1024);
  assert.equal(canvas.height,1024);
  assert.deepEqual(canvas.drawn.slice(1),[0,0,4000,4000,0,0,1024,1024]);
});
