import test from 'node:test';
import assert from 'node:assert/strict';
import {documentarySourceEvidence,validateDocumentaryLocationEvidence} from './documentary-source-evidence.js';

test('a conflicting URL remains weak evidence and prevents confident location approval',()=>{
  const source=documentarySourceEvidence({title:'A red boat near a city',description:'Palm trees and buildings beside the water.',
    pageUrl:'https://www.pexels.com/photo/a-motorboat-swimming-in-port-in-istanbul-16750112/'});
  const result=validateDocumentaryLocationEvidence(source,{status:'conflict',place:'Istanbul',field:'urlSlug',quote:'port in istanbul'},'Suez Canal');
  assert.ok(result.issue);assert.equal(result.evidence?.status,'conflict');assert.equal(result.evidence?.strength,'weak');
  assert.equal(result.evidence?.sourceFingerprint,source.fingerprint);assert.equal(result.evidence?.requiredLocation,'Suez Canal');
  assert.equal(source.location,undefined,'A slug is not promoted into an actual location field');
});

test('source-attributed Suez and Cape Town remain eligible in their permitted visual context',()=>{
  for(const item of [
    {title:'Ships in Suez',description:'Cargo ships near Suez.',location:'Egypt',place:'Suez',field:'title',quote:'Ships in Suez',required:'Suez Canal'},
    {title:'Scenic View of Harbor and Mountains in Cape Town',description:'A modern harbor.',place:'Cape Town',field:'title',quote:'in Cape Town',required:'Southern Africa'},
    {title:'Harbor',description:'Cargo ships near Suez.',location:'Egypt',place:'Egypt',field:'location',quote:'Egypt',required:'Egypt'},
  ]){
    const source=documentarySourceEvidence(item);
    const result=validateDocumentaryLocationEvidence(source,{status:'supported',place:item.place,field:item.field,quote:item.quote},item.required);
    assert.equal(result.issue,undefined);assert.equal(result.evidence?.status,'supported');assert.equal(result.evidence?.strength,'source');
  }
});

test('the caller may permit a modern Greenwich view despite a historical Dumbarton narration',()=>{
  const source=documentarySourceEvidence({title:'Cutty Sark at Greenwich',description:'The preserved museum ship today.'});
  const result=validateDocumentaryLocationEvidence(source,{status:'supported',place:'Greenwich',field:'title',quote:'at Greenwich'},'Greenwich');
  assert.equal(result.issue,undefined);assert.equal(result.evidence?.requiredLocation,'Greenwich');
  assert.equal(result.evidence?.status,'supported');
});

test('neutral source metadata or absent geographic evidence does not reject all illustrations',()=>{
  const source=documentarySourceEvidence({title:'A harbor with boats',description:'Calm water and buildings.'});
  for(const value of [undefined,null,{status:'unspecified'}]){
    const result=validateDocumentaryLocationEvidence(source,value,'Suez Canal');
    assert.equal(result.issue,undefined);assert.equal(result.evidence?.status,'unspecified');assert.equal(result.evidence?.place,undefined);
  }
});

test('a matching URL alone is a hint, not confirmed geography',()=>{
  const source=documentarySourceEvidence({pageUrl:'https://www.pexels.com/photo/ships-in-suez-16574945/'});
  for(const [field,quote] of [['urlSlug','ships in suez'],['pageUrl','ships-in-suez']]){
    const result=validateDocumentaryLocationEvidence(source,{status:'supported',place:'Suez',field,quote},'Suez Canal');
    assert.equal(result.issue,undefined);assert.equal(result.evidence?.status,'hint');assert.equal(result.evidence?.strength,'weak');
  }
});

