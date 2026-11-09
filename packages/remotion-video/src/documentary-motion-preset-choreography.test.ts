import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createElement,isValidElement,type ReactNode} from 'react';
import {Img} from 'remotion';
import {documentaryMotionPresets,type DocumentaryMotionPresetId} from '@gold-work/shared';
import {DocumentaryMotionPreset,type DocumentaryMotionPresetProps} from './DocumentaryMotionPreset.js';
import {DocumentaryArgumentSequence} from './DocumentaryArgumentSequence.js';
import {motionPresetBoardRects,motionPresetChoreography,motionPresetHighlightRange,motionPresetItemProgress,motionPresetSourceRect,motionPresetTextGroups} from './documentary-motion-preset-choreography.js';

// react-dom is an existing peer. No new dependency or browser/render process.
const {renderToStaticMarkup}=createRequire(import.meta.url)('react-dom/server') as {renderToStaticMarkup:(node:ReactNode)=>string};
function props(id:DocumentaryMotionPresetId,extra:Partial<DocumentaryMotionPresetProps>={}):DocumentaryMotionPresetProps {
  const family=id.split('-')[0];
  const kind=family==='board'?'explainer':family==='profile'?'subject-card':family==='chapter'?'chapter-number':family==='date'?'chronology':family==='stat'?'statistic':'key-point';
  return {graphic:{kind,preset:id,title:'Literal title SENTENCE_END',value:'14 of 16',kicker:'Literal kicker',cards:Array.from({length:5},(_,i)=>({label:`Exact card ${i} CARD_END_${i}`,value:`VALUE_${i}`})),activeIndex:3,enabled:true,startSeconds:0,durationSeconds:5},
    frame:90,frames:150,width:1920,height:1080,mediaAspect:16/9,isVideo:false,motionEnabled:true,accent:'#f4c430',material:createElement('div',{'data-source-proof':'single'},'SOURCE_SENTINEL'),...extra};
}
const markup=(p:DocumentaryMotionPresetProps)=>renderToStaticMarkup(createElement(DocumentaryMotionPreset,p));

test('calendar pages use the actual month length and retain the literal date',()=>{
  for(const [value,days] of [['February 29, 2024',29],['February 2023',28],['May 1963',31]] as const){
    const p=props('date-calendar');p.graphic={...p.graphic,title:'',value};
    const html=markup(p);
    assert.equal(html.match(/data-calendar-day=/gu)?.length,days);
    assert.ok(html.includes('data-date-action="calendar-page"'));
    assert.ok(html.includes(String(value.match(/\d{4}/u)?.[0])));
  }
});

test('every primary and secondary element settles early, including eight film perforations',()=>{
  for(const frames of [1,2,3,8,15,30,150,900]){
    const hold=Math.ceil((frames-1)*.5);
    const {ambient,...entrance}=motionPresetChoreography(hold,frames);
    assert.deepEqual(entrance,{source:1,primary:1,secondary:1,rule:1,drift:1,overlay:1});
    assert.ok(ambient>=0&&ambient<=1);
    for(const count of [1,3,5,8])for(let i=0;i<count;i++)assert.equal(motionPresetItemProgress(hold,frames,i,count),1);
    assert.deepEqual(motionPresetChoreography(0,frames,false),motionPresetChoreography(frames-1,frames,false));
  }
  const early=motionPresetChoreography(0,150);
  assert.equal(early.source,1);assert.equal(early.primary,0);assert.equal(early.rule,0);
});

test('quiet ambient motion continues after entrances settle, without moving the text',()=>{
  const first=motionPresetChoreography(90,240),last=motionPresetChoreography(239,240);
  assert.equal(first.primary,last.primary);assert.equal(first.rule,last.rule);assert.equal(first.drift,last.drift);
  assert.ok(first.ambient<last.ambient);assert.equal(last.ambient,1);
  assert.equal(motionPresetChoreography(239,240,false).ambient,0);
});

test('source remains a hero on the first frame and every phase, while videos keep native movement',()=>{
  for(const {id} of documentaryMotionPresets)for(const frame of [0,1,30,90,149]){
    const p=props(id,{frame,isVideo:true}),html=markup(p);
    const source=/<div class="gws-motion-preset-source"[^>]*>/u.exec(html)?.[0]??'';
    assert.ok(source.includes('opacity:1'),`${id}: source must never wait for typography`);
    assert.ok(!source.includes('transform:'),id);
    assert.ok(Number(/data-source-area="([\d.]+)"/u.exec(source)?.[1])>=.7,id);
  }
  for(const {id} of documentaryMotionPresets)for(const mediaAspect of [9/16,16/9,4])for(const canvasAspect of [9/16,16/9]){
    const r=motionPresetSourceRect(id,mediaAspect,canvasAspect);
    assert.ok(r.w>=.9&&r.h>=.75);
    if(mediaAspect/canvasAspect<.75||mediaAspect/canvasAspect>1.3)assert.deepEqual(r,{x:0,y:0,w:1,h:1});
  }
  const type=motionPresetChoreography(8,150,true,'type-slam'),chapter=motionPresetChoreography(8,150,true,'chapter-signal');
  assert.notEqual(type.primary,chapter.primary);
  assert.equal(motionPresetChoreography(149,150,true,'type-slam').overlay,0);
});

