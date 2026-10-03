import {app} from 'electron';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {AnyModelStore} from '../src/anymodel-store.js';
import {AnyModelClient} from '../src/anymodel-client.js';
import {DocumentaryIntelligence} from '../src/documentary-intelligence.js';
import {planDocumentaryMontage} from '../src/documentary-montage.js';
import type {Project} from '@gold-work/shared';
app.setPath('userData','C:/Users/rosup/AppData/Roaming/@gold-work/desktop');
void app.whenReady().then(async()=>{
  const root=resolve('captures/motion-plan-live-20260926');await mkdir(root,{recursive:true});
  const projects=JSON.parse(await readFile(join(app.getPath('userData'),'projects.json'),'utf8')) as Project[];
  const p=projects.find(p=>p.id==='project_mu9x2ywf_1s9thrt')!;p.id='motion-semantic-qa';
  const narration=[
    'Наш путь начинается в Денвере, городе у подножия Скалистых гор.',
    'В 1858 году золотоискатели пришли в эту долину. Так началась новая история.',
    'Скалистые горы. Здесь высокие вершины соседствуют с лесами и озёрами.',
    'Меса-Верде. Древние поселения построены прямо под скальными навесами.',
    'Грейт-Санд-Дьюнс. Огромные песчаные дюны поднимаются над долиной.',
    'Блэк-Каньон. Река прорезала глубокое ущелье с отвесными стенами.',
    'The journey continued from London to New York, across the Atlantic Ocean.',
    'A ship measuring 990 feet became the focus of the next chapter.'
  ];
  p.language='Russian';p.videoBrief={...p.videoBrief!,readyScript:narration.join(' ')};
  p.scenes=narration.map((text,order)=>({...p.scenes[0]!,id:`qa-${order}`,order,narration:text,durationSeconds:15,durationOverrideSeconds:15,documentary:{...p.scenes[0]!.documentary!,verified:true,pinned:false,template:undefined,motionGraphic:undefined,comparison:undefined,cuts:undefined,texts:undefined,layout:'full',caption:{...p.scenes[0]!.documentary!.caption,enabled:false},timing:undefined}}));
  const client=new AnyModelClient(new AnyModelStore(join(app.getPath('userData'),'credentials/anymodel.json')));
  const intelligence=new DocumentaryIntelligence(client,()=>root);
  const plans=await intelligence.plan(p,p.scenes);
  p.scenes=p.scenes.map(s=>({...s,documentary:{...s.documentary!,requirement:plans.get(s.id)!}}));
  p.scenes=planDocumentaryMontage(p);
  const result=p.scenes.map(s=>({order:s.order,narration:s.narration,graphic:s.documentary!.motionGraphic,template:s.documentary!.template}));
  await writeFile(join(root,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.map(r=>({scene:r.order+1,kind:r.graphic?.kind,place:r.graphic?.place?.name,value:r.graphic?.value,template:r.template}))));
}).then(()=>app.exit(0),e=>{console.error(e.message);app.exit(1);});
