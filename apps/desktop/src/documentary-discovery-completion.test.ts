import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryDiscoveryCompleted} from './documentary-discovery-completion.js';

test('healthy empty local catalogue does not exhaust failed remote searches',()=>{
  assert.equal(documentaryDiscoveryCompleted({candidates:[],sources:[{provider:'local'},
    ...['commons','pexels','pixabay','web'].map(provider=>({provider,error:'Provider temporarily unavailable'}))]}),false);
});
test('successful remote empty, candidates, legacy response and local-only success retain exhaustion evidence',()=>{
  for(const result of [
    {candidates:[],sources:[{provider:'local'},{provider:'commons'},{provider:'web',error:'Temporary outage'}]},
    {candidates:[{id:'licensed-source'}],sources:[{provider:'web',error:'Partial response'}]},
    {candidates:[],sources:[]},
    {candidates:[],sources:[{provider:'local'}]},
  ])assert.equal(documentaryDiscoveryCompleted(result),true);
  assert.equal(documentaryDiscoveryCompleted({candidates:[],sources:[{provider:'local',error:'Unreadable catalogue'}]}),false);
});