test('board layouts keep all five slots inside every aspect and whitespace grouping is lossless',()=>{
  for(const preset of ['board-cascade','board-staircase','board-orbit','board-ledger'])for(const portrait of [false,true])for(const hasSource of [false,true])for(const count of [0,1,2,3,4,5]){
    const slots=motionPresetBoardRects(preset,count,portrait,hasSource);
    assert.equal(slots.length,count);
    for(const r of slots)assert.ok(r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=1&&r.y+r.h<=1,JSON.stringify(r));
  }
  for(const copy of ['  Original  words.\nExact ending!  ','日本語の言葉 طويلة كلمة','one','  ',''])assert.equal(motionPresetTextGroups(copy).join(''),copy);
});

test('board semantics produce two comparison poles, a compact group or a linked sequence',()=>{
  const compare=motionPresetBoardRects('board-cascade',2,false,true,'compare');
  assert.equal(compare.length,2);assert.ok(compare[0]!.x+compare[0]!.w<.5);assert.ok(compare[1]!.x>.5);
  const steps=motionPresetBoardRects('board-cascade',5,false,true,'steps');
  assert.ok(steps.every(r=>r.y===steps[0]!.y));
  const parts=motionPresetBoardRects('board-cascade',5,false,true,'parts');
  assert.ok(parts.every(r=>r.x===parts[0]!.x));assert.ok(parts.at(-1)!.y>parts[0]!.y);
  for(const boardLayout of ['compare','parts','steps'] as const){
    const p=props('board-cascade');p.graphic.boardLayout=boardLayout;
    const html=markup(p);assert.ok(html.includes(`data-board-layout="${boardLayout}"`));
    for(let i=0;i<5;i++){assert.ok(html.includes(`CARD_END_${i}`));assert.ok(html.includes(`VALUE_${i}`));}
  }
});

test('chapter actions preserve one full source and editorial/aperture introductions return to it',()=>{
  for(const preset of ['chapter-signal','chapter-marquee','chapter-dossier','chapter-aperture'] as const){
    const first=markup(props(preset,{frame:0})),hold=markup(props(preset,{frame:90})),last=markup(props(preset,{frame:149}));
    assert.ok(first.includes('SOURCE_SENTINEL'));assert.ok(hold.includes('SOURCE_SENTINEL'));assert.ok(last.includes('SOURCE_SENTINEL'));
    if(preset==='chapter-dossier'){
      const matte=/<div[^>]*data-chapter-matte="editorial"[^>]*>/u.exec(hold)?.[0]??'';
      assert.ok(Number(/opacity:([\d.]+)/u.exec(matte)?.[1])<.1,'the fixed editorial card softly releases the source');
    }
    if(preset==='chapter-aperture'){assert.ok(hold.includes('transform:translateY(-100%)'));assert.ok(hold.includes('transform:translateY(100%)'));}
    assert.ok(hold.includes('Literal title SENTENCE_END'));
    // Wrapper camera/fit stays exactly the same: masks change, the source never shrinks.
    const tag=(html:string)=>/<div class="gws-motion-preset-source"[^>]*>/u.exec(html)?.[0];
    assert.equal(tag(first),tag(hold));assert.equal(tag(first),tag(last));
    assert.ok(last.includes('opacity:0'));
  }
});

test('type chapter and date typography never changes its fitted box or requested size during motion',()=>{
  const geometry=(p:DocumentaryMotionPresetProps)=>{
    const boxes:unknown[]=[];
    const visit=(node:ReactNode):void=>{
      if(Array.isArray(node)){node.forEach(visit);return;}
      if(!isValidElement<{children?:ReactNode;text?:string;r?:unknown;size?:number;width?:number;height?:number;fontFamily?:string;weight?:number}>(node))return;
      if(node.props.text!==undefined&&node.props.r)boxes.push([node.props.text,node.props.r,node.props.size,node.props.width,node.props.height,node.props.fontFamily,node.props.weight]);
      visit(node.props.children);
    };
    visit(DocumentaryMotionPreset(p));return boxes;
  };
  for(const {id} of documentaryMotionPresets.filter(p=>/^(type|chapter|date)-/u.test(p.id))){
    for(const [width,height] of [[1920,1080],[1080,1920]]){
      const p=props(id,{width:width!,height:height!}),first=geometry({...p,frame:0});
      for(const frame of [8,17,48,90,149])assert.deepEqual(geometry({...p,frame}),first,`${id} frame ${frame}`);
    }
  }
});

