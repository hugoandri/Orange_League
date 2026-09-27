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
    # Click transient
    click = np.random.normal(0, 0.4, len(t)) * np.exp(-t * 80)
    return (0.8 * np.sin(phase) * env + click).astype(np.float32)

def make_bw_snare(dur=0.25):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    tone = np.sin(2 * np.pi * 180 * np.exp(-t * 12) * t) * np.exp(-t * 16)
    noise = np.random.normal(0, 0.45, len(t)) * np.exp(-t * 11)
    # Bandpass/highpass feel
    return (0.4 * tone + 0.6 * noise).astype(np.float32)

def make_bw_hihat(dur=0.06):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.35, len(t)) * np.exp(-t * 45)
    return noise.astype(np.float32)

def make_bw_crash(dur=1.8):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    noise = np.random.normal(0, 0.5, len(t)) * np.exp(-t * 2.8)
    return noise.astype(np.float32)

# -------------------------------------------------------------
# Gen V Synth Brass / Lead (Punchy dual saw/pulse with filter bite)
# -------------------------------------------------------------
def make_bw_synth_brass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    # Sawtooth
    saw = 2 * ((t * freq) % 1) - 1
    # Pulse (25% duty cycle)
    pulse = np.where((t * freq) % 1 < 0.25, 1.0, -1.0)
    # Mix
    raw = 0.6 * saw + 0.4 * pulse
    
    # Lowpass filter with envelope sweep
    rc = 1.0 / (2.0 * np.pi * (3200 + 1200 * np.exp(-t * 10)))
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    out = np.zeros_like(raw)
    y = 0.0
    for i in range(len(raw)):
        y = y + alpha[i] * (raw[i] - y)
        out[i] = y
        
    attack = int(0.012 * SAMPLE_RATE)
    decay = int(0.04 * SAMPLE_RATE)
    env = np.ones_like(t)
    if len(env) > attack: env[:attack] = np.linspace(0, 1, attack)
    if len(env) > decay: env[-decay:] = np.linspace(1, 0.001, decay)
    return (out * env).astype(np.float32)

