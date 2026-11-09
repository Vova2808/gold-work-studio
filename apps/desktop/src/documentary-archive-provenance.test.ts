import test from 'node:test';
import assert from 'node:assert/strict';
import {documentaryNarrativeEvidenceIssue,documentarySourceEraReferences} from './documentary-scene-context.js';
const context=(text:string)=>({current:{scene:1,text},preceding:[],following:[],earlierTimeReferences:[]});
const accepted=(quote='')=>({narrativeEvidence:{subjectMatch:true,eraMatch:true,detailMatch:true,requiredEra:'none',observedEra:'none',evidence:'A clear photograph of the requested early motor carriage.',eraEvidenceQuote:quote}});
test('museum photo cannot satisfy an explicit archival-photo request hidden in nonVisual',()=>{
  assert.match(documentaryNarrativeEvidenceIssue(accepted(),{title:'Ford T model museum photograph'},context('An archival photograph shows an early motor carriage.'))??'',/Архивное/);
});
test('archive provenance requires a literal source quotation, not an invented one',()=>{
  const c=context('An archival photograph shows an early motor carriage.'),source={title:'Archive photograph of an early motor carriage'};
  assert.equal(documentaryNarrativeEvidenceIssue(accepted(source.title),source,c),undefined);
  const archiveSource={description:'Photograph from the National Archives collection'};
  assert.equal(documentaryNarrativeEvidenceIssue(accepted(archiveSource.description),archiveSource,c),undefined);
  assert.match(documentaryNarrativeEvidenceIssue(accepted('Archival original from 1908'),source,c)??'',/Архивное/);
  assert.match(documentaryNarrativeEvidenceIssue(accepted('Ford 1908 photograph'),{title:'Ford 1908 photograph'},c)??'',/Архивное/);
  assert.match(documentaryNarrativeEvidenceIssue(accepted('archive'),{title:'Car photographed in a museum archive'},c)??'',/Архивное/);
});
test('the Russian archival request also retains media provenance',()=>{
  assert.match(documentaryNarrativeEvidenceIssue(accepted(),{title:'Музейный снимок старого автомобиля'},context('Архивный снимок показывает старый автомобиль.'))??'',/Архивное/);
});
test('qualified archival wording and explicit negative source provenance cannot bypass the gate',()=>{
  assert.match(documentaryNarrativeEvidenceIssue(accepted(),{title:'Modern museum photograph'},context('An archival black-and-white photograph shows an early motor carriage.'))??'',/Архивное/);
  const title='Modern museum photograph, not an archival photograph.';
  assert.match(documentaryNarrativeEvidenceIssue(accepted(title),{title},context('An archival photograph shows an early motor carriage.'))??'',/Архивное/);
  assert.match(documentaryNarrativeEvidenceIssue(accepted('archival photograph'),{title},context('An archival photograph shows an early motor carriage.'))??'',/Архивное/);
});
test('a photo of a dated model does not acquire an archival-capture requirement',()=>{
  assert.equal(documentaryNarrativeEvidenceIssue(accepted(),{title:'1965 Ford Mustang front photograph'},context('A photograph shows the front of a 1965 Ford Mustang.')),undefined);
});
test('legacy generated search captions prove neither source year nor archival provenance',()=>{
  const hint='An archival photograph of the 1965 Ford Mustang';
  const wrap=(original:string)=>`Previous frame review, a search hint requiring new visual verification: ${hint}\nOriginal source description:\n${original}`;
  const source={title:'Museum car',description:wrap('A car photographed in a museum')};
  assert.deepEqual(documentarySourceEraReferences(source).description,[]);
  assert.match(documentaryNarrativeEvidenceIssue(accepted(hint),source,context('An archival photograph shows a Ford Mustang.'))??'',/Архивное/);
  const dated={...accepted('1965'),narrativeEvidence:{...accepted('1965').narrativeEvidence,requiredEra:'1965',observedEra:'1965'}};
  assert.ok(documentaryNarrativeEvidenceIssue(dated,source,context('The Ford Mustang in 1965.')),'A year only in a generated hint is not source evidence');
  const original='An archival photograph of the 1965 Ford Mustang';
  const genuine={title:'Car',description:wrap(wrap(original))};
  assert.deepEqual(documentarySourceEraReferences(genuine).description,['1965']);
  assert.equal(documentaryNarrativeEvidenceIssue(accepted(original),genuine,context('An archival photograph shows a Ford Mustang.')),undefined);
});