test('argument zones and mass-production typography stay fixed through setup counterpoint and summary',()=>{
  const groups:[{title:string;items:string[];summary:string},{title:string;items:string[];summary:string}]=[
    {title:'Ford',items:['Money','Factories','mass production'],summary:'Industrial power'},
    {title:'Ferrari',items:['Experience','Craftsmanship','Racing tradition'],summary:'Racing heritage'},
  ];
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    let reference:string|undefined;
    for(const stage of [0,1,2] as const)for(const frame of [0,8,15,30,75,120]){
      const node=createElement(DocumentaryArgumentSequence,{argument:{stage,groups,itemFrames:stage===2?[0,45]:[12,35,55]},frame,frames:150,width:width!,height:height!,accent:'#f4c430',material:'SOURCE_SENTINEL'});
      const html=renderToStaticMarkup(node),zones=[...html.matchAll(/data-argument-zone="([^"]+)"/gu)].map(m=>m[1]!.split(',').map(Number));
      assert.equal(html.match(/SOURCE_SENTINEL/gu)?.length,1);
      for(const [x,y,w,h] of zones)assert.ok(x!>=0&&y!>=.69&&x!+w!<=1&&y!+h!<=1);
      if(zones.length===2){const [a,b]=zones;assert.ok(a![0]!+a![2]!<=b![0]!||a![1]!+a![3]!<=b![1]!);}
      const copy=/<div data-argument-item="0-2" style="([^"]+)"><div style="([^"]+)">mass production<\/div>/u.exec(html);
      assert.ok(copy);const typography=copy[1]!.replace(/opacity:[^;]+;?|transform:[^;]+;?/gu,'')+copy[2]!;
      reference??=typography;assert.equal(typography,reference,`stage ${stage} frame ${frame}`);
      if(stage===2){
        const lists=[...html.matchAll(/data-argument-list="\d"[^>]*translateY\(([-\d.]+)%\)/gu)].map(m=>Number(m[1]));
        const summaries=[...html.matchAll(/data-argument-summary="\d"[^>]*translateY\(([-\d.]+)%\)/gu)].map(m=>Number(m[1]));
        assert.equal(lists.length,2);lists.forEach((y,i)=>assert.ok(Math.abs(summaries[i]!-y-100)<1e-8));
        if(frame<45)assert.equal(summaries[1],100,'prior list stays until its summary speech cue');
      }
    }
  }
});

test('all 24 presets have distinct structures and use only one source surface',()=>{
  assert.equal(documentaryMotionPresets.length,24);
  const structures=new Set<string>();
  for(const {id} of documentaryMotionPresets){
    const html=markup(props(id));
    assert.equal(html.match(/SOURCE_SENTINEL/gu)?.length,1,id);
    structures.add(html.replace(/data-motion-preset="[^"]+"/u,''));
    const hidden=markup(props(id,{graphic:{...props(id).graphic,showSource:false,hideTitle:true}}));
    assert.ok(!hidden.includes('SOURCE_SENTINEL'),id);
    assert.ok(!hidden.includes('SENTENCE_END'),id);
    if(id.startsWith('stat-')||id.startsWith('date-'))assert.ok(hidden.includes('14 of 16'),id);
  }
  assert.equal(structures.size,24);
});

test('motion off fixes every composition at its readable state in landscape and portrait',()=>{
  for(const {id} of documentaryMotionPresets)for(const [width,height] of [[1920,1080],[1080,1920]])for(const theme of ['dark','paper'] as const){
    const p=props(id,{width:width!,height:height!,motionEnabled:false,customBackground:true,frame:0});
    p.graphic={...p.graphic,theme};
    assert.equal(markup(p),markup({...p,frame:149}),`${id} ${width} ${theme}`);
  }
});

test('text boards retain five long literal cards, their values and authored active index',()=>{
  for(const {id} of documentaryMotionPresets.filter(p=>p.family==='board'))for(const [width,height] of [[1920,1080],[1080,1920]]){
    const p=props(id,{width:width!,height:height!});
    p.graphic.cards=p.graphic.cards!.map(c=>({...c,label:'A lengthy literal sentence '.repeat(9)+c.label}));
    const html=markup(p);
    for(let i=0;i<5;i++){assert.ok(html.includes(`CARD_END_${i}`));assert.ok(html.includes(`VALUE_${i}`));}
    assert.equal(html.match(/data-active="true"/gu)?.length,1);
  }
});

test('profile uses the saved cutout instead of mounting a second source',()=>{
  const p=props('profile-halo');p.graphic.cutoutPath='C:/saved/cutout.png';
  let images=0,sources=0;
  const visit=(node:ReactNode):void=>{
    if(Array.isArray(node)){node.forEach(visit);return;}
    if(!isValidElement<{children?:ReactNode;src?:string;'data-source-proof'?:string}>(node))return;
    if(node.type===Img){images++;assert.ok(node.props.src?.includes('cutout.png'));}
    if(node.props['data-source-proof'])sources++;
    visit(node.props.children);
  };
  visit(DocumentaryMotionPreset(p));
  assert.equal(images,1);assert.equal(sources,0);
});

test('halo cutout entrance stays inset and settles; motion zero keeps exactly the held pose',()=>{
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const p=props('profile-halo',{width:width!,height:height!});p.graphic.cutoutPath='C:/saved/cutout.png';
    const stage=(frame:number,motionEnabled=true)=>{
      p.frame=frame;p.motionEnabled=motionEnabled;
      let style: {inset?:string;opacity?:number;transform?:string}|undefined;
      const visit=(node:ReactNode):void=>{
        if(Array.isArray(node)){node.forEach(visit);return;}
        if(!isValidElement<{children?:ReactNode;'data-profile-cutout'?:string;style:typeof style}>(node))return;
        if(node.props['data-profile-cutout'])style=node.props.style;
        visit(node.props.children);
      };
      visit(DocumentaryMotionPreset(p));
      assert.ok(style);
      return style;
    };
    const opening=stage(0),held=stage(90);
    assert.equal(opening.inset,'4% 2%');assert.equal(opening.opacity,0);
    assert.equal(held.opacity,1);assert.equal(held.transform,'translateY(0%) scale(1)');
    assert.deepEqual(stage(0,false),stage(149,false));
    assert.deepEqual(stage(0,false),held);
  }
});

