#!/usr/bin/env python3
"""Render an explicitly labeled edit of verified mock decisions, never fake live footage.

Optional offline production dependencies live in .media-build/venv. No browser,
account credentials, paid API, or Huddle runtime writes are used by this script.
"""
from pathlib import Path
import argparse, hashlib, json, math, re, subprocess, textwrap
import numpy as np
import soundfile as sf
import mido
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/assets'
WORK=ROOT/'.media-build'
MEDIA=WORK/'draft-preview'
MEDIA.mkdir(exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe()
SR=48000
E=json.loads((OUT/'huddle-draft-replay-evidence.json').read_text())
PICKS=E['timings']
assert E['proof']['fullyManual'] and len(PICKS)==15 and all(p['accepted'] for p in PICKS)
SEGMENTS=[
(.6,6.4,'The clock is running. Every selection must earn its place.'),
(7,13.5,'In this Yahoo mock, Huddle reads the board and weighs the roster.'),
(14,21,'Amon-Ra Saint Brown. Then Devon Achane. Two recommendations. Two confirmed picks.'),
(21.7,29,'Value meets need. Receivers, running backs, tight ends, and the flex. Every spot counts.'),
(29.7,37,'Dak Prescott leads the quarterbacks. Trevor Lawrence provides cover when the bye week comes.'),
(37.7,44.5,'Fifteen selections. Zero autopicks. Every result checked against Yahoo.'),
(45.2,53,'Five receivers. Four running backs. Two quarterbacks. Two tight ends. A complete starting lineup.'),
(53.7,59.4,'A successful rehearsal. Real decisions, replayed. Huddle. Your league. Your call.')]

def ff(*args):
    subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*map(str,args)],check=True)

def stamp(t,sep=','):
    m=round(t*1000)
    return f'{m//3600000:02}:{m//60000%60:02}:{m//1000%60:02}{sep}{m%1000:03}'

