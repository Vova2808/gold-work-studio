import test from 'node:test';
import assert from 'node:assert/strict';
import type {Project} from '@gold-work/shared';
import {explicitScriptChapters,mapScriptChapters} from './documentary-script-chapters.js';

function project(script:string,narration:string[],language='es'):Project{
  return {language,videoBrief:{readyScript:script},scenes:narration.map((text,order)=>({id:`s${order}`,order,narration:text,durationSeconds:10,audioPath:`voice${order}.wav`,
    documentary:{timing:{durationInFrames:300,speechSeconds:10}}}))} as Project;
}
for(const [language,heading,title,number] of [
  ['es','Capítulo 7: La caída','La caída','7'],['de','Kapitel IV — Der Wendepunkt','Der Wendepunkt','IV'],
  ['en','## Chapter 2: The return','The return','2'],['ru','### 3. Последний рейс','Последний рейс','3'],
  ['ru','Глава 9: Возвращение','Возвращение','9'],['de','## Die Rückkehr','Die Rückkehr',undefined]
] as const)test(`explicit ${language} heading maps from full script even when narration omits it: ${heading}`,()=>{
  const p=project(`Intro first.\n\n${heading}\n\nSecond paragraph begins.`,['Intro first.','Second paragraph begins.'],language);
  const original=JSON.stringify(p),mapped=mapScriptChapters(p);
  assert.equal(mapped.size,1);assert.deepEqual(mapped.get('s1'),{title,number,scriptOffset:14,startSeconds:0});
  assert.equal(JSON.stringify(p),original,'no source-script/audio/duration rewrite');
});

test('ordinary narration, lists and prose mentioning a chapter create zero headings',()=>{
  const scripts=['La historia comienza aquí. Después llega el silencio.','Ein Schiff verschwand. Niemand wusste warum.',
    'The first chapter of the story begins at sea.\nChapter 2 explains the engine failure.',
    'Глава компании вернулся домой.\nПервый этап закончился.','1. Buy the ticket\n2. Board the ship','TODAY EVERYTHING CHANGES'];
  for(const script of scripts){assert.deepEqual(explicitScriptChapters(script),[]);assert.equal(mapScriptChapters(project(script,[script])).size,0);}
});

test('chapter within a real scene gets a positive local offset, not a fabricated zero',()=>{
  const p=project('Antes uno dos.\n\nCapítulo 2: La caída\n\nDespués cuatro cinco.', ['Antes uno dos. Después cuatro cinco.']);
  assert.equal(mapScriptChapters(p).get('s0')?.startSeconds,5);
});

test('unmatched, omitted or excluded opening does not move its chapter to scene zero',()=>{
  const script='Capítulo 1: El viaje\n\nPrimero navegan al norte.\nLuego todos regresan.';
  assert.equal(mapScriptChapters(project(script,['Un texto diferente.'])).size,0);
  assert.equal(mapScriptChapters(project(script,['Luego todos regresan.'])).size,0);
  const p=project(script,['Primero navegan al norte.','Luego todos regresan.']);p.scenes[0]!.includeInAssembly=false;
  assert.equal(mapScriptChapters(p).size,0);
});

test('spoken heading stays literal and a later real heading is matched beyond an earlier section',()=>{
  const p=project('## La salida\nVamos al mar.\n\n## El regreso\nVolvemos al puerto.', ['La salida Vamos al mar.','Volvemos al puerto.']);
  assert.equal(mapScriptChapters(p).get('s0')?.title,'La salida');
  assert.equal(mapScriptChapters(p).get('s1')?.title,'El regreso');
});
