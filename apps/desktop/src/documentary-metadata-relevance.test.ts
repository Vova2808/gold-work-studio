import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryMetadataRelevance,documentaryMetadataRelevanceIssue} from './documentary-metadata-relevance.js';

test('a real title outranks a passing full-page mention and repeated stock tags',()=>{
  const target={subject:'North Observatory',visualTarget:'North Observatory telescope'};
  const exact={title:'North Observatory telescope',description:'',provider:'commons' as const};
  const foreign={title:'A collection of vintage hats',description:'Unrelated catalogue. '+'fashion '.repeat(100)+'North Observatory telescope',provider:'web' as const};
  const tags={title:'Vintage hat',description:'North Observatory telescope '.repeat(100),provider:'pixabay' as const};
  assert.ok(documentaryMetadataRelevance(exact,target)>documentaryMetadataRelevance(tags,target));
  assert.ok(documentaryMetadataRelevanceIssue(foreign,target));
  assert.ok(documentaryMetadataRelevanceIssue(tags,target));
  assert.equal(documentaryMetadataRelevanceIssue(exact,target),undefined);
});

test('short legitimate archive labels remain available while explicit AI classes reject namesakes',()=>{
  const target={subject:'Aurora',visualTarget:'Aurora sailing vessel',objectClass:'sailing vessel',excludedClasses:['aircraft','person portrait']};
  assert.equal(documentaryMetadataRelevanceIssue({title:'Aurora',description:'',provider:'commons'},target),undefined);
  assert.ok(documentaryMetadataRelevanceIssue({title:'Aurora aircraft',description:'Aurora',provider:'commons'},target));
  assert.equal(documentaryMetadataRelevanceIssue({title:'Uncatalogued',description:'',provider:'local'},target),undefined);
});

test('Pixabay tags copied into the title count once and long tag soups lose to concise labels',()=>{
  const target={visualTarget:'glass telescope'};
  const tags='glass telescope hat clothing fashion forest meadow sun sky mountain field road engine truck cruise tourism music book bird animal kitchen water food';
  const soup={title:tags,description:tags,provider:'pixabay' as const};
  const label={title:'glass telescope',description:'glass telescope',provider:'pixabay' as const};
  assert.ok(documentaryMetadataRelevanceIssue(soup,target));
  assert.equal(documentaryMetadataRelevanceIssue(label,target),undefined);
  assert.ok(documentaryMetadataRelevance(label,target)>documentaryMetadataRelevance(soup,target));
});
