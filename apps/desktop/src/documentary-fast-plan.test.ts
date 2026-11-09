import test from 'node:test';
import assert from 'node:assert/strict';
import type {DocumentaryCandidate,Project,Scene} from '@gold-work/shared';
import {preferUnusedDocumentaryCandidates} from './documentary-candidate-allocation.js';
import {planFastDocumentaryScene,fastDocumentaryCandidateMetadataIssue,fastDocumentaryTargetCovered,fastDocumentaryProviders,fastDocumentaryIllustrationVerdict,fastDocumentaryCandidateScore,fastDocumentaryEvidenceIssue} from './documentary-fast-plan.js';

test('unknown topics preserve the object, action and setting beyond four words',()=>{
  const scenes=[
    'Ocean waves break against rocks beside the coast.',
    'A surfer rides a wave toward the shore.',
    'Photograph: A lighthouse stands on a rocky coastal headland.',
    'Photograph: Fishing boats rest inside a small coastal harbour.',
  ].map((narration,id)=>({id:String(id),narration} as Scene));
  const plans=scenes.map(scene=>planFastDocumentaryScene({scenes} as Project,scene));
  assert.deepEqual(plans.map(plan=>plan.visualTarget),[
    'Ocean waves break rocks coast','surfer rides wave shore',
    'lighthouse stands rocky coastal headland','Fishing boats rest small coastal harbour',
  ]);
  assert.deepEqual(plans.map(plan=>plan.preferredKind),['video','video','image','image']);
});

test('dated ship narration retains vessel names instead of calendar words or day numbers',()=>{
 const scenes=[
  'In April 1912, RMS Titanic represented a new scale of Atlantic travel.',
  'On 10 April 1912, RMS Titanic left Southampton on her maiden voyage.',
  'The ship struck an iceberg on 14 April 1912.',
  'On 27 January 2024, Icon of the Seas began her inaugural passenger voyage from Miami.',
  'SS United States was an ocean liner.',
  'In May 1952, SS United States crossed the Atlantic.',
  'Her four funnels promised a connection between Europe and America.',
 ].map((narration,id)=>({id:String(id),order:id,narration} as Scene));
 const project={scenes} as Project,plans=scenes.map(scene=>planFastDocumentaryScene(project,scene));
 assert.equal(plans[0]!.namedSubject,'RMS Titanic');assert.equal(plans[1]!.namedSubject,'RMS Titanic');
 assert.deepEqual(plans[1]!.requiredYears,['1912']);
 assert.equal(plans[3]!.namedSubject,'Icon of the Seas');assert.deepEqual(plans[3]!.requiredYears,['2024']);
 assert.equal(plans[5]!.namedSubject,'SS United States');assert.deepEqual(plans[5]!.requiredYears,['1952']);
 assert.equal(plans[6]!.namedSubject,undefined,'Two continents are not a vessel name');
 for(const plan of plans)assert.ok(!plan.namedSubject||!/^(?:April|January|May|On \d+)$/.test(plan.namedSubject));
});