# -------------------------------------------------------------
# Gen V Slap / Electric Bass (Bouncy staccato with sub & mid punch)
# -------------------------------------------------------------
def make_bw_bass(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    sub = np.sin(2 * np.pi * freq * t)
    harm = 0.45 * np.sin(4 * np.pi * freq * t) + 0.25 * np.sin(6 * np.pi * freq * t)
    # Slap click at onset
    click = np.random.normal(0, 0.3, len(t)) * np.exp(-t * 90)
    env = np.exp(-t * 6.5)
    return ((sub + harm) * env + click).astype(np.float32)

# -------------------------------------------------------------
# Gen V Electric Piano / Rhodes
# -------------------------------------------------------------
def make_bw_rhodes(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    # Soft bell-like harmonic profile
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.35 * np.sin(4 * np.pi * freq * t)
    s3 = 0.15 * np.sin(6 * np.pi * freq * t)
    tine = 0.2 * np.sin(14 * np.pi * freq * t) * np.exp(-t * 25)
    env = np.exp(-t * 3.5)
    return ((s1 + s2 + s3) * env + tine).astype(np.float32)

# -------------------------------------------------------------
# Gen V Sparkling Bell / Celesta Layer
# -------------------------------------------------------------
def make_bw_bell(freq, dur):
    t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.3 * np.sin(6 * np.pi * freq * t)
    env = np.exp(-t * 5.0)
    return ((s1 + s2) * env).astype(np.float32)

def add_stereo_reverb(mono, wet=0.25):
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
# MELODÍA EXACTA DE 06 WIN! EN TEMPO GEN V (140 BPM)
# =============================================================
# 06 Win! structure:
# Beat 1-2: A4 A4 F#4 A4 A4 (triplet/fanfare)
# Beat 3-4: C#5 B4 G4 B4
# Climax: C#5 D5 D5 C#5 B4 C#5 E5 A5!
WIN_MELODY_BW = [
    (0.00, 'A4', 0.13),
    (0.14, 'A4', 0.13),
    (0.28, 'F#4', 0.13),
    (0.42, 'A4', 0.13),
    (0.56, 'A4', 0.13),
    (0.70, 'C#5', 0.18),
    (0.90, 'B4', 0.18),
    (1.10, 'G4', 0.18),
    (1.30, 'B4', 0.18),
    (1.50, 'C#5', 0.18),
    (1.70, 'D5', 0.18),
    (1.90, 'D5', 0.18),
    (2.10, 'C#5', 0.18),
    (2.30, 'B4', 0.18),
    (2.50, 'C#5', 0.18),
    (2.70, 'E5', 0.25),
    (3.00, 'A5', 2.20) # Ringing high triumphant note
]

# Supporting electric piano chords (A, D, E, A)
WIN_CHORDS_BW = [
    (0.00, 0.65, ['A3', 'C#4', 'E4']),
    (0.70, 0.70, ['A3', 'C#4', 'E4']),
    (1.50, 0.55, ['D4', 'F#4', 'A4']),
    (2.10, 0.55, ['E4', 'G#4', 'B4']),
    (2.70, 2.50, ['A3', 'E4', 'A4', 'C#5', 'E5'])
]

# Bass groove (A -> D -> E -> A)
WIN_BASS_BW = [
    (0.00, 'A2', 0.20), (0.28, 'A2', 0.18), (0.56, 'E3', 0.18),
    (0.70, 'A2', 0.22), (1.10, 'A2', 0.22), (1.30, 'C#3', 0.18),
    (1.50, 'D3', 0.22), (1.90, 'A2', 0.18),
    (2.10, 'E3', 0.22), (2.50, 'B2', 0.18),
    (2.70, 'A2', 0.35), (3.00, 'A2', 2.20)
]

# =============================================================
# TRACK 1: POKÉMON BLACK & WHITE - 06 WIN! TRAINER BATTLE VICTORY
# =============================================================
def gen_bw_win_trainer_battle():
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    # 1. DRUMS (Gen V signature punchy groove)
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash()
    
    # Crash on beat 1 and climax
    if len(crash) < n:
        mix[:len(crash)] += crash * 0.45
    climax_idx = int(3.0 * SAMPLE_RATE)
    if climax_idx + len(crash) < n:
        mix[climax_idx:climax_idx+len(crash)] += crash * 0.5
        
    # Kicks on beats (0.0, 0.7, 1.5, 2.1, 2.7, 3.0)
    for kt in [0.0, 0.42, 0.70, 1.10, 1.50, 1.90, 2.10, 2.50, 2.70, 3.00]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.75
            
    # Snares on beats 2 & 4
    for st in [0.42, 1.10, 1.90, 2.50]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.65
            
    # Hi-hats 8th notes
    for ht in np.arange(0.0, 3.0, 0.214):
        idx = int(ht * SAMPLE_RATE)
        l = min(len(hat), n - idx)
        if l > 0: mix[idx:idx+l] += hat[:l] * 0.35
            
    # 2. BASS
    for bt, note, dur in WIN_BASS_BW:
        idx = int(bt * SAMPLE_RATE)
        f = n2f(note)
        b = make_bw_bass(f, dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.65
            
    # 3. ELECTRIC PIANO (RHODES)
    for ct, dur, chord in WIN_CHORDS_BW:
        idx = int(ct * SAMPLE_RATE)
        for note in chord:
            f = n2f(note)
            rh = make_bw_rhodes(f, dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.22
                
    # 4. LEAD SYNTH BRASS (Playing exact 06 Win! melody)
    for mt, note, dur in WIN_MELODY_BW:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        lead = make_bw_synth_brass(f, dur)
        # Bell layer on top
        bell = make_bw_bell(f * 2.0, dur * 1.2) * 0.25
        min_l = min(len(lead), len(bell))
        lead_mix = lead[:min_l] + bell[:min_l]
        l = min(len(lead_mix), n - idx)
        if l > 0: mix[idx:idx+l] += lead_mix[:l] * 0.85
            
    left, right = add_stereo_reverb(mix, wet=0.28)
    save_mp3(left, right, 'Songs/TCG_Win_Pokemon_Black_White.mp3')

# =============================================================
# TRACK 2: POKÉMON BLACK & WHITE - GYM LEADER CLIMAX STYLE
# =============================================================
def gen_bw_win_gym_climax():
    # Driving, energetic, faster bass arpeggio, brighter synth brass
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    crash = make_bw_crash()
    
    mix[:len(crash)] += crash * 0.5
    climax_idx = int(3.0 * SAMPLE_RATE)
    mix[climax_idx:climax_idx+len(crash)] += crash * 0.55
    
    # Four-on-the-floor driving kick
    for kt in np.arange(0.0, 3.2, 0.428):
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.8
            
    # Snare on offbeats
    for st in np.arange(0.428, 3.2, 0.428):
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.7
            
    # 16th note running bassline
    for bt, note, dur in WIN_BASS_BW:
        idx = int(bt * SAMPLE_RATE)
        f = n2f(note)
        b = make_bw_bass(f, dur)
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l] * 0.7
            
    # Melodic lead
    for mt, note, dur in WIN_MELODY_BW:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        lead = make_bw_synth_brass(f, dur)
        l = min(len(lead), n - idx)
        if l > 0: mix[idx:idx+l] += lead[:l] * 0.9
            
    left, right = add_stereo_reverb(mix, wet=0.30)
    save_mp3(left, right, 'Songs/TCG_Win_BW_Gym_Leader.mp3')

# =============================================================
# TRACK 3: POKÉMON BLACK & WHITE - CASTELIA CITY CHIME POP
# =============================================================
def gen_bw_win_chime_pop():
    # Joyful, bouncy, bell & electric piano driven
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    kick = make_bw_kick()
    snare = make_bw_snare()
    hat = make_bw_hihat()
    
    for kt in [0.0, 0.70, 1.50, 2.10, 2.70, 3.00]:
        idx = int(kt * SAMPLE_RATE)
        l = min(len(kick), n - idx)
        if l > 0: mix[idx:idx+l] += kick[:l] * 0.65
    for st in [0.42, 1.10, 1.90, 2.50]:
        idx = int(st * SAMPLE_RATE)
        l = min(len(snare), n - idx)
        if l > 0: mix[idx:idx+l] += snare[:l] * 0.55
        
    for bt, note, dur in WIN_BASS_BW:
        idx = int(bt * SAMPLE_RATE)
        f = n2f(note)
        b = make_bw_bass(f, dur) * 0.55
        l = min(len(b), n - idx)
        if l > 0: mix[idx:idx+l] += b[:l]
        
    for mt, note, dur in WIN_MELODY_BW:
        idx = int(mt * SAMPLE_RATE)
        f = n2f(note)
        bell = make_bw_bell(f * 2.0, dur * 1.5)
        rh = make_bw_rhodes(f, dur * 1.3) * 0.5
        min_l = min(len(bell), len(rh))
        pop_lead = bell[:min_l] + rh[:min_l]
        l = min(len(pop_lead), n - idx)
        if l > 0: mix[idx:idx+l] += pop_lead[:l] * 0.85
            
    left, right = add_stereo_reverb(mix, wet=0.35)
    save_mp3(left, right, 'Songs/TCG_Win_BW_Chime_Pop.mp3')

# =============================================================
# TRACK 4: POKÉMON BLACK & WHITE - OFFICIAL DEFEAT / BLACK OUT
# =============================================================
def gen_bw_loss_blackout():
    # The gentle, melancholic Pokémon Black & White blackout theme:
    # Soft music box / bell melody descending, electric piano chords, warm strings
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    mix = np.zeros(n, dtype=np.float32)
    
    # 08 Lost... melody played with BW music box & Rhodes
    LOST_MELODY = [
        (0.00, 'F5', 0.35),
        (0.36, 'C5', 0.32),
        (0.70, 'Bb4', 0.40),
        (1.15, 'Eb5', 0.35),
        (1.52, 'Bb4', 0.32),
        (1.86, 'Ab4', 0.45),
        (2.35, 'Db5', 0.35),
        (2.72, 'Ab4', 0.32),
        (3.06, 'F#4', 0.45),
        (3.55, 'G4', 0.38),
        (3.95, 'C5', 0.90),
        (4.90, 'G4', 0.35),
        (5.30, 'C4', 1.80)
    ]
    
    LOST_CHORDS = [
        (0.00, 1.10, ['F3', 'Ab3', 'C4']),
        (1.15, 1.15, ['Eb3', 'G3', 'Bb3']),
        (2.35, 1.15, ['Db3', 'F3', 'Ab3']),
        (3.55, 3.50, ['C3', 'Eb3', 'G3', 'C4'])
    ]
    
    # Soft music box bell melody
    for t_s, note, dur in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        bell = make_bw_bell(f, dur * 1.8)
        rh = make_bw_rhodes(f, dur * 1.5) * 0.4
        min_l = min(len(bell), len(rh))
        m = bell[:min_l] + rh[:min_l]
        l = min(len(m), n - idx)
        if l > 0: mix[idx:idx+l] += m[:l] * 0.85
            
    # Soft warm electric piano chords
    for t_s, dur, chord in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in chord:
            f = n2f(note)
            rh = make_bw_rhodes(f, dur)
            l = min(len(rh), n - idx)
            if l > 0: mix[idx:idx+l] += rh[:l] * 0.3
            
    left, right = add_stereo_reverb(mix, wet=0.42)
    save_mp3(left, right, 'Songs/TCG_Loss_Pokemon_Black_White.mp3')

if __name__ == '__main__':
    print("Generating Pokémon Black & White style tracks...")
    gen_bw_win_trainer_battle()
    gen_bw_win_gym_climax()
    gen_bw_win_chime_pop()
    gen_bw_loss_blackout()
    print("All Pokémon Black & White tracks created successfully!")
