#!/usr/bin/env python3
"""Build original narration and an original orchestral cue for Huddle's 60s previews.
Requires Kokoro, NumPy, SoundFile, Mido, FFmpeg, espeak-ng and FluidSynth.
Uses synthetic stock voice embeddings, never a recording/clone of an announcer.
Nothing connects to Yahoo, reads app credentials, or changes application state.
"""
from pathlib import Path
import hashlib, json, math, os, re, subprocess, textwrap, urllib.request
import numpy as np
import soundfile as sf
import mido

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/assets'
WORK = ROOT / '.media-build'
WORK.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
SR = 48000
SEGMENTS = [
    (0.65, 5.70, 'Every season begins with a choice. Make yours count.'),
    (6.30, 12.65, 'This is Huddle. Connect Yahoo. Your leagues. Your rules. One command center.'),
    (13.25, 20.65, 'As the draft unfolds, compare your best pick, the safer choice, and the upside play.'),
    (21.25, 27.65, 'Multiple data sources. Clear reasoning. Rankings built by rules, not guesswork.'),
    (28.25, 35.65, 'After draft day, review scores, standings, and the points left on your bench.'),
    (36.30, 42.60, 'Find the next addition. Weigh the trade-offs. Or hold your ground.'),
    (43.30, 49.65, 'Before the clock starts, check draft readiness, right inside the app.'),
    (50.25, 55.65, 'Huddle reads the field. You make every move in Yahoo.'),
    (56.25, 59.35, 'Huddle. Your league. Your call.'),
]

def run(*args):
    subprocess.run([str(x) for x in args], check=True)

def ff(*args):
    run('ffmpeg','-hide_banner','-loglevel','error','-y',*args)

def checksum(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()

def stamp(t, sep=','):
    ms = round(t * 1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}{sep}{ms%1000:03}'

def download(url, dest):
    with urllib.request.urlopen(url, timeout=120) as r:
        Path(dest).write_bytes(r.read())

def make_voice():
    import torch
    from kokoro import KPipeline
    torch.set_num_threads(2)
    torch.manual_seed(11)
    pipeline = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device='cpu')
    voice = .70 * pipeline.load_voice('am_michael') + .30 * pipeline.load_voice('am_onyx')
    narration = np.zeros(60 * SR, dtype=np.float32)
    records = []
    for idx, (start, deadline, text) in enumerate(SEGMENTS):
        with torch.inference_mode():
            results = list(pipeline(text, voice=voice, speed=.88, split_pattern=None))
        assert results and all(r.audio is not None for r in results), 'Speech synthesis returned no audio'
        audio = np.concatenate([r.audio.cpu().numpy() for r in results])
        active = np.flatnonzero(np.abs(audio) > .001)
        assert len(active), 'Speech segment is silent'
        lo = max(0, int(active[0]) - 1080)
        hi = min(len(audio), int(active[-1]) + 1080)
        audio = audio[lo:hi]
        raw = WORK / f'voice-{idx}.wav'
        sf.write(raw, audio, 24000, subtype='PCM_24')
        length = len(audio) / 24000
        factor = max(1.0, length / (deadline - start))
        if factor > 1.30:
            raise RuntimeError(f'Segment {idx} needs rewriting: {length:.2f}s for {deadline-start:.2f}s')
        processed = WORK / f'voice-{idx}-fit.wav'
        ff('-i',raw,'-af',f'atempo={factor:.8f},rubberband=pitch=0.955,highpass=f=70,lowpass=f=9500,equalizer=f=145:t=q:w=0.8:g=1.8,equalizer=f=3100:t=q:w=0.9:g=1.3','-ar',SR,'-ac','1',processed)
        fitted, sr = sf.read(processed, dtype='float32')
        assert sr == SR
        end = start + len(fitted) / SR
        assert end <= deadline + .06, f'Segment {idx} exceeds scene window'
        rms = np.sqrt(np.mean(fitted*fitted))
        fitted *= min(.15 / max(float(rms),1e-6), .90 / max(float(np.max(np.abs(fitted))),1e-6))
        offset = round(start * SR)
        narration[offset:offset+len(fitted)] += fitted
        records.append({'start':start,'end':round(end,4),'text':text,'original_seconds':round(length,4),'time_compression':round(factor,5)})
        print('NARRATION', json.dumps(records[-1]), flush=True)
    voice_raw = WORK/'voice-aligned.wav'
    sf.write(voice_raw,narration,SR,subtype='PCM_24')
    ff('-i',voice_raw,'-af','acompressor=threshold=0.12:ratio=2.6:attack=12:release=120:makeup=1.35,aecho=0.9:0.95:37:0.055,apad,atrim=duration=60','-ar',SR,WORK/'narration.wav')
    (WORK/'narration-timing.json').write_text(json.dumps(records,indent=2)+'\n')
    (OUT/'huddle-narration.txt').write_text('\n\n'.join(t for _,_,t in SEGMENTS)+'\n')
    cues=[]
    for rec in records:
        parts=re.findall(r'[^.!?]+[.!?]?',rec['text'])
        total=sum(len(p.split()) for p in parts)
        t=rec['start']
        for p in parts:
            dur=(rec['end']-rec['start'])*len(p.split())/total
            cues.append((t,t+dur,p.strip())); t+=dur
    srt='\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n'+textwrap.fill(t,46) for i,(a,b,t) in enumerate(cues))+'\n'
    (OUT/'huddle-narration-en.srt').write_text(srt)
    vtt='WEBVTT\n\n'+'\n\n'.join(f'{stamp(a,".")} --> {stamp(b,".")}\n'+textwrap.fill(t,46) for a,b,t in cues)+'\n'
    (OUT/'huddle-narration-en.vtt').write_text(vtt)
    return records

