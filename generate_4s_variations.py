import numpy as np
import subprocess

SAMPLE_RATE = 44100

def n2f(note_str):
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    flats = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}
    octave = int(note_str[-1])
    n = note_str[:-1]
    if n in flats: n = flats[n]
    semi = notes.index(n)
    midi = (octave + 1) * 12 + semi
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

def make_bw_kick(dur=0.25):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    freq = 140 * np.exp(-t * 22) + 45
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-t * 12)
    click = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 70)
    return (0.85 * np.sin(phase) * env + click).astype(np.float32)

def make_bw_snare(dur=0.28):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    tone = np.sin(2 * np.pi * 175 * np.exp(-t * 12) * t) * np.exp(-t * 15)
    noise = np.random.normal(0, 0.45, len(t)) * np.exp(-t * 10)
    clap_t = t[:int(0.07 * SAMPLE_RATE)]
    clap = np.random.normal(0, 0.35, len(clap_t)) * np.exp(-clap_t * 28)
    res = (0.35 * tone + 0.55 * noise)
    res[:len(clap)] += clap * 0.45
    return res.astype(np.float32)

def make_bw_hihat(dur=0.07):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 40)
    return noise.astype(np.float32)

def make_bw_crash(dur=1.8):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.5, len(t)) * np.exp(-t * 2.6)
    shimmer = 0.15 * np.sin(2 * np.pi * 587.3 * t) * np.exp(-t * 3.0) + \
              0.15 * np.sin(2 * np.pi * 880.0 * t) * np.exp(-t * 2.8)
    return (noise + shimmer).astype(np.float32)

def make_bw_synth_brass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    saw = 2 * ((t * freq) % 1) - 1
    pulse = np.where((t * freq) % 1 < 0.28, 1.0, -1.0)
    raw = 0.62 * saw + 0.38 * pulse
    rc = 1.0 / (2.0 * np.pi * (3400 + 1400 * np.exp(-t * 10)))
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    out = np.zeros_like(raw)
    y = 0.0
    for i in range(len(raw)):
        y = y + alpha[i] * (raw[i] - y)
        out[i] = y
    attack = int(0.010 * SAMPLE_RATE)
    decay = int(0.045 * SAMPLE_RATE)
    env = np.ones_like(t)
    if len(env) > attack: env[:attack] = np.linspace(0, 1, attack)
    if len(env) > decay: env[-decay:] = np.linspace(1, 0.001, decay)
    return (out * env).astype(np.float32)

def make_bw_bass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    sub = np.sin(2 * np.pi * freq * t)
    harm = 0.45 * np.sin(4 * np.pi * freq * t) + 0.25 * np.sin(6 * np.pi * freq * t)
    click = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 80)
    env = np.exp(-t * 5.5)
    return ((sub + harm) * env + click).astype(np.float32)

