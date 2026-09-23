// Unit checks for the photo-size search; the canvas encoder is replaced by a fake.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=await readFile('lib/photo-compression.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {fitWithinLimit,compressPhoto,PHOTO_LIMIT_BYTES,PhotoTooLargeError}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

// Encoded size grows with pixel count, like a real JPEG encoder. Only size is read.
function fakeEncoder(bytesAtFullScale){const scales=[];return {scales,encode:async scale=>{scales.push(scale);return {size:Math.round(bytesAtFullScale*scale*scale)}}}}

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
