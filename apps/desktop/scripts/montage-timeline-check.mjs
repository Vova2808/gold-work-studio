import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export async function checkMontageTimeline(win,title,out){
  const evaluate=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`,true);
  const pause=()=>new Promise(r=>setTimeout(r,200));
  const until=async expression=>{for(let i=0;i<100;i++){if(await evaluate(`return Boolean(${expression});`))return;await pause();}throw Error('Timeline UI timeout: '+expression);};
  await until('document.querySelector("[data-nav-key=projects]")');
  await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Открыть приложение')?.click();`);
  await evaluate('document.querySelector("[data-nav-key=projects]").click();');
  const row=`[...document.querySelectorAll('.projects-table-row')].find(e=>e.textContent.includes(${JSON.stringify(title)}))`;
  await until(row);await evaluate(`${row}.click();`);
  await until(`document.querySelector('.project-expand')`);
  await evaluate(`const b=[...document.querySelectorAll('.project-expand button')].find(e=>e.textContent.trim()==='Таймлайн');if(!b)throw Error('Timeline action absent');b.click();`);
  await until(`document.querySelector('.timeline-scroll')`);
  await pause();
  const report=await evaluate(`
    const scroll=document.querySelector('.timeline-scroll'),range=document.querySelector('.timeline-zoom input');
    const start=performance.now(),frames=[],longTasks=[];
    const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:false});
    let previous=performance.now();
    for(let i=0;i<40;i++){
      const rect=scroll.getBoundingClientRect();
      scroll.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:i<20?100:-100,clientX:rect.left+350,clientY:rect.top+50}));
      await new Promise(requestAnimationFrame);const now=performance.now();frames.push(now-previous);previous=now;
    }
    await new Promise(r=>setTimeout(r,1000));observer.disconnect();
    const imgs=[...document.querySelectorAll('.documentary-visual-track img')];
    return {elapsedMs:performance.now()-start,frames,longTasks,zoom:range?.value,tiles:imgs.length,thumbnailUrls:imgs.filter(i=>i.src.includes('thumbnail=240')).length,decodedSizes:imgs.filter(i=>i.complete&&i.naturalWidth).map(i=>[i.naturalWidth,i.naturalHeight])};
  `);
  assert.ok(report.tiles>0&&report.thumbnailUrls===report.tiles,'Timeline must use thumbnail requests');
  assert.ok(report.decodedSizes.every(([w,h])=>w<=240&&h<=136));
  await writeFile(join(out,'timeline-check-20260928.json'),JSON.stringify(report,null,2));
  await writeFile(join(out,'timeline-check-20260928.png'),(await win.webContents.capturePage()).toPNG());
  // Close the read-only editor without applying any changes.
  await evaluate(`document.querySelector('.modal-overlay .modal-close')?.click();`);
  console.log(JSON.stringify({stage:'timeline-ui-check',...report}));
}