def audio():
    from kokoro_onnx import Kokoro
    import onnxruntime as ort
    from tinysoundfont import Synth
    opt=ort.SessionOptions();opt.intra_op_num_threads=2;opt.inter_op_num_threads=1
    model=Kokoro.from_session(ort.InferenceSession(str(WORK/'kokoro-v1.0.onnx'),sess_options=opt,providers=['CPUExecutionProvider']),str(WORK/'voices-v1.0.bin'))
    voice=.7*model.get_voice_style('am_michael')+.3*model.get_voice_style('am_onyx')
    narration=np.zeros(60*SR,np.float32);records=[]
    for i,(start,deadline,text) in enumerate(SEGMENTS):
        raw=MEDIA/f'voice-{i}.wav'
        if not raw.exists():
            a,rate=model.create(text,voice=voice,speed=.88,lang='en-us')
            sf.write(raw,a,rate,subtype='PCM_24')
        a,rate=sf.read(raw);duration=len(a)/rate
        speed=max(1,duration/(deadline-start))
        if speed>1.45:raise ValueError(f'Rewrite speech {i}: {duration:.2f}s')
        fitted=MEDIA/f'voice-{i}-fit.wav'
        ff('-i',raw,'-af',f'asetrate={rate}*0.955,aresample={SR},atempo={speed/.955},highpass=f=70,lowpass=f=9500,equalizer=f=145:t=q:w=0.8:g=1.8,equalizer=f=3100:t=q:w=0.9:g=1.3','-ar',SR,'-ac',1,fitted)
        a,rate=sf.read(fitted,dtype='float32');end=start+len(a)/rate
        assert end<deadline+.1
        a*=min(.15/max(float(np.sqrt(np.mean(a*a))),1e-6),.9/max(float(np.max(np.abs(a))),1e-6))
        offset=round(start*SR);narration[offset:offset+len(a)]+=a
        # Captions preserve written player names; speech spelling guides pronunciation.
        caption=text.replace('Saint Brown','St. Brown').replace('Devon Achane',"De’Von Achane")
        records.append({'start':start,'end':round(end,4),'text':caption,'time_compression':speed})
        print('VOICE',i,round(duration,2),round(end,2),flush=True)
    sf.write(MEDIA/'voice.wav',narration,SR,subtype='PCM_24')
    synth=Synth(gain=-9,samplerate=SR);bank=synth.sfload(str(WORK/'GeneralUser-GS.sf2'))
    for ch in range(16):synth.program_select(ch,bank,128 if ch==9 else 0,0,is_drums=ch==9)
    orchestra=np.zeros((60*SR,2),np.float32);elapsed=0;cursor=0
    for msg in mido.MidiFile(OUT/'huddle-original-orchestral-cue.mid'):
        elapsed+=msg.time;target=min(len(orchestra),round(elapsed*SR))
        if target>cursor:
            orchestra[cursor:target]=np.frombuffer(synth.generate(target-cursor),np.float32).reshape(-1,2);cursor=target
        if cursor>=len(orchestra):break
        if msg.type=='program_change':synth.program_change(msg.channel,msg.program,is_drums=msg.channel==9)
        elif msg.type=='control_change':synth.control_change(msg.channel,msg.control,msg.value)
        elif msg.type=='note_on':synth.noteon(msg.channel,msg.note,msg.velocity)
        elif msg.type=='note_off':synth.noteoff(msg.channel,msg.note)
    if cursor<len(orchestra):orchestra[cursor:]=np.frombuffer(synth.generate(len(orchestra)-cursor),np.float32).reshape(-1,2)
    sf.write(MEDIA/'music-raw.wav',orchestra,SR,subtype='PCM_24')
    ff('-i',MEDIA/'music-raw.wav','-af','highpass=f=42,lowpass=f=14000,aecho=0.8:0.85:53|83:0.12|0.07,apad,atrim=duration=60,afade=t=in:d=0.3,afade=t=out:st=58.3:d=1.7,loudnorm=I=-23:TP=-4:LRA=9','-ar',SR,MEDIA/'music.wav')
    ff('-i',MEDIA/'voice.wav','-i',MEDIA/'music.wav','-filter_complex','[0:a]acompressor=threshold=0.12:ratio=2.6:attack=12:release=120:makeup=1.3,aecho=0.9:0.95:37:0.055,aformat=channel_layouts=stereo,asplit[v][key];[1:a][key]sidechaincompress=threshold=0.028:ratio=5:attack=8:release=320[bed];[v][bed]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=0,apad,atrim=duration=60[m]','-map','[m]','-ar',SR,MEDIA/'premaster.wav')
    scan=subprocess.run([FF,'-hide_banner','-i',str(MEDIA/'premaster.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8:print_format=json','-f','null','-'],check=True,capture_output=True,text=True)
    measured=json.loads(re.findall(r'\{\s*"input_i".*?\}',scan.stderr,re.S)[-1])
    filt='loudnorm=I=-16:TP=-1.5:LRA=8:linear=true:'+':'.join(f'{k}={measured[v]}' for k,v in [('measured_I','input_i'),('measured_TP','input_tp'),('measured_LRA','input_lra'),('measured_thresh','input_thresh'),('offset','target_offset')])
    ff('-i',MEDIA/'premaster.wav','-af',filt,'-ar',SR,'-ac',2,'-c:a','pcm_s24le',MEDIA/'master.wav')
    (MEDIA/'voice-timing.json').write_text(json.dumps(records,indent=2),encoding='utf-8')
    (OUT/'huddle-draft-narration.txt').write_text('\n\n'.join(r['text'] for r in records)+'\n',encoding='utf-8')
    cues=[]
    for r in records:
        chunks=textwrap.wrap(r['text'],72,break_long_words=False)
        total=sum(len(x) for x in chunks);t=r['start']
        for chunk in chunks:
            end=t+(r['end']-r['start'])*len(chunk)/total;cues.append((t,end,chunk));t=end
    (OUT/'huddle-draft-narration-en.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n'+textwrap.fill(s,42) for i,(a,b,s) in enumerate(cues))+'\n',encoding='utf-8')
    (OUT/'huddle-draft-narration-en.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(a,".")} --> {stamp(b,".")}\n'+textwrap.fill(s,42) for a,b,s in cues)+'\n',encoding='utf-8')
    print('AUDIO COMPLETE',flush=True)

