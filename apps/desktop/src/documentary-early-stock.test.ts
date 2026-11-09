import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryProjectRepository, MockDirectorProvider, ProjectService } from '@gold-work/core';
import { createVoiceCalibration, type DocumentaryCandidate } from '@gold-work/shared';
import { DocumentaryProjectService } from './documentary-project-service.js';
import { DocumentarySearch } from './documentary-search.js';
import { DocumentaryAnalysisError } from './documentary-analysis-error.js';
import { LocalProjectStorage } from './local-project-storage.js';
import { prepareDocumentaryScript } from './documentary-plan.js';
import { effectFfmpeg } from './effect-media.js';

async function runSelection(t: TestContext, outcome: 'accepted' | 'rejected' | 'pending' | 'all-rejected' | 'ambiguous', kind: 'image' | 'video' = 'image', named = false, refinement = false, outage = false, unknownLocal = false, broadGeneral = false, namedEstablishing = false, freshHint = false) {
  const root = await mkdtemp(join(tmpdir(), 'gws-early-stock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const image = join(root, 'image.png');
  await effectFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080', '-frames:v', '1', image]);
  const archiveImage = join(root, 'archive.png');
  await effectFfmpeg(['-y', '-i', image, '-vf', 'hflip', '-frames:v', '1', archiveImage]);
  const video = join(root, 'video.mp4');
  if (kind === 'video') await effectFfmpeg(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=2:d=5', '-c:v', 'libx264', '-preset', 'ultrafast', video]);
  const projects = new ProjectService(new MemoryProjectRepository(), new MockDirectorProvider());
  let p = await projects.create({ title: 'Early source check', topic: 'Mechanisms', mediaMode: 'stock', mode: 'standard', language: 'en', aspectRatio: '16:9' });
  p.videoBrief = { ...p.videoBrief!, creationMode: 'script', readyScript: named ? 'The Honda RC211V engine piston moves inside the cylinder.' : 'The engine piston moves inside the cylinder.' };
  const calibration = createVoiceCalibration({ provider: 'elevenlabs', voice: 'fixture', language: 'en', sampleText: p.videoBrief.readyScript!, audioDurationSeconds: 3 });
  const scene = prepareDocumentaryScript(p, calibration)[0]!;
  scene.audioPath = 'preserved-paid-voice.mp3';
  scene.documentary!.requirement = { ...scene.documentary!.requirement, identities: [], entities: ['engine piston'], years: [], queries: ['engine piston detail'], preferredKind: kind, plannedBy: 'semantic' };
  if (named) Object.assign(scene.documentary!.requirement, {identities: [{name: 'Honda RC211V', aliases: []}], entities: ['Honda RC211V'], queries: ['Honda RC211V engine piston detail']});
  if (broadGeneral) {
    scene.narration = 'This channel covers motorcycle racing.';
    Object.assign(scene.documentary!.requirement, {text:scene.narration,identityContextVersion:3,identities:[],entities:[],years:[],
      queries:['archival motorcycle racing footage montage','historic motorcycle race film reel']});
  }
  if(namedEstablishing){
    scene.narration='Honda RC211V had a rider-friendly design.';
    Object.assign(scene.documentary!.requirement,{text:scene.narration,identities:[{name:'Honda RC211V',aliases:[]}],
      entities:['Honda RC211V'],years:[],queries:['Honda RC211V motorcycle design']});
  }
  p = await projects.update(p.id, { settings: { ...p.settings, stockVideoPercent: kind === 'video' ? 100 : 0 }, scenes: [scene] });
  const stock: DocumentaryCandidate = { id: 'stock', provider: 'pexels', kind, title: outcome === 'ambiguous' ? 'Workshop' : 'Engine piston detail', description: 'A piston inside an engine',
    pageUrl: 'https://example.test/stock', downloadUrl: '', localPath: kind === 'video' ? video : image, width: 1920, height: 1080, durationSeconds: kind === 'video' ? 5 : undefined, author: 'Fixture', license: 'CC0', licenseUrl: 'https://example.test/license',
    rights: 'public-domain', attribution: 'Fixture', query: 'engine piston detail', retrievedAt: 'now', match: 'unverified', concerns: [] };
  const fallback = { ...stock, id: 'archive', provider: 'commons' as const, title: 'Engine piston detail in a cylinder', localPath: archiveImage, downloadUrl: 'https://example.test/archive.png' };
  if (named) { stock.title = 'Honda RC211V engine piston detail'; fallback.title = 'Honda RC211V engine piston detail in a cylinder'; }
  if (broadGeneral) stock.title = 'Motorcycle racing on track';
  if (namedEstablishing) {stock.title='Honda RC211V on display';fallback.title='Honda RC211V museum motorcycle';}
  const inspections: string[] = [], searches: string[][] = [], searchedQueries: string[] = [], rankedPools: string[][] = [];let refinements=0;
  const search = new DocumentarySearch();
  search.search = async input => {
    searches.push(input.providers!);searchedQueries.push(input.query);
    if (input.kind !== kind) return { candidates: [], sources: [] };
    if (outage) return {candidates:[],sources:[{provider:'commons',count:0,error:'HTTP 429: Источник ограничил доступ'}]};
    if (broadGeneral && input.query !== 'motorcycle racing') return {candidates:[],sources:[]};
    return { candidates: unknownLocal ? input.providers!.includes('commons') ? [fallback] : []
      : input.providers!.includes('commons') ? [stock, fallback, { ...fallback, id: 'archive-extra', downloadUrl: 'https://example.test/archive-extra.png' }] : [stock],
      sources: [] };
  };
  const service:DocumentaryProjectService = new DocumentaryProjectService(projects, new LocalProjectStorage(join(root, 'workspace')), search, join(root, 'Materials'),
    { download: async () => { throw new Error('Local fixtures only'); } }, () => {}, {
      available: async () => true,
      plan: async (_project, scenes) => new Map(scenes.map(s => [s.id, scene.documentary!.requirement])),
      rankCandidates: async (_project, _scene, candidates) => { rankedPools.push(candidates.map(c => c.id)); return candidates; },
      ...(unknownLocal?{rankLocalCandidates:async(_project:unknown,_scene:unknown,candidates:DocumentaryCandidate[])=>candidates,cataloguedCandidates:()=>[]}:{}),
      ...(refinement?{refineQueries:async(_project:unknown,scenes:typeof p.scenes)=>{refinements++;return new Map(scenes.map(s=>[s.id,['engine piston cylinder refined']]));}}:{}),
      inspect: async (_project, current) => {
        if(freshHint)assert.deepEqual(await service.localCandidates('cylinder housing'),[],'Prime the local hint cache before this source is accepted');
        const id = current.documentary!.selected!.id;
        inspections.push(id);
        if (id === 'stock' && outcome === 'pending') throw new DocumentaryAnalysisError('Existing partial: no repeat', 'pending', 'visual-overview');
        return { status: outcome === 'all-rejected' || id === 'stock' && outcome !== 'accepted' ? 'rejected' as const : 'accepted' as const,
          confidence: .99, reason: 'Fixture frame review', quality: 'clear', checkedAt: 'now', sampleSeconds: [0],
          ...(freshHint?{scriptEvidence:{version:1 as const,scriptText:current.narration,checks:[
            {requirementId:'piston',kind:'object' as const,scriptQuote:'piston',required:'piston',match:true,evidence:'Visible cylinder housing surrounds the piston.'},
            {requirementId:'other',kind:'object' as const,scriptQuote:'piston',required:'piston',match:false,evidence:'Unproven discarded blueprint'}]}}:{}) };
      }
    });
  if(unknownLocal)service.localCandidates=async()=>[stock];
  const result = await service.autoSelect(p.id, { sceneIds: [scene.id] });
  assert.equal(result.project.scenes[0]!.audioPath, scene.audioPath);
  assert.equal(result.project.scenes[0]!.narration, scene.narration);
  const freshMatches=freshHint?await service.localCandidates('cylinder housing'):[];
  const unprovenMatches=freshHint?await service.localCandidates('discarded blueprint'):[];
  return { result, inspections, searches, searchedQueries, rankedPools, refinements, freshMatches, unprovenMatches };
}

test('a new accepted observation becomes searchable in the same run without changing source metadata',async t=>{
  const {result,freshMatches,unprovenMatches}=await runSelection(t,'accepted','image',false,false,false,false,false,false,true);
  assert.equal(result.selected,1,'Mock selection establishes only orchestration evidence');
  assert.equal(freshMatches.length,1,'A primed hint cache sees the newly saved accepted source');
  assert.equal(freshMatches[0]!.description,'A piston inside an engine');
  assert.match(freshMatches[0]!.previousFrameSearchHint!,/cylinder housing/);
  assert.deepEqual(unprovenMatches,[],'An unconfirmed observation never becomes a search hint');
});

test('uncatalogued library footage remains eligible after the broad search starts',async t=>{
  const {result,inspections,rankedPools,searches}=await runSelection(t,'accepted','video',true,false,false,true);
  assert.equal(result.selected,1);assert.deepEqual(inspections,['stock']);
  assert.equal(rankedPools.length,1,'Rank the combined discovery pool once');
  assert.ok(rankedPools[0]!.includes('stock'),`Unknown cached source must remain eligible: ${JSON.stringify({rankedPools,searches})}`);
  assert.ok(searches.some(providers=>providers.includes('pexels')));
});

test('search refinement cannot inspect the same rejected sources again in one run',async t=>{
  const {inspections,refinements}=await runSelection(t,'all-rejected','image',false,true);
  assert.equal(refinements,1);assert.equal(new Set(inspections).size,inspections.length);assert.ok(inspections.length>=2);
});

test('source rate limits with no candidates do not trigger a paid semantic query rewrite',async t=>{
  const {refinements}=await runSelection(t,'all-rejected','image',false,true,true);
  assert.equal(refinements,0);
});

test('an obvious stock candidate reaches real media inspection without waiting for archive search or paid ranking', async t => {
  const { result, inspections, searches, rankedPools } = await runSelection(t, 'accepted');
  assert.equal(result.selected, 1);
  assert.deepEqual(inspections, ['stock']);
  assert.equal(searches.some(providers => providers.includes('internet-archive') || providers.includes('youtube')), false);
  assert.equal(rankedPools.length, 0);
});

test('early stock video preserves the selected video share and prepares a real range poster', async t => {
  const { result, inspections, searches, rankedPools } = await runSelection(t, 'accepted', 'video');
  assert.equal(result.selected, 1);
  assert.deepEqual(inspections, ['stock']);
  assert.equal(result.project.scenes[0]!.documentary!.selected!.kind, 'video');
  assert.ok(result.project.scenes[0]!.videoPath);
  assert.ok(result.project.scenes[0]!.imagePath);
  assert.equal(result.project.settings.stockVideoPercent, 100);
  assert.equal(searches.some(providers => providers.includes('internet-archive') || providers.includes('youtube')), false);
  assert.equal(rankedPools.length, 0);
});

test('an undated editorial scene tries a broad subject after two empty descriptive stock searches',async t=>{
  const {result,inspections,searches,searchedQueries,rankedPools}=await runSelection(t,'accepted','video',false,false,false,false,true);
  assert.equal(result.selected,1);
  assert.deepEqual(inspections,['stock']);
  assert.deepEqual(searchedQueries.slice(0,3),['motorcycle racing montage','historic motorcycle race film reel','motorcycle racing']);
  assert.equal(searches.some(providers=>providers.includes('internet-archive')||providers.includes('youtube')),false);
  assert.equal(rankedPools.length,0,'Actual frames still decide; no paid metadata ranking for an obvious stock title');
});

test('an exact named still goes straight to actual-image inspection without buying metadata ranking',async t=>{
  const {result,inspections,rankedPools}=await runSelection(t,'accepted','image',false,false,false,false,false,true);
  assert.equal(result.selected,1);
  assert.deepEqual(inspections,['stock']);
  assert.equal(rankedPools.length,0);
});

test('a visually rejected early candidate falls back to wider sources without accepting metadata as proof', async t => {
  const { result, inspections, searches } = await runSelection(t, 'rejected');
  assert.equal(result.selected, 1);
  assert.deepEqual(inspections, ['stock', 'archive']);
  assert.ok(searches.some(providers => providers.includes('commons')),JSON.stringify(searches));
  assert.equal(result.project.scenes[0]!.documentary!.selected!.id, 'archive');
});

test('an uncertain early inspection is not resubmitted in the broad fallback', async t => {
  const { result, inspections } = await runSelection(t, 'pending');
  assert.equal(result.selected, 1);
  assert.deepEqual(inspections, ['stock', 'archive']);
});

test('early stock and broad fallback share the original image inspection limit', async t => {
  const { result, inspections } = await runSelection(t, 'all-rejected');
  assert.equal(result.selected, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(inspections, ['stock', 'archive']);
});

test('ambiguous stock metadata waits for the full pool before requesting a ranking', async t => {
  const { result, rankedPools } = await runSelection(t, 'ambiguous');
  assert.equal(result.selected, 1);
  assert.ok(rankedPools.some(pool => pool.includes('stock') && pool.includes('archive')));
});

test('named scenes skip the stock-only wait but still rank the full pool and inspect actual media', async t => {
  const {searches, rankedPools, inspections} = await runSelection(t, 'all-rejected', 'image', true);
  assert.ok(searches.length > 0);
  assert.ok(searches[0]!.includes('commons'), `Named scene must start full discovery, got ${JSON.stringify(searches[0])}`);
  assert.ok(rankedPools.some(pool => pool.includes('stock') && pool.includes('archive')));
  assert.ok(inspections.length > 0);
});
