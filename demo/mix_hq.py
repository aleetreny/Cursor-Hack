"""Assemble the HQ promo from timestamped CDP frames + neural narration + generated music.
Usage: python demo/mix_hq.py <dir with frames/, frames.json, marks.json, lines.json, s1..s5.mp3> <ffmpeg> [out.mp4]"""
import json, subprocess, sys
V, FF = sys.argv[1], sys.argv[2]
OUT = sys.argv[3] if len(sys.argv) > 3 else f'{V}/FireScope3D_demo_1440p60.mp4'
ts = json.load(open(f'{V}/frames.json')); m = json.load(open(f'{V}/marks.json')); lines = {l['id']: l for l in json.load(open(f'{V}/lines.json'))}
t0 = m['s1'] - 0.04
rel = {k: m[k] - t0 for k in ('s2', 's3', 's4', 's5', 'endcard')}
endT = rel['endcard'] + 6.0
# ffconcat with exact per-frame durations (frames are wall-clock timestamped)
idx = [i for i, t in enumerate(ts) if t0 - 0.05 <= t <= t0 + endT + 0.1]
with open(f'{V}/frames.ffconcat', 'w') as f:
    f.write('ffconcat version 1.0\n')
    for a, b in zip(idx, idx[1:]):
        f.write(f"file 'frames/{a:06d}.jpg'\nduration {ts[b] - ts[a]:.5f}\n")
    f.write(f"file 'frames/{idx[-1]:06d}.jpg'\nduration 0.1\n")
starts, prev = {}, 0
for sid, base in [('s1', 0.35), ('s2', rel['s2'] + 0.25), ('s3', rel['s3'] + 0.3), ('s4', rel['s4'] + 0.3), ('s5', rel['s5'] + 0.35)]:
    st = max(base, prev + 0.25); starts[sid] = st; prev = st + lines[sid]['dur']
print({k: round(v, 2) for k, v in rel.items()}, 'end', round(endT, 2), 'voice', {k: round(v, 2) for k, v in starts.items()}, 'ends', round(prev, 2))
music = ("aevalsrc='0.16*sin(2*PI*110*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.11*sin(2*PI*164.81*t)*(0.6+0.4*sin(2*PI*0.05*t+1))"
         "+0.09*sin(2*PI*220*t)*(0.5+0.5*sin(2*PI*0.09*t+2))+0.06*sin(2*PI*261.63*t)*(0.5+0.5*sin(2*PI*0.06*t+3))"
         "+0.045*sin(2*PI*329.63*t)*(0.5+0.5*sin(2*PI*0.11*t+4))+0.10*sin(2*PI*55*t)':s=48000:d=%.2f" % (endT + 1))
fc = [f"[0:v]fps=60,scale=2560:1440:flags=lanczos:in_range=pc:out_range=tv,unsharp=5:5:0.15:5:5:0.0,fade=t=in:st=0:d=0.6,fade=t=out:st={endT - 0.9}:d=0.9,format=yuv420p[v]",
      f"{music},lowpass=f=1600,aecho=0.8:0.6:140|280:0.30|0.20,afade=t=in:st=0:d=2.5,afade=t=out:st={endT - 3}:d=3,volume=0.55[pad]",
      f"anoisesrc=color=brown:amplitude=0.08:sample_rate=48000:d={endT + 1},lowpass=f=420,highpass=f=40,volume=0.35,afade=t=in:d=3,afade=t=out:st={endT - 3}:d=3[wind]",
      "[pad][wind]amix=inputs=2:normalize=0[mus]"]
vin = []
for i, sid in enumerate(['s1', 's2', 's3', 's4', 's5']):
    ms = int(starts[sid] * 1000); fc.append(f"[{i + 1}:a]aresample=48000,adelay={ms}|{ms},volume=1.6[v{i}]"); vin.append(f"[v{i}]")
fc += ["".join(vin) + "amix=inputs=5:normalize=0,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,asplit=2[voice][sc]",
       "[mus][sc]sidechaincompress=threshold=0.03:ratio=8:attack=40:release=500[ducked]",
       f"[voice][ducked]amix=inputs=2:normalize=0,atrim=0:{endT},loudnorm=I=-14:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo[a]"]
cmd = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-safe', '0', '-f', 'concat', '-i', f'{V}/frames.ffconcat'] + sum([['-i', f'{V}/{s}.mp3'] for s in ['s1', 's2', 's3', 's4', 's5']], []) + [
    '-filter_complex', ';'.join(fc), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-tune', 'film', '-profile:v', 'high', '-level', '5.1',
    '-g', '120', '-bf', '2', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', '-t', f'{endT:.2f}', OUT]
r = subprocess.run(cmd, capture_output=True, text=True); print('ffmpeg', r.returncode, r.stderr[-800:])
