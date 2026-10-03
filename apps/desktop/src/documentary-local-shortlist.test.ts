import test from 'node:test';
import assert from 'node:assert/strict';
import type {Scene,DocumentaryCandidate} from '@gold-work/shared';
import {documentaryLocalShortlistCandidates} from './documentary-local-shortlist.js';
import type {DocumentarySceneContext} from './documentary-scene-context.js';

test('dated original context cannot bypass semantic metadata ranking when the planner omitted years',()=>{
 const scene={documentary:{requirement:{identities:[{name:'Valentino Rossi',aliases:[]}],years:[]}}} as never;
 const candidates=[{kind:'image',title:'Valentino Rossi',description:'2014 Silverstone Grand Prix',localPath:'fixture.jpg'}] as DocumentaryCandidate[];
 const context:DocumentarySceneContext={current:{scene:227,text:'Rossi had eight wins at that point.'},
   preceding:[{scene:223,text:'In October 2004 he won the title.'},{scene:226,text:'The first since 1992.'}],following:[],earlierTimeReferences:[]};
 assert.deepEqual(documentaryLocalShortlistCandidates(scene,candidates,context),[]);
 assert.deepEqual(documentaryLocalShortlistCandidates(scene,candidates,{...context,preceding:[]}),candidates,'Undated material retains the optional local shortcut');
 assert.deepEqual(documentaryLocalShortlistCandidates(scene,candidates,{...context,earlierTimeReferences:context.preceding,preceding:[]}),[],'A long explanation can refer to an earlier dated event');
});
import {documentaryCheckpointKey} from './documentary-checkpoint-key.js';
import {createHash} from 'node:crypto';

test('local visual shortlist preserves exact provenance and years, excluding ambiguous names and unsampled videos',()=>{
 const scene={documentary:{requirement:{identities:[{name:'Honda RC211V',aliases:['Honda RC 211V']}],years:['2002']}}} as Scene;
 const source=(title:string,kind='image')=>({title,kind,description:'',previewUrl:'https://example.test/preview.jpg'}) as DocumentaryCandidate;
 const exact=source('Honda RC211V 2002'),alias=source('Honda RC 211V 2002');
 assert.deepEqual(documentaryLocalShortlistCandidates(scene,[source('Honda RC211V 2005'),source('Honda RC211V2 2002'),source('Yamaha 2002'),source('Honda RC211V 2002','video'),exact,alias]),[exact,alias]);
 scene.documentary!.requirement.identities=[{name:'Faster',aliases:[]}];scene.documentary!.requirement.years=[];
 assert.deepEqual(documentaryLocalShortlistCandidates(scene,[source('Make Windows Faster')]),[]);
});

test('checkpoint serialization cache notices a changed frame in a reused array',()=>{
 const images=['first'];documentaryCheckpointKey('review','policy','input',images);
 images[0]='new frame';images.push('"newline\n');
 assert.equal(documentaryCheckpointKey('review','policy','input',images),createHash('sha256').update(JSON.stringify([2,'review','policy','input',images])).digest('hex'));
});