def make_bw_rhodes(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.35 * np.sin(4 * np.pi * freq * t)
    s3 = 0.15 * np.sin(6 * np.pi * freq * t)
    tine = 0.22 * np.sin(14 * np.pi * freq * t) * np.exp(-t * 25)
    env = np.exp(-t * 3.2)
    return ((s1 + s2 + s3) * env + tine).astype(np.float32)

def make_bw_bell(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.3 * np.sin(6 * np.pi * freq * t)
    env = np.exp(-t * 4.5)
    return ((s1 + s2) * env).astype(np.float32)

def add_stereo_reverb(mono, wet=0.28):
    n = len(mono)
    l = np.copy(mono)
    r = np.copy(mono)
    d1 = int(0.017 * SAMPLE_RATE)
    d2 = int(0.029 * SAMPLE_RATE)
    d3 = int(0.047 * SAMPLE_RATE)
    if d1 < n: l[d1:] += mono[:-d1] * wet * 0.7
    if d2 < n: r[d2:] += mono[:-d2] * wet * 0.7
    if d3 < n:
        l[d3:] += mono[:-d3] * wet * 0.4
        r[d3:] += mono[:-d3] * wet * 0.4
    return l, r

def save_mp3(left, right, fname):
    max_val = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-5)
    left = (left / max_val) * 0.94
    right = (right / max_val) * 0.94
    stereo = np.empty((len(left)*2,), dtype=np.int16)
    stereo[0::2] = np.clip(left * 32767, -32768, 32767).astype(np.int16)
    stereo[1::2] = np.clip(right * 32767, -32768, 32767).astype(np.int16)
    p = subprocess.Popen(['ffmpeg', '-y', '-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '2', '-i', '-', '-b:a', '192k', fname], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    p.communicate(stereo.tobytes())
    print('Saved:', fname)

# -------------------------------------------------------------
# 1. OPTION 2 PRIMARY: "B&W Victoria Oficial - 4s Recompuesta Natural"
# -------------------------------------------------------------
# Starts directly on beat 1 with Crash + Kick, playing the core B&W victory melody
# at a completely relaxed, groovy, natural tempo (132 BPM). No rushing!
def make_bw_core_hook_4s():
    total_sec = 4.0
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=1.8)
    
    # 132 BPM: 1 beat = 0.454s, half beat = 0.227s
    # Beat 1 (0.00s): Crash + Kick! Brass call: C5 -> E5 -> G5 -> C6!
    # Beat 3 (0.91s): B&W groove begins: E5 -> D5 -> C5 -> D5 -> E5 -> G5
    # Beat 6 (2.27s): Snare/clap + cadence into triumphant hold!
    # Beat 7 (2.95s): Final C6 chord + Crash, reverberating to 4.0s!
    
    # Crashes
    for ct in [0.00, 2.95]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.55
        
    # Kicks
    for kt in [0.00, 0.45, 0.91, 1.36, 1.82, 2.27, 2.72, 2.95]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.78
        
    # Snares
    for st in [0.45, 1.36, 2.27, 2.72, 2.95]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.68
        
    for ht in np.arange(0.227, 2.95, 0.227):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    # Slap Bass (Walking comfortably, plenty of groove)
    BASS = [
        (0.00, 'C3', 0.40),
        (0.45, 'G2', 0.40),
        (0.91, 'C3', 0.40),
        (1.36, 'E3', 0.40),
        (1.82, 'F2', 0.40),
        (2.27, 'G2', 0.40),
        (2.72, 'B2', 0.20),
        (2.95, 'C2', 1.05)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.72
        
    # Chords
    CHORDS = [
        (0.00, 0.85, ['C4', 'E4', 'G4']),
        (0.91, 0.85, ['C4', 'E4', 'G4']),
        (1.82, 0.45, ['F3', 'A3', 'C4']),
        (2.27, 0.65, ['G3', 'B3', 'D4', 'F4']),
        (2.95, 1.05, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    # Melody: Crisp, natural phrasing of the B&W victory theme
    MELODY = [
        # Call fanfare
        (0.00, 'C5', 0.22),
        (0.22, 'E5', 0.20),
        (0.45, 'G5', 0.22),
        (0.68, 'C6', 0.25),
        # Bouncy B&W hook
        (0.91, 'E5', 0.22),
        (1.14, 'D5', 0.22),
        (1.36, 'C5', 0.22),
        (1.59, 'D5', 0.22),
        (1.82, 'E5', 0.24),
        (2.05, 'G5', 0.35),
        # Triumph turnaround
        (2.45, 'A5', 0.15),
        (2.62, 'B5', 0.15),
        (2.78, 'D6', 0.16),
        # High final hit ringing out
        (2.95, 'C6', 1.05)
    ]
    for mt, note, dur in MELODY:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        lead = make_bw_synth_brass(f, dur)
        bell = make_bw_bell(f * 2.0, dur * 1.2) * 0.25
        min_l = min(len(lead), len(bell))
        lead_mix = lead[:min_l] + bell[:min_l]
        l = min(len(lead_mix), n - idx)
        if l > 0: mix[idx:idx+l] += lead_mix[:l] * 0.85
        
    left, right = add_stereo_reverb(mix, wet=0.28)
    save_mp3(left, right, 'Songs/BW_Win_Trainer_Battle_Theme.mp3')

# -------------------------------------------------------------
# 2. VARIATION B: "Fanfarria Ascendente Teselia (4.0s)"
# -------------------------------------------------------------
# Majestic ascending fanfare of B&W: G4-A4-B4 -> C5-E5-G5 -> C6 hold
def make_bw_fanfare_ascendente_4s():
    total_sec = 4.0
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    kick = make_bw_kick()
    snare = make_bw_snare()
    crash = make_bw_crash(dur=2.0)
    
    for ct in [0.75, 2.50]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.55
        
    for kt in [0.00, 0.75, 1.25, 1.75, 2.10, 2.50]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.78
        
    for st in [0.25, 0.50, 0.75, 1.50, 2.10, 2.50]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
        
    BASS = [
        (0.00, 'G2', 0.60),
        (0.75, 'C3', 0.50),
        (1.25, 'E3', 0.45),
        (1.75, 'G3', 0.40),
        (2.10, 'B2', 0.35),
        (2.50, 'C2', 1.50)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.72
        
    CHORDS = [
        (0.00, 0.70, ['G3', 'B3', 'D4']),
        (0.75, 0.95, ['C4', 'E4', 'G4']),
        (1.75, 0.70, ['G3', 'B3', 'D4', 'F4']),
        (2.50, 1.50, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    MELODY = [
        (0.00, 'G4', 0.20),
        (0.25, 'A4', 0.20),
        (0.50, 'B4', 0.22),
        (0.75, 'C5', 0.45),
        (1.25, 'E5', 0.35),
        (1.60, 'G5', 0.35),
        (1.95, 'B5', 0.25),
        (2.20, 'D6', 0.25),
        (2.50, 'C6', 1.50)
    ]
    for mt, note, dur in MELODY:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        lead = make_bw_synth_brass(f, dur)
        bell = make_bw_bell(f * 2.0, dur * 1.2) * 0.26
        min_l = min(len(lead), len(bell))
        lead_mix = lead[:min_l] + bell[:min_l]
        l = min(len(lead_mix), n - idx)
        if l > 0: mix[idx:idx+l] += lead_mix[:l] * 0.85
        
    left, right = add_stereo_reverb(mix, wet=0.30)
    save_mp3(left, right, 'Songs/BW_Win_Fanfare_Ascendente_4s.mp3')

if __name__ == '__main__':
    make_bw_core_hook_4s()
    make_bw_fanfare_ascendente_4s()
    print("Variations complete!")
