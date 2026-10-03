"""Read-only reference contact sheets, metadata and local ASR inputs."""
import json, math, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]/'captures'/'vidrush-reference-20260928'
VIDEOS=[('tutorial-1',Path('C:/Users/rosup/Downloads/How To Create Faceless Full Length Documentary YouTube Videos With AI VidRush Tutorial [get-save.com].mp4')),
 ('tutorial-2',Path('C:/Users/rosup/Downloads/Vidrush AI Tutorial 2026 - How to Use Vidrush for Beginners [get-save.com].mp4')),
 ('film',Path('C:/Users/rosup/Downloads/The Real Reason Rossi Left Honda for a Losing Yamaha [get-save.com].mp4'))]
BG=Path('D:/пак/лучший пак для монтажа feat. filzanuty/фоны горизонтальные')
ROOT.mkdir(parents=True,exist_ok=True)
def run(args):return subprocess.run(args,check=True,capture_output=True).stdout
def probe(path):return json.loads(run(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(path)]))
def frame(path,at,target):
 if not target.exists():run(['ffmpeg','-v','error','-y','-ss',str(at),'-i',str(path),'-frames:v','1','-vf','scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2','-q:v','3',str(target)])
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',20)
def sheets(rows,dest):
 for offset in range(0,len(rows),24):
  part=rows[offset:offset+24];sheet=Image.new('RGB',(1440,math.ceil(len(part)/3)*304),'#172026');draw=ImageDraw.Draw(sheet)
  for i,(path,label) in enumerate(part):
   x=(i%3)*480;y=(i//3)*304;sheet.paste(Image.open(path),(x,y));draw.text((x+10,y+277),label,font=font,fill='white')
  sheet.save(dest/f'sheet-{offset//24+1}.jpg',quality=90)
meta=[]
for name,path in VIDEOS:
 dest=ROOT/name;dest.mkdir(exist_ok=True);info=probe(path);seconds=float(info['format']['duration']);video=next(s for s in info['streams'] if s['codec_type']=='video')
 meta.append({'name':name,'path':str(path),'seconds':seconds,'width':video['width'],'height':video['height']})
 rows=[];step=10 if name=='film' else 15
 for t in range(2,math.floor(seconds),step):
  target=dest/f'frame-{t:04}.jpg';frame(path,t,target);rows.append((target,f'{t//60:02}:{t%60:02}'))
 sheets(rows,dest)
 audio=dest/'audio.wav'
 if not audio.exists():run(['ffmpeg','-v','error','-y','-i',str(path),'-vn','-ac','1','-ar','16000',str(audio)])
 print(json.dumps(meta[-1]),flush=True)
dest=ROOT/'backgrounds';dest.mkdir(exist_ok=True);rows=[];backgrounds=[]
for path in sorted(BG.glob('*.mp4')):
 info=probe(path);video=next(s for s in info['streams'] if s['codec_type']=='video');seconds=float(info['format']['duration']);target=dest/(path.stem+'.jpg');frame(path,min(2,seconds/2),target)
 rows.append((target,f'{path.stem} | {video["width"]}x{video["height"]}'))
 backgrounds.append({'path':str(path),'width':video['width'],'height':video['height'],'duration':seconds})
sheets(rows,dest)
(ROOT/'metadata.json').write_text(json.dumps({'videos':meta,'backgrounds':backgrounds},ensure_ascii=False,indent=2),encoding='utf-8')