test('passenger-ship discovery and saved pixel descriptions reject cargo and commemorative substitutes',()=>{
 const scenes=[
  'A modern cruise liner is the destination itself.',
  'The passenger ship has broad open decks.',
  'A floating city connects with the shore through gangways and terminal buildings.',
 ].map((narration,id)=>({id:String(id),order:id,narration} as Scene));
 const project={scenes} as Project,plans=scenes.map(scene=>planFastDocumentaryScene(project,scene));
 assert.equal(plans[0]!.visualTarget,'cruise ship');assert.equal(plans[1]!.visualTarget,'passenger ship');
 assert.equal(plans[2]!.visualTarget,'passenger ship');
 assert.ok(plans[1]!.queries.includes('cruise ship'));
 assert.ok(fastDocumentaryProviders(plans[1]!,'video').includes('local'),'Saved local sources must be available before another transfer');
 const oldFallback={...scenes[1]!,documentary:{requirement:{text:scenes[1]!.narration,footageFallback:{version:1,target:'ship',queries:['ship'],reason:'No exact source',originalTarget:'liner'}}}} as Scene;
 assert.equal(planFastDocumentaryScene({...project,scenes:[scenes[0]!,oldFallback]},oldFallback).visualTarget,'passenger ship');
 assert.ok(fastDocumentaryCandidateMetadataIssue(plans[0]!,{title:'Container cargo ship at sea',description:''}));
 assert.ok(fastDocumentaryCandidateMetadataIssue(plans[0]!,{title:'RMS liner memorial plaque',description:''}));
 assert.equal(fastDocumentaryCandidateMetadataIssue(plans[0]!,{title:'Cruise ship sailing',description:''}),undefined);
 const verdict={target:'passenger ship',relevant:true,evidence:'A ship is visibly sailing on the sea.'};
 assert.equal(fastDocumentaryIllustrationVerdict({...verdict,description:'A large cargo ship loaded with containers.'},verdict.target).status,'uncertain');
 assert.equal(fastDocumentaryIllustrationVerdict({...verdict,description:'A cruise ship with passenger balconies.'},verdict.target).status,'accepted');
 const cargo={id:'cargo',narration:'A cargo ship transports containers.'} as Scene;
 assert.equal(planFastDocumentaryScene({scenes:[cargo]} as Project,cargo).visualTarget,'cargo ship');
});

test('sailing discovery orders explicit motor-vessel substitutes behind plausible sailing footage',()=>{
 const visualTarget='sailing ship under sail at sea with crew on deck, illustrating continued forward motion despite loss of steering';
 const plan={visualTarget,queries:[],preferredKind:'video' as const,sourcePolicy:'background' as const};
 const scene={id:'s',order:0,narration:visualTarget,durationSeconds:5} as Scene;
 const project={scenes:[scene],aspectRatio:'16:9'} as Project;
 const candidate=(id:string,title:string)=>({id,title,description:title,kind:'video',provider:'local',durationSeconds:10,width:1920,height:1080} as DocumentaryCandidate);
 // These two captions were both present in full06 scene 31; the first was
 // prepared and then rejected as a modern cruise officer without sails.
 const cruise=candidate('cruise','cruise ship officer on deck speaking');
 const sailing=candidate('sailing','sailing adventure with crew preparing ropes');
 assert.deepEqual(preferUnusedDocumentaryCandidates(project,scene,[cruise,sailing],true,
  item=>fastDocumentaryCandidateScore(plan,item)).map(item=>item.id),['sailing','cruise']);
 for(const title of ['container ship on deck at sea','motor vessel sailing at sea'])
  assert.ok(fastDocumentaryCandidateScore(plan,candidate('motor',title))<fastDocumentaryCandidateScore(plan,sailing));
 for(const title of ['tall ship crew handling ropes','clipper under full sail','cargo ship sailing with crew','sailing ship beside a cruise ship'])
  assert.ok(fastDocumentaryCandidateScore(plan,candidate('possible',title))>=0,title);
 assert.ok(fastDocumentaryCandidateScore({...plan,visualTarget:'steamship alongside sailing ship'},candidate('mixed','steamship at a dock'))>=0);
});