BG='#071811';PANEL='#10271d';LINE='#2b4838';INK='#f2f3e8';MUTED='#b7c6b6';LIME='#c6f552';PURPLE='#bc9bff'
FONTS={}
def font(size,bold=False):
    key=(size,bold)
    if key not in FONTS:FONTS[key]=ImageFont.truetype(str(Path('C:/Windows/Fonts')/('segoeuib.ttf' if bold else 'segoeui.ttf')),size)
    return FONTS[key]
def text(d,xy,s,size=28,fill=INK,bold=False):d.text(xy,str(s),font=font(size,bold),fill=fill)
def wrap(d,xy,s,width,size=28,fill=INK,bold=False,max_lines=5):
    lines=[];line=''
    for word in str(s).split():
        trial=(line+' '+word).strip()
        if d.textlength(trial,font=font(size,bold))>width and line:lines.append(line);line=word
        else:line=trial
    if line:lines.append(line)
    assert len(lines)<=max_lines,(s,lines)
    for i,line in enumerate(lines):text(d,(xy[0],xy[1]+i*size*1.35),line,size,fill,bold)
    return len(lines)*size*1.35

STARTS=[14,18,21,23.2,25.4,27.6,29.8,31.5,33.8,35.4,37.7,38.9,40.1,41.3,42.5]
def frame(t,w,h):
    portrait=h>w;im=Image.new('RGB',(w,h),BG);d=ImageDraw.Draw(im)
    margin=56 if portrait else 76
    # Quiet field markings give the documentary edit an original visual texture.
    for x in range(margin,w,130):d.line((x,140,x,h-80),fill='#10261a',width=2)
    for y in range(160,h-80,110):
        for x in (margin+12,w-margin-12):d.line((x-9,y,x+9,y),fill=LINE,width=2)
    text(d,(margin,40),'HUDDLE',42,LIME,True)
    text(d,(margin,100),'EDITED REPLAY  /  ACTUAL YAHOO MOCK',21,MUTED,True)
    if not portrait:text(d,(w-530,51),'BUMP AND RUN  •  SEPT 8, 2026',21,MUTED)
    if t<6.8:
        text(d,(margin,208),'EVERY PICK.',78 if portrait else 108,INK,True)
        text(d,(margin,315 if portrait else 335),'ACCOUNTED FOR.',68 if portrait else 108,LIME,True)
        wrap(d,(margin,470),'Huddle recommendations. Browser-assisted selections. Confirmed Yahoo results.',w-2*margin,37 if portrait else 43,MUTED,max_lines=3)
        y=730 if portrait else 650
        for i,(v,label) in enumerate([('15','VERIFIED PICKS'),('0','AUTOPICKS'),('120','RECONCILED')]):
            x=margin+i*(w-2*margin)/3
            text(d,(x,y),v,88,LIME,True);text(d,(x,y+112),label,19 if portrait else 25,MUTED,True)
        text(d,(margin,h-145),'8 teams  /  15 rounds  /  30-second clock',23,MUTED)
    elif t<44:
        idx=max(0,sum(t>=s for s in STARTS)-1);p=PICKS[idx]
        phase=0 if t<14 else min(1,(t-STARTS[idx])/(max(.3,((STARTS[idx+1] if idx<14 else 44)-STARTS[idx]))))
        accepted=phase>.46
        text(d,(margin,156),f'PICK {p["pick"]:03}  /  ROUND {math.ceil(p["pick"]/8):02}',35,LIME,True)
        if portrait:
            a=(margin,226,w-margin,700);b=(margin,724,w-margin,1058)
        else:
            a=(margin,230,w/2-30,750);b=(w/2+30,230,w-margin,750)
        for box in (a,b):d.rounded_rectangle(box,24,fill=PANEL,outline=LINE,width=2)
        ax,ay,ar,ab=a;bx,by,br,bb=b;aw=ar-ax;bw=br-bx
        text(d,(ax+30,ay+26),'HUDDLE RECOMMENDS',23,LIME,True)
        name=p.get('fullName',p['name'])
        nameheight=wrap(d,(ax+30,ay+80),name,aw-60,44 if portrait else 52,INK,True,max_lines=2)
        py=ay+92+nameheight
        text(d,(ax+30,py),f'{p["position"]}  ·  {p["team"]}  ·  BYE {p["byeWeek"]}',25,MUTED,True)
        text(d,(ax+30,py+50),f'{p["projectedPoints"]:.2f}',44,LIME,True)
        text(d,(ax+200,py+64),'projected season points',21,MUTED)
        # Exact saved rationale; one editorial excerpt, not a fabricated score.
        why=p['why'].split('\n')
        reason=why[1] if len(why)>1 else why[0]
        if idx==14:reason=why[0]
        wrap(d,(ax+30,py+122),reason,aw-60,26 if portrait else 29,MUTED,max_lines=4)
        text(d,(bx+30,by+26),'YAHOO SELECTION',23,PURPLE,True)
        wrap(d,(bx+30,by+78),p['name'],bw-60,44 if portrait else 52,INK,True,max_lines=2)
        text(d,(bx+30,by+153),f'{p["position"]} · {p["team"]}   /   ID {p["yahooPlayerId"]}',23,MUTED)
        button=(bx+30,by+207,br-30,by+279)
        d.rounded_rectangle(button,12,fill=LIME if accepted else '#7252a6')
        text(d,(bx+52,by+222),'CONFIRMED IN YAHOO' if accepted else 'RECOMMENDATION READY',22,BG if accepted else INK,True)
        if not portrait:
            text(d,(bx+30,by+333),f'{p["elapsedMs"]/1000:.2f}s',62,LIME,True)
            text(d,(bx+30,by+420),'Observed selection time',24,MUTED)
        else:text(d,(bx+30,by+290),f'Actual selection: {p["elapsedMs"]/1000:.2f}s',21,MUTED)
        count=idx+int(accepted)
        y=1100 if portrait else 809
        for j in range(15):
            x=margin+j*(w-2*margin)/15
            d.rounded_rectangle((x,y,x+(w-2*margin)/15-8,y+13),4,fill=LIME if j<count else LINE)
        text(d,(margin,y+36),f'{count:02} / 15 verified  •  0 autopicks',27,INK,True)
        if not portrait:text(d,(margin,y+88),'Exact saved recommendations and receipts. Sequence condensed for this edit.',22,MUTED)
    elif t<53.7:
        text(d,(margin,166),'A COMPLETE ROSTER.',52 if portrait else 76,INK,True)
        text(d,(margin,255),'15 verified picks. Zero autopicks.',30 if portrait else 40,LIME,True)
        vals=[('WR',5),('RB',4),('QB',2),('TE',2),('K',1),('DEF',1)]
        top=350
        for i,(pos,n) in enumerate(vals):
            y=top+i*(86 if portrait else 71)
            text(d,(margin,y),pos,31,MUTED,True)
            end=margin+145+n*((w-2*margin-220)/5)
            d.rounded_rectangle((margin+115,y+7,end,y+43),7,fill=LIME if pos=='WR' else '#6e9f53')
            text(d,(end+18,y),n,30,INK,True)
        y=top+6*(86 if portrait else 71)+28
        wrap(d,(margin,y),'All offensive bye slots covered by owned players.',w-2*margin,28,INK,True,max_lines=2)
        wrap(d,(margin,y+83 if portrait else y+50),'K week 7 and DEF week 11 still need outside help.',w-2*margin,23,MUTED,max_lines=2)
    else:
        text(d,(margin,190),'YOUR LEAGUE.',65 if portrait else 100,INK,True)
        text(d,(margin,292 if portrait else 330),'YOUR CALL.',65 if portrait else 100,LIME,True)
        wrap(d,(margin,430 if portrait else 490),'One successful rehearsal. Every decision saved for review.',w-2*margin,33 if portrait else 39,MUTED,max_lines=3)
        shotpath=OUT/'huddle-draft-yahoo-complete.png'
        if shotpath.exists():
            shot=Image.open(shotpath).convert('RGB');shot.thumbnail((w-2*margin,420 if portrait else 310))
            sx=margin;sy=620 if portrait else 615;im.paste(shot,(sx,sy))
            text(d,(margin,sy+shot.height+12),'Actual completed Yahoo room • account details excluded',18,MUTED)
    text(d,(margin,h-51),'Huddle is independent of Yahoo. AI narration · Original orchestral arrangement.',17,MUTED)
    d.rectangle((0,h-8,int(w*min(1,t/60)),h),fill=LIME)
    return im

