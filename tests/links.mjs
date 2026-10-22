// Unit checks for finding links and YouTube videos in chat messages and board posts.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=await readFile('lib/links.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {splitLinks,youtubeId,youtubeIds}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('text without a link stays one plain part', ()=>{
  // Arrange
  const text='See you at 7 on the turf.';
  // Act
  const parts=splitLinks(text);
  // Assert
  assert.deepEqual(parts,[{text}]);
});

test('a link in the middle of text becomes its own part', ()=>{
  // Act
  const parts=splitLinks('Highlights: https://youtu.be/dQw4w9WgXcQ enjoy');
  // Assert
  assert.deepEqual(parts,[{text:'Highlights: '},{text:'https://youtu.be/dQw4w9WgXcQ',url:'https://youtu.be/dQw4w9WgXcQ'},{text:' enjoy'}]);
});

test('trailing sentence punctuation is left out of the link', ()=>{
  // Act
  const parts=splitLinks('Watch this (https://example.com/a?b=1).');
  // Assert
  assert.deepEqual(parts,[{text:'Watch this ('},{text:'https://example.com/a?b=1',url:'https://example.com/a?b=1'},{text:').'}]);
});

test('a www link is linked over https', ()=>{
  // Act
  const parts=splitLinks('www.prithvifc.ca');
  // Assert
  assert.deepEqual(parts,[{text:'www.prithvifc.ca',url:'https://www.prithvifc.ca'}]);
});

test('non-web schemes are not linked', ()=>{
  // Act
  const parts=splitLinks('javascript:alert(1) and ftp://x.com');
  // Assert
  assert.deepEqual(parts,[{text:'javascript:alert(1) and ftp://x.com'}]);
});

test('every common YouTube link shape gives the video id', ()=>{
  // Arrange
  const links=['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s','https://youtu.be/dQw4w9WgXcQ?si=abc','https://m.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ','https://www.youtube.com/embed/dQw4w9WgXcQ'];
  // Act
  const ids=links.map(youtubeId);
  // Assert
  assert.deepEqual(ids,links.map(()=>'dQw4w9WgXcQ'));
});

test('links that are not YouTube videos give no video id', ()=>{
  // Arrange
  const links=['https://example.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/@club','https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ','https://www.youtube.com/watch?v=short'];
  // Act
  const ids=links.map(youtubeId);
  // Assert
  assert.deepEqual(ids,[null,null,null,null]);
});

test('a video linked twice in one message is previewed once', ()=>{
  // Act
  const ids=youtubeIds('https://youtu.be/dQw4w9WgXcQ and https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  // Assert
  assert.deepEqual(ids,['dQw4w9WgXcQ']);
});
