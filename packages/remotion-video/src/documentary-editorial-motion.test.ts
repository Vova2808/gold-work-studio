import assert from 'node:assert/strict';
import test from 'node:test';
import {documentaryBoardLayout,documentaryCardStages,documentaryEditorialStages,documentarySubjectSize} from './documentary-editorial.js';
import {documentaryComparisonSplit} from './DocumentaryComparisonBoard.js';

test('all five card captions and rules reach a reading hold even in a very short scene',()=>{
  for(const frames of [3,8,15,30,60,150,900])for(const count of [1,2,3,4,5]){
    const hold=Math.ceil(frames*.4);
    for(let i=0;i<count;i++){
      assert.deepEqual(documentaryCardStages(hold,frames,i,count),{source:1,label:1,rule:1});
      assert.deepEqual(documentaryCardStages(frames-1,frames,i,count),{source:1,label:1,rule:1});
    }
    if(count>1){
      const beat=documentaryEditorialStages(0,frames).revealFrames*.25;
      assert.ok(documentaryCardStages(beat,frames,0,count).source>0);
      assert.equal(documentaryCardStages(beat,frames,count-1,count).source,0);
    }
  }
});

test('motion disabled and one-frame inserts show complete content from their first frame',()=>{
  for(const frames of [1,2,15,150])for(const frame of [0,frames-1]){
    assert.deepEqual(documentaryCardStages(frame,frames,4,5,false),{source:1,label:1,rule:1});
    const stages=documentaryEditorialStages(frame,frames,false);
    assert.equal(stages.main,1);assert.equal(stages.detail,1);assert.equal(stages.settle,1);
    if(frames<=2)assert.deepEqual(documentaryCardStages(frame,frames,4,5),{source:1,label:1,rule:1});
  }
});

test('source overview fits the reserved column without stretching portraits or panoramas',()=>{
  for(const source of [1/4,9/16,4/3,16/9,5])for(const canvas of [9/16,1,16/9])for(const centered of [false,true]){
    const {width,height}=documentarySubjectSize(source,canvas,centered);
    assert.ok(height<=.900001&&width<=(centered ? .92 : .50));
    assert.ok(Math.abs(width/height*canvas-source)<1e-8);
  }
  for(const invalid of [0,-1,NaN,Infinity]){
    const size=documentarySubjectSize(invalid,invalid);
    assert.ok(Number.isFinite(size.width)&&Number.isFinite(size.height));
  }
});

test('a landscape subject gains useful area and a saved cutout gets its own tall stage',()=>{
  const photo=documentarySubjectSize(16/9,16/9);
  assert.ok(photo.width*photo.height>=.25);
  const cutout=documentarySubjectSize(16/9,16/9,false,true);
  assert.ok(cutout.height>=.85&&cutout.width<=.5);
  for(const centered of [false,true]){
    const size=documentarySubjectSize(9/16,9/16,centered,true);
    assert.ok(size.width>0&&size.width<=1&&size.height<=1);
  }
});

test('two-panel comparison uses the complete frame with a shared seam in both orientations',()=>{
  for(const [width,height] of [[1920,1080],[1080,1920]]){
    const panels=documentaryComparisonSplit(width!,height!);
    assert.equal(panels.reduce((area,r)=>area+r.w*r.h,0),width!*height!);
    for(const r of panels)assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=width!&&r.y+r.h<=height!);
    if(width!>height!)assert.equal(panels[0]!.x+panels[0]!.w,panels[1]!.x);
    else assert.equal(panels[0]!.y+panels[0]!.h,panels[1]!.y);
    const staticStart=documentaryComparisonSplit(width!,height!,documentaryEditorialStages(0,150,false).main);
    assert.deepEqual(staticStart,panels);
    const opening=documentaryComparisonSplit(width!,height!,.5);
    assert.notEqual(opening[0]!.clipPath,opening[1]!.clipPath);
  }
});

test('comparison slots reserve captions and remain inside portrait, square and landscape frames',()=>{
  for(const [width,height] of [[1080,1920],[1080,1080],[1920,1080]])for(const count of [1,2,3,4,5]){
    const {columns,rows,slotW,slotH,top}=documentaryBoardLayout(count,width!,height!);
    assert.ok(columns*rows>=count);
    assert.ok(width!*.06+slotW*columns<=width!*.95);
    assert.ok(top+slotH*rows<=height!*.91);
    if(width!<height!&&count===2){assert.equal(columns,1);assert.equal(rows,2);}
  }
});
