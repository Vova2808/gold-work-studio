import test from 'node:test';
import assert from 'node:assert/strict';
import {documentarySearchQueries,documentaryStockQueries} from './documentary-project-service.js';

test('discovery keeps a provided title qualifier instead of searching a common word',()=>{
  const requirement={text:'The film was released.',entities:['Faster'],identities:[{name:'Faster',aliases:['Faster','Faster (2003 film)']}],years:['2003'],queries:['film editing suite','Faster documentary production']};
  const queries=documentarySearchQueries(requirement,'image');
  assert.ok(queries.some(q=>q.includes('Faster (2003 film) film editing suite')));
  assert.ok(queries.some(q=>q.includes('Faster (2003 film) documentary production')));
  assert.ok(queries.includes('film editing suite'),'One literal detail query may find visual evidence hidden by the inherited title');
  assert.ok(queries.includes('Faster (2003 film)'));
  assert.equal(requirement.queries[1],'Faster documentary production','Do not rewrite the saved script/search plan');
  assert.deepEqual(documentarySearchQueries({...requirement,identities:[{name:'Faster',aliases:['Faster']}],queries:['Faster documentary']}),['Faster documentary','Faster']);
});

test('physical-detail footage queries do not spend source slots on an unobservable sound word',()=>{
  const requirement={text:'It gave the engine an uneven firing order, called a big bang engine.',entities:['Yamaha YZR-M1'],
    identities:[{name:'Yamaha YZR-M1',aliases:['Yamaha YZR-M1','YZR-M1']}],years:[],
    queries:['big bang engine firing order MotoGP','Yamaha M1 uneven firing order engine sound']};
  assert.ok(documentarySearchQueries(requirement,'image').every(query=>!/\bsound\b/i.test(query)));
  assert.ok(documentaryStockQueries(requirement).every(query=>!/\bsound\b/i.test(query)));
  assert.equal(requirement.queries[1],'Yamaha M1 uneven firing order engine sound');
});
