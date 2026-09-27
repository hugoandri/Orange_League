import numpy as np
import subprocess
import os

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

# -------------------------------------------------------------
# Gen V / Nintendo DS Drum Elements
# -------------------------------------------------------------
def make_bw_kick(dur=0.22):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    freq = 150 * np.exp(-t * 24) + 45
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-t * 14)
    click = np.random.normal(0, 0.4, len(t)) * np.exp(-t * 80)
    return (0.8 * np.sin(phase) * env + click).astype(np.float32)

def make_bw_snare(dur=0.25):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    tone = np.sin(2 * np.pi * 180 * np.exp(-t * 12) * t) * np.exp(-t * 16)
    noise = np.random.normal(0, 0.45, len(t)) * np.exp(-t * 11)
    # Layered handclap snap
    clap_t = t[:int(0.06 * SAMPLE_RATE)]
    clap = np.random.normal(0, 0.35, len(clap_t)) * np.exp(-clap_t * 30)
    res = (0.35 * tone + 0.55 * noise)
    res[:len(clap)] += clap * 0.4
    return res.astype(np.float32)

def make_bw_hihat(dur=0.06):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 45)
    return noise.astype(np.float32)

def make_bw_crash(dur=2.0):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.5, len(t)) * np.exp(-t * 2.5)
    # Metallic tone shimmer
    shimmer = 0.15 * np.sin(2 * np.pi * 587.3 * t) * np.exp(-t * 3.0) + \
              0.15 * np.sin(2 * np.pi * 880.0 * t) * np.exp(-t * 2.8)
    return (noise + shimmer).astype(np.float32)

# -------------------------------------------------------------
# Gen V Synth Brass / Lead (Punchy dual saw/pulse with filter bite)
# -------------------------------------------------------------
def make_bw_synth_brass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    saw = 2 * ((t * freq) % 1) - 1
    pulse = np.where((t * freq) % 1 < 0.28, 1.0, -1.0)
    raw = 0.62 * saw + 0.38 * pulse
    
    # Lowpass filter with envelope sweep
    rc = 1.0 / (2.0 * np.pi * (3400 + 1500 * np.exp(-t * 12)))
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

# -------------------------------------------------------------
# Gen V Slap / Electric Bass
# -------------------------------------------------------------
def make_bw_bass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    sub = np.sin(2 * np.pi * freq * t)
    harm = 0.45 * np.sin(4 * np.pi * freq * t) + 0.25 * np.sin(6 * np.pi * freq * t)
    click = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 90)
    env = np.exp(-t * 6.5)
    return ((sub + harm) * env + click).astype(np.float32)

