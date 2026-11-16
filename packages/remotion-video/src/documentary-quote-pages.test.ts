import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryQuotePageRanges} from './documentary-quote-pages.js';
import {documentaryPhraseWords} from './documentary-editorial.js';

test('long narration pages preserve every word and its reading index',()=>{
  const narration=Array.from({length:180},(_,i)=>`word${i}`).join(' '),words=documentaryPhraseWords(narration),ranges=documentaryQuotePageRanges(words);
  assert.ok(ranges.length>3);
  const pages=ranges.map(range=>words.slice(range.from,range.to));
  assert.equal(pages.flat().map(word=>word.text+word.space).join(''),narration);
  assert.ok(pages.every(page=>page.map(word=>word.text).join(' ').length<=220));
  assert.deepEqual(pages.flat().map(word=>word.readingIndex),words.map(word=>word.readingIndex));
});