test('failed Rossi scenes distinguish portraits and results from required models, parts and actions',()=>{
  const narration=[
    'In November 2003, Valentino Rossi walked away from his Honda motorcycle.',
    "His destination was Yamaha, a team that hadn't won a single race all year.",
    'Rossi had just claimed his third consecutive premier-class championship.',
    "Yamaha's YZR-M1 had managed just one podium in 2003.",
    'Fortunately, Yamaha had already brought in Masao Furusawa to lead that work.',
    'Rossi\'s main opponent was Max Biaggi, his old rival from Faster.',
    'Biaggi was now riding a Honda RC211V.',
    'With six laps remaining, Biaggi passed Rossi.',
    'At Phillip Island in 2003, he received a ten-second penalty for overtaking under yellow flags.',
    'But late on the penultimate lap, Rossi attacked under braking and retook the lead.',
    'Afterwards, he stopped beside the track, sat next to the M1 and kissed its front fairing.',
    'The engine could feel less aggressive while allowing the rider to go faster.',
    'The gamble had worked in the very first race. It was not a one-off.',
    'The lesson reached beyond the racetrack: the best machine gives a great rider control.',
    'In 2009, Yamaha brought crossplane technology from the M1 to the road-going R1.',
    'Inside a racing engine, pistons and connecting rods constantly accelerate, stop and reverse direction.',
    'Their movement creates forces that affect the crankshaft alongside the torque produced by combustion.',
    "His team identified a crucial problem: what the rider requested through the throttle didn't",
    'translate cleanly into drive at the rear wheel.',
    'At the limit of tyre grip, that extra push and pull can make the motorcycle harder to read.',
    'Its engine had unpredictable torque delivery.',
    'The design reduced the interference from those inertial forces and produced a more controllable',
    "Honda still had more power, but he liked the new engine's delivery.",
    'Of the configurations Yamaha offered, he chose the four-valve version with the uneven firing order.',
    'The team spent the winter improving traction, handling and drivability.',
    'He held on to win by just 0.210 seconds. Yamaha had won its first race since 2002.',
  ];
  const scenes=narration.map((text,index)=>({id:String(index),narration:text} as Scene));
  const project={scenes} as Project;
  const plans=scenes.map(scene=>planFastDocumentaryScene(project,scene));
  for(const index of [1,2,3,4,5,6]){
    assert.equal(plans[index]!.preferredKind,'image',narration[index]);
    assert.doesNotMatch(plans[index]!.visualTarget,/\brace\b/);
  }
  assert.equal(plans[4]!.visualTarget,'Masao Furusawa');
  assert.equal(plans[5]!.visualTarget,'Max Biaggi');
  assert.equal(plans[2]!.visualTarget,'Valentino Rossi');
  assert.equal(plans[3]!.visualTarget,'Yamaha YZR-M1 motorcycle');
  assert.equal(plans[6]!.visualTarget,'Honda RC211V motorcycle');
  assert.equal(plans[7]!.visualTarget,'Max Biaggi motorcycle overtaking race');
  assert.match(plans[8]!.visualTarget,/motorcycle overtaking race/);
  assert.doesNotMatch(plans[8]!.visualTarget,/Phillip Island/);
  assert.match(plans[9]!.visualTarget,/Valentino Rossi motorcycle overtaking/);
  assert.match(plans[10]!.visualTarget,/Yamaha YZR-M1.*front fairing kissing/);
  assert.equal(plans[11]!.visualTarget,'Yamaha YZR-M1 motorcycle');
  assert.equal(plans[11]!.preferredKind,'image');
  for(const index of [12,13]){
    assert.equal(plans[index]!.visualTarget,'motorcycle');
    assert.equal(plans[index]!.sourcePolicy,'background');
  }
  assert.equal(plans[14]!.visualTarget,'Yamaha R1 motorcycle');
  assert.equal(plans[14]!.preferredKind,'image');
  assert.equal(plans[15]!.visualTarget,'motorcycle pistons connecting rods');
  assert.equal(plans[16]!.visualTarget,'motorcycle crankshaft');
  assert.equal(plans[16]!.sourcePolicy,'specific');
  assert.equal(plans[17]!.visualTarget,'motorcycle throttle');
  assert.equal(plans[18]!.visualTarget,'motorcycle rear wheel');
  assert.equal(plans[19]!.visualTarget,'motorcycle tyre');
  for(const index of [20,22]){
    assert.match(plans[index]!.visualTarget,/Yamaha.*motorcycle$/);
    assert.doesNotMatch(plans[index]!.queries.join(' '),/engine|crankshaft/);
  }
  assert.equal(plans[21]!.visualTarget,'motorcycle engine');
  assert.match(plans[23]!.visualTarget,/engine valves/);
  assert.equal(plans[24]!.visualTarget,'motorcycle mechanics workshop');
  assert.equal(plans[24]!.sourcePolicy,'background');
  assert.ok(plans[7]!.queries.includes('Max Biaggi motorcycle'));
  for(const index of [1,25])assert.equal(plans[index]!.visualTarget,'Yamaha MotoGP motorcycle');
  assert.equal(fastDocumentaryCandidateMetadataIssue(plans[4]!,{title:'Masao Furusawa portrait',description:'Person in a room'}),undefined);
  assert.ok(fastDocumentaryCandidateMetadataIssue(plans[11]!,{title:'Jet engine turbine',description:'Aircraft engine'}));
  assert.equal(fastDocumentaryTargetCovered('Valentino Rossi motorcycle race','Valentino Rossi'),true);
  assert.equal(fastDocumentaryTargetCovered(' Yamaha YZR-M1 Motorcycle Crankshaft ','motorcycle crankshaft'),true);
  assert.equal(fastDocumentaryTargetCovered('Honda RC211V motorcycle','Yamaha YZR-M1 motorcycle'),false);
  assert.equal(fastDocumentaryTargetCovered('motorcycle crankshaft','motorcycle throttle'),false);
  assert.equal(fastDocumentaryTargetCovered('motorcycle crankshaft',''),false);
});