# -------------------------------------------------------------
# Gen V Electric Piano / Rhodes
# -------------------------------------------------------------
def make_bw_rhodes(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.35 * np.sin(4 * np.pi * freq * t)
    s3 = 0.15 * np.sin(6 * np.pi * freq * t)
    tine = 0.22 * np.sin(14 * np.pi * freq * t) * np.exp(-t * 25)
    env = np.exp(-t * 3.5)
    return ((s1 + s2 + s3) * env + tine).astype(np.float32)

# -------------------------------------------------------------
# Gen V Sparkling Bell / Celesta Layer
# -------------------------------------------------------------
def make_bw_bell(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.3 * np.sin(6 * np.pi * freq * t)
    env = np.exp(-t * 4.8)
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

# =============================================================
# TRACK 2: VICTORIA OFICIAL CONTRA ENTRENADOR (POKÉMON BLANCO & NEGRO)
# =============================================================
def gen_bw_official_trainer_victory():
    total_sec = 4.0
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=1.8)
    
    # Crashes: initial hit at 0.32s and final resolution at 2.75s
    for ct in [0.32, 2.75]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.55
        
    # Kicks
    for kt in [0.0, 0.32, 0.60, 0.94, 1.30, 1.58, 1.88, 2.03, 2.32, 2.56, 2.75]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.78
        
    # Snares & claps (snappy roll + backbeats)
    for st in [0.08, 0.16, 0.24, 0.60, 1.44, 2.03, 2.44, 2.75]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
        
    # Hi-hats
    for ht in np.arange(0.32, 2.75, 0.16):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    # Slap Bass
    BASS = [
        (0.00, 'G2', 0.15), (0.16, 'G2', 0.14),
        (0.32, 'C3', 0.25), (0.60, 'G2', 0.18), (0.76, 'C3', 0.16), (0.94, 'E3', 0.22),
        (1.30, 'C3', 0.22), (1.58, 'F2', 0.22), (1.88, 'G2', 0.20), (2.03, 'D3', 0.20),
        (2.32, 'E2', 0.16), (2.44, 'G2', 0.14), (2.56, 'B2', 0.16),
        (2.75, 'C2', 1.25)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.72
        
    # Rhodes chords
    CHORDS = [
        (0.00, 0.30, ['G3', 'B3', 'D4']),
        (0.32, 0.90, ['C4', 'E4', 'G4']),
        (1.30, 0.55, ['C4', 'E4', 'G4']),
        (1.88, 0.40, ['F3', 'A3', 'C4']),
        (2.32, 0.40, ['G3', 'B3', 'D4', 'F4']),
        (2.75, 1.25, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    # Lead Melody: Official Pokémon Black & White Trainer Victory in tight 4.0s arrangement
    MELODY = [
        # Intro ascending flourish
        (0.00, 'G4', 0.075),
        (0.08, 'G4', 0.075),
        (0.16, 'A4', 0.075),
        (0.24, 'B4', 0.075),
        (0.32, 'C5', 0.26),
        (0.60, 'E5', 0.15),
        (0.76, 'G5', 0.16),
        (0.94, 'C6', 0.30),
        # Phrase: Bouncy Gen V signature motif
        (1.30, 'E5', 0.13),
        (1.44, 'D5', 0.13),
        (1.58, 'C5', 0.14),
        (1.73, 'D5', 0.14),
        (1.88, 'E5', 0.14),
        (2.03, 'G5', 0.26),
        # Rapid cadence stabs into high victorious C6
        (2.32, 'G4', 0.10),
        (2.44, 'C5', 0.10),
        (2.56, 'E5', 0.12),
        (2.68, 'G5', 0.14),
        (2.75, 'C6', 1.25)
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

# =============================================================
# TRACK 3: FANFARRIA UNIVERSAL POKÉMON (CLÁSICO EN BLANCO & NEGRO)
# =============================================================
def gen_bw_classic_universal_victory():
    total_sec = 8.0
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=2.2)
    
    # Crashes
    for ct in [0.99, 5.70]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.55
        
    # Kicks
    for kt in [0.0, 0.33, 0.99, 1.44, 1.76, 2.28, 2.50, 2.94, 3.24, 3.76, 3.98, 4.42, 4.70, 5.14, 5.36, 5.70]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.75
        
    # Snares
    for st in [0.55, 1.44, 2.05, 2.94, 3.53, 4.42, 4.92, 5.36]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
        
    # Hi-hats
    for ht in np.arange(0.99, 5.70, 0.22):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    # Bass
    BASS = [
        (0.00, 'G2', 0.20), (0.33, 'G2', 0.25), (0.77, 'B2', 0.20),
        (0.99, 'C3', 0.40), (1.44, 'G2', 0.30),
        (1.76, 'C3', 0.30), (2.05, 'G2', 0.20), (2.28, 'E3', 0.20), (2.50, 'G3', 0.35),
        (2.94, 'G2', 0.28), (3.24, 'D3', 0.28), (3.53, 'G2', 0.20), (3.76, 'B2', 0.20), (3.98, 'C3', 0.35),
        (4.42, 'C3', 0.25), (4.70, 'D3', 0.20), (4.92, 'E3', 0.20), (5.14, 'F3', 0.20), (5.36, 'G3', 0.28),
        (5.70, 'C2', 2.20)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.70
        
    # Chords
    CHORDS = [
        (0.00, 0.90, ['G3', 'B3', 'D4']),
        (0.99, 0.75, ['C4', 'E4', 'G4']),
        (1.76, 1.10, ['C4', 'E4', 'G4']),
        (2.94, 1.00, ['G3', 'B3', 'D4']),
        (3.98, 0.70, ['C4', 'E4', 'G4']),
        (4.70, 0.95, ['G3', 'B3', 'D4', 'F4']),
        (5.70, 2.20, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    # Melody: Iconic Universal Pokémon Victory
    MELODY = [
        (0.00, 'G4', 0.09),
        (0.11, 'G4', 0.09),
        (0.22, 'G4', 0.09),
        (0.33, 'G4', 0.18),
        (0.55, 'A4', 0.18),
        (0.77, 'B4', 0.20),
        (0.99, 'C5', 0.42),
        (1.44, 'G4', 0.28),
        # Main Theme
        (1.76, 'E5', 0.25),
        (2.05, 'D5', 0.20),
        (2.28, 'C5', 0.20),
        (2.50, 'D5', 0.38),
        (2.94, 'G4', 0.28),
        (3.24, 'F5', 0.25),
        (3.53, 'E5', 0.20),
        (3.76, 'D5', 0.20),
        (3.98, 'E5', 0.38),
        (4.42, 'C5', 0.25),
        # Finale
        (4.70, 'D5', 0.18),
        (4.92, 'E5', 0.18),
        (5.14, 'F5', 0.20),
        (5.36, 'G5', 0.28),
        (5.70, 'C6', 2.20)
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
        
    left, right = add_stereo_reverb(mix, wet=0.30)
    save_mp3(left, right, 'Songs/Classic_Win_Pokemon_BW_Style.mp3')

# =============================================================
# TRACK 4: VICTORIA LÍDER DE GIMNASIO (TESELIA / BLANCO & NEGRO)
# =============================================================
def gen_bw_gym_leader_victory():
    total_sec = 7.6
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=2.4)
    
    for ct in [0.42, 5.15]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.58
        
    for kt in [0.0, 0.42, 0.90, 1.30, 1.52, 1.95, 2.37, 2.85, 3.25, 3.47, 3.90, 4.26, 4.75, 5.15]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.80
        
    for st in [0.42, 1.10, 1.52, 2.37, 3.05, 3.47, 4.08, 4.50, 5.15]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.70
        
    for ht in np.arange(0.42, 5.15, 0.21):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    # Bass in D Major
    BASS = [
        (0.00, 'D2', 0.20), (0.28, 'A2', 0.15),
        (0.42, 'D3', 0.45), (0.90, 'A2', 0.25), (1.10, 'F#2', 0.20), (1.30, 'G2', 0.20), (1.52, 'A2', 0.35),
        (1.95, 'E2', 0.40), (2.37, 'E3', 0.45), (2.85, 'B2', 0.25), (3.05, 'G#2', 0.20), (3.25, 'A2', 0.20), (3.47, 'C#3', 0.35),
        (3.90, 'D3', 0.30), (4.26, 'E3', 0.30), (4.50, 'F#3', 0.25), (4.75, 'A2', 0.35),
        (5.15, 'D2', 2.30)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.72
        
    CHORDS = [
        (0.42, 1.45, ['D4', 'F#4', 'A4']),
        (1.95, 1.45, ['E4', 'G4', 'B4']),
        (3.90, 1.20, ['G3', 'B3', 'D4', 'A4']),
        (5.15, 2.30, ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    # Melody
    MELODY = [
        (0.00, 'D4', 0.12), (0.14, 'F#4', 0.12), (0.28, 'A4', 0.12), (0.42, 'D5', 0.42),
        (0.90, 'C#5', 0.18), (1.10, 'B4', 0.18), (1.30, 'A4', 0.20), (1.52, 'B4', 0.38),
        (1.95, 'E4', 0.12), (2.09, 'G4', 0.12), (2.23, 'B4', 0.12), (2.37, 'E5', 0.42),
        (2.85, 'D5', 0.18), (3.05, 'C#5', 0.18), (3.25, 'B4', 0.20), (3.47, 'C#5', 0.38),
        (3.90, 'D5', 0.15), (4.08, 'E5', 0.15), (4.26, 'F#5', 0.20), (4.50, 'G5', 0.20), (4.75, 'A5', 0.35),
        (5.15, 'D6', 2.30)
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
        
    left, right = add_stereo_reverb(mix, wet=0.30)
    save_mp3(left, right, 'Songs/BW_Win_Gym_Leader_Defeated.mp3')

# =============================================================
# TRACK 5: HALL DE LA FAMA / CAMPEÓN DE LA LIGA (BLANCO & NEGRO)
# =============================================================
def gen_bw_champion_victory():
    total_sec = 8.8
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=2.6)
    
    for ct in [0.80, 6.35]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.60
        
    for kt in [0.0, 0.48, 0.80, 1.20, 1.70, 2.15, 2.55, 3.05, 3.45, 3.85, 4.35, 4.80, 5.25, 5.75, 6.00, 6.35]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.75
        
    for st in [0.80, 1.70, 2.55, 3.45, 4.35, 5.25, 6.00, 6.35]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
        
    for ht in np.arange(0.80, 6.35, 0.24):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    BASS = [
        (0.00, 'C2', 0.40), (0.48, 'G2', 0.30),
        (0.80, 'C3', 0.40), (1.20, 'G2', 0.45), (1.70, 'F2', 0.40), (2.15, 'G2', 0.35),
        (2.55, 'A2', 0.45), (3.05, 'F2', 0.35), (3.45, 'D3', 0.35), (3.85, 'G2', 0.45),
        (4.35, 'C3', 0.40), (4.80, 'G2', 0.40), (5.25, 'C3', 0.45), (5.75, 'D3', 0.22), (6.00, 'G2', 0.30),
        (6.35, 'C2', 2.40)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.70
        
    CHORDS = [
        (0.80, 1.65, ['C4', 'E4', 'G4']),
        (2.55, 1.25, ['F3', 'A3', 'C4']),
        (3.85, 1.35, ['G3', 'B3', 'D4', 'F4']),
        (5.25, 1.05, ['C4', 'E4', 'G4']),
        (6.35, 2.40, ['C3', 'G3', 'C4', 'E4', 'G4', 'C5'])
    ]
    for ct, dur, chord in CHORDS:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            rh = make_bw_rhodes(n2f(note), dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
            
    MELODY = [
        (0.00, 'C4', 0.20), (0.24, 'G4', 0.20), (0.48, 'C5', 0.30), (0.80, 'E5', 0.38),
        (1.20, 'G5', 0.45), (1.70, 'F5', 0.20), (1.92, 'E5', 0.20), (2.15, 'D5', 0.38),
        (2.55, 'E5', 0.22), (2.80, 'F5', 0.22), (3.05, 'G5', 0.35), (3.45, 'A5', 0.35),
        (3.85, 'G5', 0.45), (4.35, 'F5', 0.20), (4.58, 'E5', 0.20), (4.80, 'D5', 0.42),
        (5.25, 'C5', 0.22), (5.50, 'D5', 0.22), (5.75, 'E5', 0.22), (6.00, 'G5', 0.32),
        (6.35, 'C6', 2.30)
    ]
    for mt, note, dur in MELODY:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        lead = make_bw_synth_brass(f, dur)
        bell = make_bw_bell(f * 2.0, dur * 1.2) * 0.28
        min_l = min(len(lead), len(bell))
        lead_mix = lead[:min_l] + bell[:min_l]
        l = min(len(lead_mix), n - idx)
        if l > 0: mix[idx:idx+l] += lead_mix[:l] * 0.85
        
    left, right = add_stereo_reverb(mix, wet=0.32)
    save_mp3(left, right, 'Songs/BW_Win_Champion_Hall_of_Fame.mp3')

# =============================================================
# TRACK 6: TORNEO MASTER TCG (GRAN FINAL BLANCO & NEGRO)
# =============================================================
def gen_bw_tournament_master():
    total_sec = 6.4
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash(dur=2.2)
    
    # Driving funk tournament beat
    for ct in [0.0, 4.30]:
        idx = int(ct * SAMPLE_RATE)
        l = min(len(crash), n - idx)
        if l > 0: mix[idx:idx+l] += crash[:l] * 0.55
        
    for kt in np.arange(0.0, 4.4, 0.42):
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.75
        
    for st in np.arange(0.42, 4.4, 0.42):
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
        
    for ht in np.arange(0.0, 4.4, 0.21):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
        
    # Energetic slap bass
    BASS = [
        (0.00, 'A2', 0.20), (0.21, 'A2', 0.18), (0.42, 'E3', 0.20),
        (0.84, 'A2', 0.25), (1.26, 'C#3', 0.20), (1.47, 'E3', 0.20), (1.68, 'F#3', 0.25),
        (2.10, 'D3', 0.25), (2.52, 'A2', 0.20), (2.94, 'E3', 0.25), (3.36, 'B2', 0.20),
        (3.78, 'A2', 0.25), (4.00, 'E3', 0.25), (4.30, 'A2', 2.00)
    ]
    for bt, note, dur in BASS:
        idx = int(bt * SAMPLE_RATE)
        b = make_bw_bass(n2f(note), dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.72
        
    MELODY = [
        # Catchy tournament fanfare
        (0.00, 'A4', 0.18), (0.21, 'C#5', 0.18), (0.42, 'E5', 0.35),
        (0.84, 'E5', 0.18), (1.05, 'F#5', 0.18), (1.26, 'G#5', 0.18), (1.47, 'A5', 0.20), (1.68, 'B5', 0.25),
        (2.10, 'C#6', 0.35), (2.52, 'B5', 0.20), (2.73, 'A5', 0.20), (2.94, 'F#5', 0.20),
        (3.36, 'E5', 0.20), (3.57, 'F#5', 0.18), (3.78, 'G#5', 0.20), (4.00, 'B5', 0.25),
        (4.30, 'A5', 1.90)
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
    save_mp3(left, right, 'Songs/BW_Win_Tournament_Master.mp3')

if __name__ == '__main__':
    print("Generating new Pokémon Victory Melodies in B&W Gen V style...")
    gen_bw_official_trainer_victory()
    gen_bw_classic_universal_victory()
    gen_bw_gym_leader_victory()
    gen_bw_champion_victory()
    gen_bw_tournament_master()
    print("All new Victory Melodies generated successfully!")