def make_music():
    # Original 24-bar D-minor-to-D-major cue; 100 BPM, 4/4, 57.6s + release.
    # No sports-theme MIDI, melody, master recording or broadcaster samples used.
    mid=mido.MidiFile(ticks_per_beat=480)
    tempo=mido.MidiTrack();mid.tracks.append(tempo)
    tempo.append(mido.MetaMessage('set_tempo',tempo=600000,time=0))
    tempo.append(mido.MetaMessage('time_signature',numerator=4,denominator=4,time=0))
    tracks={}
    specs=[(0,60,65,54,'French horns'),(1,61,55,72,'Low brass'),(2,48,58,36,'Violins'),(3,49,53,90,'Violas and cellos'),(4,43,67,64,'Contrabass'),(5,47,75,68,'Timpani'),(6,56,44,80,'Trumpet accents'),(9,0,55,60,'Field percussion')]
    for ch,prog,vol,pan,name in specs:
        tracks[ch]=[(0,mido.MetaMessage('track_name',name=name)),(0,mido.Message('program_change',channel=ch,program=prog)),(0,mido.Message('control_change',channel=ch,control=7,value=vol)),(0,mido.Message('control_change',channel=ch,control=10,value=pan)),(0,mido.Message('control_change',channel=ch,control=91,value=42))]
    def note(ch,p,b,d,v):
        assert 0<=p<=127 and d>0
        tracks[ch].append((round(b*480),mido.Message('note_on',channel=ch,note=p,velocity=max(1,min(120,round(v))))))
        tracks[ch].append((round((b+d)*480),mido.Message('note_off',channel=ch,note=p,velocity=0)))
    harmony=[(38,[50,57,62,65]),(34,[50,58,62,65]),(41,[53,60,65,69]),(36,[48,55,60,64]),(38,[50,57,62,65]),(43,[50,58,62,67]),(34,[50,58,62,65]),(33,[49,57,61,64]),(38,[50,57,62,65]),(36,[48,55,60,64]),(34,[50,58,62,65]),(33,[49,57,61,64]),(43,[50,58,62,67]),(38,[50,57,62,65]),(34,[50,58,62,65]),(33,[49,57,61,64]),(38,[50,57,62,65]),(34,[50,58,62,65]),(43,[50,58,62,67]),(33,[49,57,61,64]),(38,[50,57,62,65]),(36,[48,55,60,64]),(33,[49,57,61,64]),(38,[50,57,62,66])]
    motifs={0:[(62,0,1.5),(65,1.5,.5),(69,2,1.7)],1:[(70,0,1.25),(67,1.5,.5),(65,2,1.8)],2:[(69,0,2),(72,2,1.7)],3:[(67,0,1.5),(64,1.5,.5),(60,2,1.6)],8:[(62,0,1.5),(69,1.5,.5),(65,2,1.7)],9:[(67,0,1.2),(72,1.5,.5),(64,2,1.6)],16:[(69,0,1.5),(65,1.5,.5),(62,2,1.7)],17:[(65,0,1.5),(70,1.5,.5),(74,2,1.6)],20:[(62,0,1),(65,1.2,.65),(69,2,1.65)],21:[(67,0,1.5),(72,1.5,.5),(76,2,1.7)],22:[(73,0,1.5),(69,1.5,.5),(61,2,1.7)],23:[(62,0,3.7)]}
    for bar,(bass,chord) in enumerate(harmony):
        b=bar*4
        intensity=.70 if 4<=bar<16 else .88 if bar<4 else 1.0
        if bar==23:
            for p in chord:note(0,p,b,3.7,90);note(2,p+12,b,3.7,72)
        else:
            for p,o,d in motifs.get(bar,[]):note(0,p,b+o,d,74*intensity)
        for p in chord:
            note(3,p,b+.03,3.85,56*intensity)
            if bar in [0,4,8,12,16,20,22,23]:note(1,p-12 if p>60 else p,b,1.65 if bar<23 else 3.8,72*intensity)
        if bar<23:
            for k in range(8):
                p=chord[(k//2)%4]+12
                note(2,p,b+k*.5+.018,.31,46*intensity+(7 if k%2==0 else 0))
            for k in range(4):note(4,bass-12,b+k,.77,70*intensity)
        else:note(4,bass-12,b,3.8,85)
        note(5,bass,b,.72,78*intensity)
        if bar<23:note(5,bass+7,b+2,.65,59*intensity)
        if bar>=2 and bar<23:
            for k in [1,3]:
                note(9,38,b+k,.08,45*intensity)
                note(9,38,b+k-.125,.045,19*intensity)
            note(9,36,b,.12,68*intensity)
        if bar in [7,15,19,22]:
            for k in range(8):note(9,38,b+3+k*.125,.06,25+3*k)
        if bar in [0,8,16,20,23]:note(9,49,b,2,48 if bar<20 else 64)
        if bar in [20,21,22,23]:
            for p,o,d in motifs[bar]:note(6,p+12,b+o+.035,d*.95,56 if bar<23 else 68)
    for ch,events in tracks.items():
        track=mido.MidiTrack();mid.tracks.append(track);last=0
        for tick,msg in sorted(events,key=lambda x:x[0]):
            track.append(msg.copy(time=tick-last));last=tick
        track.append(mido.MetaMessage('end_of_track',time=max(1,480*100-last)))
    midi=OUT/'huddle-original-orchestral-cue.mid';mid.save(midi)
    bank=WORK/'GeneralUser-GS.sf2'
    download('https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2',bank)
    assert bank.read_bytes()[:4]==b'RIFF' and bank.stat().st_size>30000000
    download('https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt',WORK/'GeneralUser-GS-LICENSE.txt')
    run('fluidsynth','-ni','-r',SR,'-g','0.65','-o','synth.reverb.active=1','-o','synth.reverb.room-size=0.72','-o','synth.reverb.damp=0.35','-o','synth.reverb.level=0.25','-F',WORK/'orchestra-render.wav',bank,midi)
    ff('-i',WORK/'orchestra-render.wav','-af','atrim=duration=60,highpass=f=42,lowpass=f=14000,afade=t=in:d=0.20,afade=t=out:st=58.5:d=1.5,loudnorm=I=-23:TP=-4:LRA=9','-ar',SR,WORK/'orchestra.wav')
    return {'title':'Your League, Your Call','composition':'Original 24-bar orchestral cue, D minor resolving to D major, 100 BPM','instruments':[x[4] for x in specs],'sample_bank':'GeneralUser GS','sample_bank_sha256':checksum(bank),'sample_license':'https://github.com/mrbumpy409/GeneralUser-GS/blob/main/documentation/LICENSE.txt','source_recordings':'No NFL, broadcast, film-theme, or announcer recordings used.'}

def mix_and_export():
    ff('-i',WORK/'narration.wav','-i',WORK/'orchestra.wav','-filter_complex','[0:a]aformat=channel_layouts=stereo,asplit[v][key];[1:a][key]sidechaincompress=threshold=0.028:ratio=5:attack=8:release=320:makeup=1[bed];[v][bed]amix=inputs=2:normalize=0,alimiter=limit=0.89:level=0,apad,atrim=duration=60[m]','-map','[m]','-ar',SR,WORK/'mix-premaster.wav')
    cmd=['ffmpeg','-hide_banner','-i',str(WORK/'mix-premaster.wav'),'-af','loudnorm=I=-16:TP=-1.5:LRA=8:print_format=json','-f','null','-']
    scan=subprocess.run(cmd,check=True,capture_output=True,text=True)
    measurement=json.loads(re.findall(r'\{\s*"input_i".*?\}',scan.stderr,re.S)[-1])
    filt='loudnorm=I=-16:TP=-1.5:LRA=8:linear=true:'+':'.join(f'{k}={measurement[v]}' for k,v in [('measured_I','input_i'),('measured_TP','input_tp'),('measured_LRA','input_lra'),('measured_thresh','input_thresh'),('offset','target_offset')])
    master=WORK/'huddle-voiceover-mix.wav'
    ff('-i',WORK/'mix-premaster.wav','-af',filt,'-ar',SR,'-ac','2','-c:a','pcm_s24le',master)
    files=[]
    variants=[('huddle-linkedin-article-1920x1080.mp4','huddle-narrated-landscape-1920x1080.mp4',1920,1080),('huddle-linkedin-feed-1080x1350.mp4','huddle-narrated-feed-1080x1350.mp4',1080,1350)]
    for src,dst,w,h in variants:
        ff('-i',OUT/src,'-i',master,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-ar',SR,'-ac','2','-t','60','-metadata','comment=AI-generated narration; original orchestral score. Feature overview, not live-account footage.','-movflags','+faststart',OUT/dst)
        files.append((dst,w,h))
    dst='huddle-narrated-x-1280x720.mp4'
    ff('-i',OUT/'huddle-narrated-landscape-1920x1080.mp4','-vf','scale=1280:720:flags=lanczos,setsar=1','-c:v','libx264','-preset','medium','-profile:v','high','-pix_fmt','yuv420p','-r','30','-b:v','5M','-minrate','5M','-maxrate','5M','-bufsize','10M','-x264-params','nal-hrd=cbr','-c:a','copy','-movflags','+faststart',OUT/dst)
    files.append((dst,1280,720))
    report=[]
    for name,w,h in files:
        p=OUT/name
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
        video=next(s for s in probe['streams'] if s['codec_type']=='video')
        audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
        assert video['codec_name']=='h264' and video['pix_fmt']=='yuv420p'
        assert (video['width'],video['height'])==(w,h) and video['avg_frame_rate']=='30/1'
        assert audio['codec_name']=='aac' and audio['profile']=='LC' and audio['channels']==2 and audio['sample_rate']=='48000'
        assert abs(float(probe['format']['duration'])-60)<.1 and p.stat().st_size<512000000
        ff('-xerror','-i',p,'-f','null','-')
        report.append({'path':'docs/assets/'+name,'bytes':p.stat().st_size,'sha256':checksum(p),'width':w,'height':h,'fps':30,'duration':float(probe['format']['duration']),'video_codec':'h264','audio_codec':'AAC LC','audio_sample_rate':48000,'channels':2,'full_decode':'passed'})
    return report,measurement

if __name__=='__main__':
    voice=make_voice()
    music=make_music()
    files,levels=mix_and_export()
    report={'date':'2026-09-06','kind':'Narrated editorial feature overview; original orchestral music; not live-account footage','voice':{'method':'Kokoro-82M stock synthetic voice blend; no custom voice clone','blend':{'am_michael':.7,'am_onyx':.3},'pitch_factor':.955,'model_license':'Apache-2.0','model_url':'https://huggingface.co/hexgrad/Kokoro-82M'},'music':music,'narration_timing':voice,'caption_timing':'Sentence estimates within fitted scene windows, not forced alignment','master_loudness_target_lufs':-16,'true_peak_target_dbtp':-1.5,'premaster_measurement':levels,'files':files,'platform_upload_tested':False,'paid_generation_api_used':False}
    (OUT/'huddle-narrated-validation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2),flush=True)