test('invented quotations, fields, places and query-derived attribution cannot validate',()=>{
  const input={title:'A red boat',description:'Buildings near a harbor.',pageUrl:'https://example.org/photo/red-boat/',
    query:'Suez Canal',target:'Suez Canal in Egypt',viewDescription:'A boat in Suez'};
  const source=documentarySourceEvidence(input);
  for(const value of [
    {status:'supported',place:'Suez',field:'title',quote:'A red boat in Suez'},
    {status:'supported',place:'Suez',field:'query',quote:'Suez Canal'},
    {status:'supported',place:'Suez',field:'target',quote:'Suez Canal in Egypt'},
    {status:'supported',place:'Suez',field:'viewDescription',quote:'A boat in Suez'},
    {status:'supported',place:'Suez',field:'location',quote:'Suez'},
    {status:'supported',place:'Suez',field:'description',quote:'Buildings near a harbor.'},
    {status:'supported',place:'Suez',field:'toString',quote:'Suez'},
    {status:'supported',place:'Suez',field:['title'],quote:'A red boat'},
    {status:'unspecified',place:'Suez',field:'query',quote:'Suez Canal'},
    {status:'resolved',place:'Suez',field:'title',quote:'A red boat'},
  ]){
    const result=validateDocumentaryLocationEvidence(source,value,'Suez Canal');
    assert.ok(result.issue,JSON.stringify(value));assert.equal(result.evidence,undefined);
  }
  assert.equal(JSON.stringify(source).includes('Suez'),false);
});