def visuals():
    for label,w,h in [('landscape',1920,1080),('feed',1080,1350)]:
        path=OUT/f'huddle-draft-narrated-{label}-{w}x{h}.mp4'
        cmd=[FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r','15','-i','-','-i',str(MEDIA/'master.wav'),'-map','0:v','-map','1:a','-c:v','libx264','-preset','fast','-crf','19','-profile:v','high','-pix_fmt','yuv420p','-r','30','-threads','4','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t','60','-movflags','+faststart','-metadata','comment=Edited replay of actual Yahoo mock 10996021; saved Huddle recommendations and verified receipts. AI stock narration; original music.',str(path)]
        proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
        try:
            for n in range(900):
                im=frame(n/15,w,h);proc.stdin.write(im.tobytes())
                if n in (30,240,480,720,840):im.save(MEDIA/f'qa-{label}-{n//15}.jpg',quality=92)
                if n%150==0:print('VIDEO',label,n//15,flush=True)
        finally:proc.stdin.close()
        assert proc.wait()==0
    ff('-i',OUT/'huddle-draft-narrated-landscape-1920x1080.mp4','-vf','scale=1280:720:flags=lanczos,setsar=1','-c:v','libx264','-crf',19,'-preset','fast','-pix_fmt','yuv420p','-r',30,'-threads',4,'-c:a','copy','-movflags','+faststart',OUT/'huddle-draft-narrated-x-1280x720.mp4')
    frame(2,1920,1080).save(OUT/'huddle-draft-preview-poster.jpg',quality=94)
    print('VIDEO COMPLETE',flush=True)

def validate():
    report=[]
    for label,w,h in [('landscape',1920,1080),('feed',1080,1350),('x',1280,720)]:
        p=OUT/f'huddle-draft-narrated-{label}-{w}x{h}.mp4'
        reader=imageio_ffmpeg.read_frames(str(p));meta=next(reader);reader.close()
        frames,duration=imageio_ffmpeg.count_frames_and_secs(str(p))
        assert meta['size']==(w,h) and meta['fps']==30 and frames==1800 and abs(duration-60)<.1
        scan=subprocess.run([FF,'-hide_banner','-i',str(p),'-af','loudnorm=I=-16:TP=-1.5:LRA=8:print_format=json','-f','null','-'],check=True,capture_output=True,text=True)
        assert 'aac (LC)' in scan.stderr and '48000 Hz, stereo' in scan.stderr and 'yuv420p' in scan.stderr
        levels=json.loads(re.findall(r'\{\s*"input_i".*?\}',scan.stderr,re.S)[-1])
        ff('-xerror','-i',p,'-f','null','-')
        data=p.read_bytes();assert data.find(b'moov')<data.find(b'mdat')
        report.append({'file':p.name,'width':w,'height':h,'fps':30,'frames':frames,'seconds':duration,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'video':'H.264 yuv420p','audio':'AAC LC stereo 48 kHz','faststart':True,'full_decode':'passed','audio_measurement':levels})
        print('VALIDATED',p.name,len(data),flush=True)
    result={'date':'2026-09-08','kind':'Edited replay of actual Yahoo mock 10996021; recreated cards from saved evidence, plus actual completed-room screenshot. Not continuous screen recording.','manual_picks':15,'autopicks':0,'reconciled_picks':120,'voice':'Kokoro stock am_michael 70% / am_onyx 30%, pitch 0.955; no announcer clone','music':'Existing original Huddle 24-bar orchestral cue, newly rendered offline with GeneralUser GS / TinySoundFont','caption_timing':'Phrase estimates within fitted narration windows, not forced alignment','paid_generation_api_used':False,'platform_upload_tested':False,'files':report}
    (OUT/'huddle-draft-narrated-validation.json').write_text(json.dumps(result,indent=2)+'\n')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('step',choices=['audio','visuals','validate','all','stills']);arg=parser.parse_args()
    if arg.step in ('audio','all'):audio()
    if arg.step in ('visuals','all'):visuals()
    if arg.step in ('validate','all'):validate()
    if arg.step=='stills':
        for label,w,h in [('landscape',1920,1080),('feed',1080,1350)]:
            for t in (2,16,32,48,56):frame(t,w,h).save(MEDIA/f'qa-{label}-{t}.jpg',quality=92)