test('untitled text comparison occupies two central columns and shades only their region',()=>{
  for(const portrait of [false,true]){
    const slots=motionPresetBoardRects('board-ledger',2,portrait,true,'compare',false);
    assert.equal(slots.length,2);
    for(const slot of slots){assert.ok(slot.y<=.25&&slot.h>=.6);assert.ok(slot.y+slot.h<=.9);}
    assert.ok(slots[0]!.x+slots[0]!.w<slots[1]!.x);
    const p=props('board-ledger',{width:portrait?1080:1920,height:portrait?1920:1080});
    p.graphic={...p.graphic,title:'',value:undefined,kicker:undefined,boardLayout:'compare',cards:[{label:'One thesis'},{label:'Another thesis'}]};
    const html=markup(p);
    assert.ok(html.includes('data-compare-scrim="local"'));
    assert.ok(html.includes('One thesis')&&html.includes('Another thesis'));
    assert.ok(html.includes('data-source-area="1"'));
    assert.ok(!html.includes('linear-gradient(to top'));
  }
});

test('all type presets retain the literal highlight, including a phrase crossing stack groups',()=>{
  const title='One two THREE four five six',highlight='two THREE four';
  for(const id of ['type-slam','type-ribbon','type-echo','type-stack'] as const){
    const p=props(id);p.graphic={...p.graphic,kind:'quote',quoteMode:'phrase',title,value:undefined,highlight};
    const html=markup(p),marks=[...html.matchAll(/<mark\b[^>]*>([^<]*)<\/mark>/gu)].map(match=>match[1]);
    assert.equal(marks.join(''),highlight,id);
    if(id==='type-stack')assert.equal(marks.length,2,id);
    assert.ok(html.includes('background:#f4c430'));
    p.graphic.highlight='not in the title';assert.ok(!markup(p).includes('<mark '));
  }
  const literal='A [literal]+ (SPAN) / конец';
  const span=motionPresetHighlightRange(literal,'[literal]+ (span)')!;
  assert.equal(literal.slice(span.start,span.end),'[literal]+ (SPAN)');
  assert.equal(motionPresetHighlightRange(literal,'absent'),undefined);
});

test('only a literal part-of-whole creates exact conditional marks, never dates or bare counts',()=>{
  for(const preset of ['stat-monument','stat-ticket','stat-window','stat-split'] as const){
    const p=props(preset);p.graphic.value='Only 3 of 8';
    const html=markup(p);
    assert.equal(html.match(/data-filled="true"/gu)?.length,3);
    assert.equal(html.match(/data-filled="false"/gu)?.length,5);
    assert.ok(html.includes('Only 3 of 8'));
    p.graphic.value='2003';assert.ok(!markup(p).includes('data-ratio='));
    p.graphic.value='990 cc';assert.ok(!markup(p).includes('data-ratio='));
  }
});