test('a place cannot be invented by quoting a substring inside a different name',()=>{
  const source=documentarySourceEvidence({title:'Romeo beside a boat'});
  assert.ok(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Rome',field:'title',quote:'Rome'},'Rome').issue);
});

test('a conflict cannot be cleared by an extra model resolution or confidence flag',()=>{
  const source=documentarySourceEvidence({title:'Harbor in Port Alpha'});
  const result=validateDocumentaryLocationEvidence(source,{status:'conflict',place:'Port Alpha',field:'title',quote:'in Port Alpha',
    resolved:true,confidence:1,suitable:true},'Port Beta');
  assert.ok(result.issue);assert.equal(result.evidence?.status,'conflict');assert.equal(result.evidence?.strength,'source');
});

test('fingerprints track supplied evidence, not query, target or object key order',()=>{
  const base={title:'Ships in Suez',description:'A harbor.',location:'Egypt',pageUrl:'https://example.org/photo/ships-in-suez/'};
  const source=documentarySourceEvidence(base);
  const equivalent={pageUrl:base.pageUrl,location:base.location,description:base.description,title:base.title,query:'new query',target:'another target'};
  assert.equal(documentarySourceEvidence(equivalent).fingerprint,source.fingerprint);
  for(const replacement of [{title:'Ships elsewhere'},{description:'Another description.'},{location:'Another place'},{pageUrl:'https://example.org/photo/another-harbor/'}])
    assert.notEqual(documentarySourceEvidence({...base,...replacement}).fingerprint,source.fingerprint);
  const saved=validateDocumentaryLocationEvidence(source,{status:'supported',place:'Suez',field:'title',quote:base.title},'Suez').evidence!;
  assert.notEqual(saved.sourceFingerprint,documentarySourceEvidence({...base,title:'Ships elsewhere'}).fingerprint);
});

test('modified evidence cannot retain a stale fingerprint',()=>{
  const source=documentarySourceEvidence({title:'Ships in Suez',pageUrl:'https://example.org/photo/ships-in-suez/'});
  for(const changed of [{...source,title:'Ships elsewhere'},{...source,urlSlug:'invented place'}])
    assert.ok(validateDocumentaryLocationEvidence(changed,{status:'unspecified'}).issue);
});

test('credentials, query strings and fragments never enter the model evidence or its fingerprint',()=>{
  const safe='https://example.org/photo/harbor-in-cape-town/';
  const source=documentarySourceEvidence({pageUrl:'https://private-user:secret-password@example.org/photo/harbor-in-cape-town/?token=SECRET&location=Suez#private-fragment'});
  assert.equal(source.pageUrl,safe);assert.equal(source.urlSlug,'harbor in cape town');
  assert.equal(source.fingerprint,documentarySourceEvidence({pageUrl:safe}).fingerprint);
  for(const secret of ['private-user','secret-password','SECRET','Suez','private-fragment'])assert.equal(JSON.stringify(source).includes(secret),false);
  assert.ok(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Suez',field:'pageUrl',quote:'location=Suez'},'Suez').issue);
});

test('nonpublic or non-HTTP page references are not passed as source evidence',()=>{
  for(const pageUrl of ['file:///C:/secret.txt','javascript:alert(1)','data:text/plain,Suez','/private/page','https://localhost/photo',
    'http://127.0.0.1:9000/photo','http://0x7f000001/photo','http://192.168.1.3/photo','http://[::1]/photo','https://host.internal/photo','not a URL']){
    const source=documentarySourceEvidence({title:'Neutral source',pageUrl});
    assert.equal(source.pageUrl,undefined,pageUrl);assert.equal(source.urlSlug,undefined,pageUrl);
  }
});

test('Unicode slugs are decoded as weak hints and numeric or malformed slugs invent no place',()=>{
  const source=documentarySourceEvidence({pageUrl:'https://example.org/photo/%D0%9A%D0%B5%D0%B9%D0%BF%D1%82%D0%B0%D1%83%D0%BD/'});
  assert.equal(source.urlSlug,'Кейптаун');
  assert.equal(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Кейптаун',field:'urlSlug',quote:'Кейптаун'}).evidence?.status,'hint');
  for(const path of ['123456','%E0%A4%A'])assert.equal(documentarySourceEvidence({pageUrl:'https://example.org/photo/'+path}).urlSlug,undefined);
});

test('text is bounded without changing source input and quotes must come from the supplied portion',()=>{
  const input={title:'  Ships\n in Suez  ',description:'x'.repeat(801)+' Suez',location:' Egypt '},before=structuredClone(input);
  const source=documentarySourceEvidence(input);
  assert.deepEqual(input,before);assert.equal(source.title,'Ships in Suez');assert.equal(source.description,'','An overlong single token supplies no complete evidence');assert.equal(source.location,'Egypt');
  assert.equal(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Suez',field:'title',quote:'SHIPS   IN SUEZ'}).issue,undefined);
  assert.ok(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Suez',field:'description',quote:'Suez'}).issue);
});

for(const [field,limit] of [['title',240],['description',800],['location',240],['urlSlug',800]] as const)
  test(`truncating source ${field} cannot turn Romeo into evidence for Rome`,()=>{
    const raw='x '.repeat((limit-4)/2)+'Romeo';
    const source=documentarySourceEvidence(field==='urlSlug'
      ?{pageUrl:'https://example.org/photo/'+raw.replace(/ /g,'-')+'/'}:{[field]:raw});
    const actual=source[field]??'';
    assert.equal(actual.includes('Rome'),false,'An unfinished source token must not become a new place');
    assert.ok(actual.startsWith('x x x'));assert.ok(actual.length<=limit);
    const result=validateDocumentaryLocationEvidence(source,{status:'supported',place:'Rome',field,quote:'Rome'},'Rome');
    assert.ok(result.issue);assert.equal(result.evidence,undefined);
  });

test('a complete name at the limit remains quotable but a truncated requiredLocation gains no new token',()=>{
  const prefix='x '.repeat(118);
  for(const tail of ['Rome','Rome beside a harbor']){
    const source=documentarySourceEvidence({title:prefix+tail});
    assert.equal(validateDocumentaryLocationEvidence(source,{status:'supported',place:'Rome',field:'title',quote:'Rome'},'Rome').issue,undefined);
  }
  const source=documentarySourceEvidence({title:'Neutral harbor'});
  const result=validateDocumentaryLocationEvidence(source,{status:'unspecified'},prefix+'Romeo');
  assert.equal(result.issue,undefined);assert.equal(result.evidence?.requiredLocation?.includes('Rome'),false);
});
