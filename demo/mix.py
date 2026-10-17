import json, subprocess, sys
V, FF = sys.argv[1], sys.argv[2]
mk = json.load(open(f'{V}/mk.json')); wall = json.load(open(f'{V}/marks.json')); lines = {l['id']: l for l in json.load(open(f'{V}/lines.json'))}
k = (mk['endcard'] - mk['s1']) / (wall['endcard'] - wall['s1'])           # recording stretch vs wall clock
s0 = mk['s1']
rel = {kk: (mk[kk] - s0) / k for kk in ('s2', 's3', 's4', 's5', 'endcard')}
endT = rel['endcard'] + 6.0
starts, prev = {}, 0
for sid, base in [('s1', 0.35), ('s2', rel['s2'] + 0.25), ('s3', rel['s3'] + 0.3), ('s4', rel['s4'] + 0.3), ('s5', rel['s5'] + 0.35)]:
    st = max(base, prev + 0.25); starts[sid] = st; prev = st + lines[sid]['dur']
print('k', round(k, 4), {a: round(b, 2) for a, b in rel.items()}, 'end', round(endT, 2), 'voice', {a: round(b, 2) for a, b in starts.items()}, 'voice end', round(prev, 2))
music = ("aevalsrc='0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.11*sin(2*PI*164.81*t)*(0.6+0.4*sin(2*PI*0.05*t+1))"
         "+0.09*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.09*t+2))+0.06*sin(2*PI*261.63*t)*(0.5+0.5*sin(2*PI*0.06*t+3))"
         "+0.045*sin(2*PI*329.63*t)*(0.5+0.5*sin(2*PI*0.11*t+4))+0.10*sin(2*PI*55*t)':s=44100:d=%.2f" % (endT + 1))
fc = [f"[0:v]trim=start={s0 - 0.04}:duration={endT * k + 0.2},setpts=(PTS-STARTPTS)/{k},fps=30,"
      f"drawbox=x=1906:y=1068:w=14:h=12:color=0xE9E4DA:t=fill:enable='lt(t,{rel['endcard']})',"
      f"drawbox=x=1906:y=1068:w=14:h=12:color=0x0B0908:t=fill:enable='gte(t,{rel['endcard']})',"
      f"fade=t=in:st=0:d=0.6,fade=t=out:st={endT - 0.9}:d=0.9,format=yuv420p[v]",
      f"{music},lowpass=f=1600,aecho=0.8:0.6:140|280:0.30|0.20,afade=t=in:st=0:d=2.5,afade=t=out:st={endT - 3}:d=3,volume=0.55[pad]",
      f"anoisesrc=color=brown:amplitude=0.08:d={endT + 1},lowpass=f=420,highpass=f=40,volume=0.35,afade=t=in:d=3,afade=t=out:st={endT - 3}:d=3[wind]",
      "[pad][wind]amix=inputs=2:normalize=0[mus]"]
vin = []
for i, sid in enumerate(['s1', 's2', 's3', 's4', 's5']):
    ms = int(starts[sid] * 1000); fc.append(f"[{i + 1}:a]aresample=44100,adelay={ms}|{ms},volume=1.6[v{i}]"); vin.append(f"[v{i}]")
fc += ["".join(vin) + "amix=inputs=5:normalize=0,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,asplit=2[voice][sc]",
       "[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=40:release=500[ducked]",
       f"[voice][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.89,atrim=0:{endT},aformat=channel_layouts=stereo[a]"]
cmd = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', f'{V}/raw.webm'] + sum([['-i', f'{V}/{s}.mp3'] for s in ['s1', 's2', 's3', 's4', 's5']], []) + [
    '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', f'{endT:.2f}', f'{V}/FireScope3D_demo.mp4']
r = subprocess.run(cmd, capture_output=True, text=True); print('ffmpeg', r.returncode, r.stderr[-800:])
