"""Local transcription only; no account, remote upload or paid submission."""
import json, time
from pathlib import Path
from faster_whisper import WhisperModel
root=Path(__file__).resolve().parents[1]/'captures'/'vidrush-reference-20260928'
model=WhisperModel('base',device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
for name in ['tutorial-1','tutorial-2','film']:
 dest=root/name
 while not (dest/'audio.wav').exists():time.sleep(2)
 if (dest/'transcript.json').exists():continue
 started=time.monotonic();segments,info=model.transcribe(str(dest/'audio.wav'),language='en',beam_size=5,vad_filter=True)
 rows=[]
 with (dest/'transcript.txt').open('w',encoding='utf-8') as output:
  for s in segments:
   rows.append({'start':s.start,'end':s.end,'text':s.text});output.write(f'[{int(s.start)//60:02}:{int(s.start)%60:02}] {s.text.strip()}\n');output.flush()
 (dest/'transcript.json').write_text(json.dumps({'model':'faster-whisper-base','local':True,'seconds':time.monotonic()-started,'segments':rows},ensure_ascii=False,indent=2),encoding='utf-8')
 print(name,'transcribed',len(rows),'segments',flush=True)