test('discovery retains concrete railway subjects and actions without leaking the prior topic',()=>{
  const scenes=[
    'A steam locomotive pulls a train along the railway.',
    'Railway workers repair the track before the next train arrives.',
    'Passengers wait on the railway station platform.',
    'The water flows through the dam and drives a turbine.',
    'После долгих лет работы инженеры наконец построили плотину через реку.',
  ].map((narration,id)=>({id:String(id),narration} as Scene));
  const plans=scenes.map(scene=>planFastDocumentaryScene({scenes} as Project,scene));
  assert.deepEqual(plans.map(p=>p.visualTarget),['steam locomotive pulling train','railway track repair','railway station platform passengers waiting','dam','dam']);
});

test('generic physical parts can use stock while named models stay in public archives',()=>{
  const scenes=[
    'Yamaha YZR-M1 was a motorcycle developed for MotoGP.',
    'The firing pattern changes how combustion pulses reach the rear wheel.',
    'At the limit of tyre grip the motorcycle is harder to control.',
  ].map((narration,id)=>({id:String(id),narration} as Scene));
  const plans=scenes.map(scene=>planFastDocumentaryScene({scenes} as Project,scene));
  assert.equal(plans[1]!.visualTarget,'motorcycle rear wheel');
  assert.equal(plans[1]!.sourcePolicy,'specific');
  assert.ok(fastDocumentaryProviders(plans[1]!,'image').includes('pexels'));
  assert.ok(!fastDocumentaryProviders(plans[0]!,'image').includes('pexels'));
  assert.ok(!fastDocumentaryProviders({...plans[0]!,aiPlanned:true},'image').includes('pexels'),'AI-authored named identity still needs an archive, not generic stock portraits');
  assert.ok(!fastDocumentaryProviders(plans[0]!,'image').includes('youtube'));
  assert.ok(plans[2]!.queries.includes('motorcycle tire wheel'));
});

test('paid platform false positive is rejected locally without another model call',()=>{
  const target='railway station platform';
  const answer={description:'An underground metro or railway station platform with escalators and a blue rock cave ceiling.',target,relevant:true,
    evidence:'the image shows a Stockholm underground railway/metro station platform area with escalators.'};
  assert.equal(fastDocumentaryIllustrationVerdict(answer,target).status,'uncertain');
  assert.equal(fastDocumentaryIllustrationVerdict({...answer,evidence:'A platform boarding edge is visible beside railway tracks.'},target).status,'accepted');
});

