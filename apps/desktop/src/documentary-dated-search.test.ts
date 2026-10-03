import assert from 'node:assert/strict';
import test from 'node:test';
import {documentaryDatedSearchQueries} from './documentary-dated-search.js';
import {documentaryNarrationContext} from './documentary-intelligence.js';
import type {Project,Scene} from '@gold-work/shared';

test('the complete original sentence supplies one dated query without removing its undated alternative',()=>{
  const scene={id:'b',order:1,narration:'he joined the factory team.'} as Scene;
  const project={scenes:[{id:'a',order:0,narration:'In November 2003, '},scene]} as Project;
  const queries=['Valentino Rossi team','Yamaha riders','MotoGP factory','Rossi interview'];
  assert.deepEqual(documentaryDatedSearchQueries(queries,documentaryNarrationContext(project,scene)),[
    'Valentino Rossi team 2003','Valentino Rossi team','Yamaha riders','MotoGP factory']);
  assert.equal(queries.length,4,'Original plan is not mutated');
});
test('search does not impose an inferred nearby year, choose a flashback year, or duplicate an existing dated query',()=>{
  const queries=['Rossi race','Yamaha team'];
  const scene={id:'b',order:1,narration:'The engine made more power.'} as Scene;
  const project={scenes:[{id:'a',order:0,narration:'He won in 2004.'},scene]} as Project;
  assert.strictEqual(documentaryDatedSearchQueries(queries,documentaryNarrationContext(project,scene)),queries);
  assert.strictEqual(documentaryDatedSearchQueries(queries,'The 2004 win was the first since 1992.'),queries);
  const dated=['Rossi race','Yamaha team 2004'];
  assert.strictEqual(documentaryDatedSearchQueries(dated,'He won in 2004.'),dated);
});