test('finish-line review requires a visible crossing rather than only a checkered flag',()=>{
 const target='motorcycle crossing finish line';
 const evidence='A motorcycle is visible riding on a racetrack track, carrying a rider holding a checkered flag.';
 const raw={description:'A rider celebrates with a checkered flag on a motorcycle.',target,relevant:true,evidence};
 assert.equal(fastDocumentaryIllustrationVerdict(raw,target).status,'uncertain');
 assert.ok(fastDocumentaryEvidenceIssue(target,evidence),'Saved and fresh reviews share the same evidence check');
 for(const allowed of ['motorcycle racing','motorcycle victory celebration','spectators at finish line','finish line celebration']){
  assert.equal(fastDocumentaryIllustrationVerdict({...raw,target:allowed},allowed).status,'accepted');
 }
 assert.equal(fastDocumentaryIllustrationVerdict({...raw,evidence:'The motorcycle crosses the visible painted finish line between the first and last frame.'},target).status,'accepted');
 assert.equal(fastDocumentaryIllustrationVerdict({...raw,evidence:'The motorcycle is riding near a finish line, without crossing it.'},target).status,'uncertain');
});

test('motorcycle pit crew requires visible motorcycle context instead of a generic tire cart',()=>{
 const target='MotoGP motorcycle pit crew mechanics engineering';
 const evidence='A pit crew member is visible pulling a tire cart in the pit lane next to the racing track across all frames.';
 const raw={description:'A pit crew member wearing a headset and team apparel pulls a cart stacked with racing tires along a pit lane next to a race track.',target,relevant:true,evidence};
 assert.equal(fastDocumentaryIllustrationVerdict(raw,target).status,'uncertain');
 assert.ok(fastDocumentaryEvidenceIssue(target,evidence));
 assert.equal(fastDocumentaryIllustrationVerdict({...raw,evidence:'A mechanic holds a tool against a visibly present motorcycle engine in the garage.'},target).status,'accepted');
 const generic='mechanics working in workshop';
 assert.equal(fastDocumentaryIllustrationVerdict({...raw,target:generic},generic).status,'accepted','A genuinely generic work target does not require a motorcycle');
});

test('single review retains explicit train action, river and waiting passengers',()=>{
  for(const [target,evidence,good] of [
    ['steam locomotive pulling train','A large steam locomotive is clearly visible in the image.','A steam locomotive is pulling attached carriages.'],
    ['train bridge over river','A steam train is clearly visible traveling across a metal bridge structure.','A train crosses a bridge above visible river water.'],
    ['railway station platform passengers waiting','A platform edge is visible beside railway tracks.','Passengers stand waiting on a platform beside railway tracks.'],
  ]){
    const answer={description:'Visible content',target,relevant:true,evidence};
    assert.equal(fastDocumentaryIllustrationVerdict(answer,target!).status,'uncertain');
    assert.equal(fastDocumentaryIllustrationVerdict({...answer,evidence:good},target!).status,'accepted');
  }
});

test('discovery rejects a plainly abandoned engine and prefers specific metadata without paid ranking',()=>{
  const scene={id:'s',narration:'A steam locomotive pulls a train along the railway.'} as Scene;
  const plan=planFastDocumentaryScene({scenes:[scene]} as Project,scene);
  assert.ok(fastDocumentaryCandidateMetadataIssue(plan,{title:'train railway old abandoned outdated steam locomotive',description:''}));
  const generic={title:'train railway',description:''},specific={title:'steam locomotive pulling train',description:''};
  assert.ok(fastDocumentaryCandidateScore(plan,specific)>fastDocumentaryCandidateScore(plan,generic));
  assert.equal(fastDocumentaryCandidateScore(plan,{...generic,title:'train train train railway'}),fastDocumentaryCandidateScore(plan,generic));
  assert.ok(fastDocumentaryCandidateScore(plan,{title:'A classic steam locomotive traversing the countryside.',description:''})
    >fastDocumentaryCandidateScore(plan,{title:'Steam locomotive releasing smoke at an outdoor train station.',description:''}));
});
