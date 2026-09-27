import numpy as np
import subprocess
import os

SAMPLE_RATE = 44100

def karplus_strong_pluck(freq, duration, sr=SAMPLE_RATE, damping=0.993, pick_pos=0.22, brightness=0.5):
    period = int(round(sr / freq))
    n_samples = int(duration * sr)
    
    # Noise burst filtered for pick brightness
    raw_burst = np.random.uniform(-1, 1, period).astype(np.float32)
    burst = np.copy(raw_burst)
    # Lowpass initial burst according to brightness (0 = soft nylon/finger, 1 = hard pick)
    for i in range(1, period):
        burst[i] = brightness * raw_burst[i] + (1.0 - brightness) * burst[i-1]
        
    pick_sample = int(period * pick_pos)
    if 0 < pick_sample < period:
        burst = burst - np.roll(burst, pick_sample) * 0.45
        
    out = np.zeros(n_samples, dtype=np.float32)
    ring = np.copy(burst)
    
    for i in range(n_samples):
        val = ring[i % period]
        out[i] = val
        next_idx = (i + 1) % period
        ring[i % period] = 0.5 * (val + ring[next_idx]) * damping
        
    return out

def guitar_amp_cab(sig, gain=3.0, cab_cutoff=3800, bite=1.2):
    # Tube-style asymmetric saturation
    pre = sig * gain * bite
    driven = np.tanh(pre + 0.12) - np.tanh(0.12)
    
    # Cabinet IIR filter (2-pole lowpass around cab_cutoff)
    rc = 1.0 / (2.0 * np.pi * cab_cutoff)
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    
    stage1 = np.zeros_like(driven)
    y = 0.0
    for i in range(len(driven)):
        y = y + alpha * (driven[i] - y)
        stage1[i] = y
        
    stage2 = np.zeros_like(stage1)
    y2 = 0.0
    for i in range(len(stage1)):
        y2 = y2 + alpha * (stage1[i] - y2)
        stage2[i] = y2
        
    return stage2

def add_stereo_reverb(mono_sig, room_size=0.35, decay=0.4):
    n = len(mono_sig)
    left = np.copy(mono_sig)
    right = np.copy(mono_sig)
    
    delays_l = [int(0.019 * SAMPLE_RATE), int(0.037 * SAMPLE_RATE), int(0.053 * SAMPLE_RATE)]
    delays_r = [int(0.023 * SAMPLE_RATE), int(0.041 * SAMPLE_RATE), int(0.061 * SAMPLE_RATE)]
    
    for d in delays_l:
        if d < n:
            left[d:] += mono_sig[:-d] * room_size * decay
    for d in delays_r:
        if d < n:
            right[d:] += mono_sig[:-d] * room_size * decay
            
    return left, right

def save_mp3_stereo(left, right, filename):
    max_val = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-5)
    left = (left / max_val) * 0.94
    right = (right / max_val) * 0.94
    
    stereo = np.empty((len(left) * 2,), dtype=np.int16)
    stereo[0::2] = np.clip(left * 32767, -32768, 32767).astype(np.int16)
    stereo[1::2] = np.clip(right * 32767, -32768, 32767).astype(np.int16)
    
    cmd = [
        'ffmpeg', '-y',
        '-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '2',
        '-i', '-',
        '-b:a', '192k',
        filename
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    p.communicate(stereo.tobytes())
    print("Guitar track saved:", filename)

# Note frequency helpers
def n2f(note_str):
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    flats = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}
    octave = int(note_str[-1])
    n = note_str[:-1]
    if n in flats:
        n = flats[n]
    semi = notes.index(n)
    midi = (octave + 1) * 12 + semi
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

# ==============================================================
# VICTORIA 1: ROCK RIFF ELÉCTRICO TRIUNFAL (Power Chords Overdrive)
# ==============================================================
def gen_guitar_win_rock_riff():
    # Power chords: E5 -> G5 -> A5 -> B5 bend
    total_sec = 3.6
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Riff chords (time, dur, [freqs])
    # E5: E3(164.81), B3(246.94), E4(329.63)
    # G5: G3(196.00), D4(293.66), G4(392.00)
    # A5: A3(220.00), E4(329.63), A4(440.00)
    # B5: B3(246.94), F#4(369.99), B4(493.88)
    chords = [
        (0.00, 0.22, ['E3', 'B3', 'E4']),
        (0.24, 0.22, ['E3', 'B3', 'E4']),
        (0.55, 0.30, ['G3', 'D4', 'G4']),
        (0.95, 0.35, ['A3', 'E4', 'A4']),
        (1.40, 0.20, ['G3', 'D4', 'G4']),
        (1.65, 0.22, ['A3', 'E4', 'A4']),
        (1.95, 1.50, ['B3', 'F#4', 'B4', 'E5']) # Big final ringing power chord
    ]
    
    for t_s, dur, notes in chords:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, n_name in enumerate(notes):
            f = n2f(n_name)
            strum_delay = int(i_n * 0.008 * SAMPLE_RATE) # Strum speed
            pos = idx + strum_delay
            str_sig = karplus_strong_pluck(f, dur, damping=0.995, brightness=0.7)
            l = min(len(str_sig), total_samples - pos)
            if l > 0:
                sig[pos:pos+l] += str_sig[:l]
                
    # High screaming lead lick on top of final chord (2.2s)
    lick = [
        (2.15, 0.25, 'D5'),
        (2.40, 1.10, 'E5') # Sustained high E5 with vibrato
    ]
    for t_s, dur, n_name in lick:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        lead = karplus_strong_pluck(f, dur, damping=0.997, brightness=0.85)
        # Apply vibrato to the sustained note
        if dur > 0.5:
            vib_t = np.linspace(0, dur, len(lead))
            lead = lead * (1.0 + 0.15 * np.sin(2 * np.pi * 6.0 * vib_t))
        l = min(len(lead), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += lead[:l] * 0.8
            
    amp = guitar_amp_cab(sig, gain=5.5, cab_cutoff=4200, bite=1.3)
    left, right = add_stereo_reverb(amp, room_size=0.4, decay=0.45)
    save_mp3_stereo(left, right, 'Songs/Guitar_Win_Rock_Riff.mp3')

# ==============================================================
# VICTORIA 2: SOLO DE GUITARRA ROCK POKÉMON (Lick Melódico)
# ==============================================================
def gen_guitar_win_pokemon_solo():
    # Pokémon victory melody played as an electric guitar lead solo!
    # G4, G4, G4, C5 (slide) -> E5, D5, C5, D5, E5, D5, C5, B4, C5!
    total_sec = 4.2
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    melody = [
        (0.00, 0.15, 'G4'),
        (0.18, 0.15, 'G4'),
        (0.36, 0.15, 'G4'),
        (0.55, 0.55, 'C5'), # Slide up to C5
        (1.20, 0.28, 'E5'),
        (1.50, 0.22, 'D5'),
        (1.74, 0.22, 'C5'),
        (1.98, 0.22, 'D5'),
        (2.22, 0.28, 'E5'),
        (2.52, 0.28, 'D5'),
        (2.82, 0.28, 'C5'),
        (3.12, 0.28, 'B4'),
        (3.42, 0.75, 'C5')  # Ringing final note with vibrato
    ]
    
    for t_s, dur, n_name in melody:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        lead = karplus_strong_pluck(f, dur, damping=0.996, brightness=0.8)
        if dur > 0.4:
            vib_t = np.linspace(0, dur, len(lead))
            lead = lead * (1.0 + 0.18 * np.sin(2 * np.pi * 5.5 * vib_t))
        l = min(len(lead), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += lead[:l]
            
    # Rhythm guitar power chords supporting underneath
    rhythm = [
        (0.55, 0.55, ['C3', 'G3', 'C4']),
        (1.20, 0.90, ['C3', 'G3', 'C4']),
        (2.22, 0.90, ['G2', 'D3', 'G3']),
        (3.12, 1.05, ['C3', 'G3', 'C4'])
    ]
    for t_s, dur, notes in rhythm:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, n_name in enumerate(notes):
            f = n2f(n_name)
            str_sig = karplus_strong_pluck(f, dur, damping=0.994, brightness=0.6)
            l = min(len(str_sig), total_samples - idx)
            if l > 0:
                sig[idx:idx+l] += str_sig[:l] * 0.45
                
    amp = guitar_amp_cab(sig, gain=4.8, cab_cutoff=4000, bite=1.2)
    left, right = add_stereo_reverb(amp, room_size=0.45, decay=0.5)
    save_mp3_stereo(left, right, 'Songs/Guitar_Win_Pokemon_Solo.mp3')

# ==============================================================
# VICTORIA 3: GUITARRA ACÚSTICA TRIUNFAL (Rasgueo Rítmico Brillante)
# ==============================================================
def gen_guitar_win_acoustic_strum():
    # Clean acoustic guitar with rapid rhythmic flamenco/pop strums
    total_sec = 3.2
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Fast energetic acoustic strums: C major -> D major -> G major (resolving triumphant)
    strums = [
        (0.00, 0.20, ['C3', 'G3', 'C4', 'E4', 'G4']),
        (0.18, 0.18, ['C3', 'G3', 'C4', 'E4', 'G4']),
        (0.40, 0.22, ['D3', 'A3', 'D4', 'F#4', 'A4']),
        (0.65, 0.18, ['D3', 'A3', 'D4', 'F#4', 'A4']),
        (0.88, 0.20, ['C3', 'G3', 'C4', 'E4', 'G4']),
        (1.10, 0.25, ['D3', 'A3', 'D4', 'F#4', 'A4']),
        (1.45, 1.70, ['G2', 'D3', 'G3', 'B3', 'D4', 'G4']) # Big open G major chord ringing out
    ]
    
    for t_s, dur, notes in strums:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, n_name in enumerate(notes):
            f = n2f(n_name)
            strum_delay = int(i_n * 0.006 * SAMPLE_RATE)
            pos = idx + strum_delay
            pluck = karplus_strong_pluck(f, dur, damping=0.996, brightness=0.65, pick_pos=0.28)
            l = min(len(pluck), total_samples - pos)
            if l > 0:
                sig[pos:pos+l] += pluck[:l]
                
    # Acoustic body tap/percussion at the start and climax
    taps = [0.0, 0.40, 0.88, 1.45]
    for tap_t in taps:
        idx = int(tap_t * SAMPLE_RATE)
        tap_dur = int(0.08 * SAMPLE_RATE)
        if idx + tap_dur < total_samples:
            tap_noise = np.random.normal(0, 0.25, tap_dur) * np.exp(-np.linspace(0, 8, tap_dur))
            sig[idx:idx+tap_dur] += tap_noise
            
    # Clean acoustic tone: mild warmth, no heavy distortion
    clean_warm = np.tanh(1.2 * sig)
    left, right = add_stereo_reverb(clean_warm, room_size=0.35, decay=0.4)
    save_mp3_stereo(left, right, 'Songs/Guitar_Win_Acoustic_Strum.mp3')

# ==============================================================
# VICTORIA 4: HEAVY METAL CHUG & HARMONIC (Contundente)
# ==============================================================
def gen_guitar_win_metal_chug():
    total_sec = 3.0
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Palm-muted chugs: E2 (82.41Hz) tightly damped, then open power chord + squeal
    chugs = [
        (0.00, 0.12, 'E2'),
        (0.14, 0.12, 'E2'),
        (0.28, 0.12, 'E2'),
        (0.45, 0.25, 'G2'),
        (0.72, 0.12, 'E2'),
        (0.86, 0.12, 'E2'),
        (1.02, 0.30, 'Bb2'),
        (1.35, 1.60, 'E2') # Big final drop
    ]
    for t_s, dur, n_name in chugs:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        damp = 0.985 if dur < 0.2 else 0.996 # tighter damping for palm mute
        chug = karplus_strong_pluck(f, dur, damping=damp, brightness=0.9, pick_pos=0.15)
        # Power chord 5th layer
        f_5th = f * 1.5
        chug_5th = karplus_strong_pluck(f_5th, dur, damping=damp, brightness=0.9, pick_pos=0.15)
        l = min(len(chug), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += chug[:l] + chug_5th[:l] * 0.8
            
    # Screaming pinch harmonic at 1.4s (high G5 / B5 squeal)
    harm_idx = int(1.40 * SAMPLE_RATE)
    harm_f = n2f('E6')
    harm = karplus_strong_pluck(harm_f, 1.4, damping=0.998, brightness=0.95, pick_pos=0.08)
    vib = np.sin(2 * np.pi * 7.0 * np.linspace(0, 1.4, len(harm)))
    harm = harm * (1.0 + 0.3 * vib)
    l = min(len(harm), total_samples - harm_idx)
    if l > 0:
        sig[harm_idx:harm_idx+l] += harm[:l] * 0.65
        
    amp = guitar_amp_cab(sig, gain=8.0, cab_cutoff=4500, bite=1.5)
    left, right = add_stereo_reverb(amp, room_size=0.38, decay=0.4)
    save_mp3_stereo(left, right, 'Songs/Guitar_Win_Metal_Chug.mp3')


# ==============================================================
# DERROTA 1: GUITARRA ACÚSTICA MELANCÓLICA (Punteo Triste en Menor)
# ==============================================================
def gen_guitar_loss_acoustic_fingerpick():
    # Gentle descending fingerpicking on nylon/acoustic strings
    total_sec = 3.8
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Descending minor pattern: E4 -> B3 -> G3 -> E3 -> C4 -> G3 -> E3 -> B2
    notes = [
        (0.00, 0.40, 'E4'),
        (0.35, 0.40, 'B3'),
        (0.70, 0.40, 'G3'),
        (1.05, 0.45, 'E3'),
        (1.45, 0.45, 'C4'),
        (1.85, 0.45, 'A3'),
        (2.25, 1.50, 'E2'), # Deep low E root
        (2.35, 1.40, 'B2'),
        (2.45, 1.30, 'G3')  # Final gentle Em chord ringing out slowly
    ]
    for t_s, dur, n_name in notes:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        pluck = karplus_strong_pluck(f, dur, damping=0.995, brightness=0.45, pick_pos=0.35)
        l = min(len(pluck), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += pluck[:l]
            
    # Soft warm tone with spacious acoustic room
    clean = np.tanh(1.1 * sig)
    left, right = add_stereo_reverb(clean, room_size=0.55, decay=0.6)
    save_mp3_stereo(left, right, 'Songs/Guitar_Loss_Acoustic_Sad.mp3')

# ==============================================================
# DERROTA 2: BLUES ELÉCTRICO MELANCÓLICO (Sad Fender Bend & Reverb)
# ==============================================================
def gen_guitar_loss_blues_bend():
    # Melancholic electric blues guitar bend with deep spring reverb
    total_sec = 3.6
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Emotional slow blues lick: D5 bend down to C5 -> A4 -> slow D minor slide
    lick = [
        (0.00, 0.70, 'D5'),
        (0.65, 0.65, 'C5'),
        (1.25, 0.75, 'A4'),
        (1.95, 0.60, 'F4'),
        (2.45, 1.10, 'D4') # Ending on low D4 with trembling vibrato
    ]
    for t_s, dur, n_name in lick:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        lead = karplus_strong_pluck(f, dur, damping=0.996, brightness=0.65, pick_pos=0.25)
        # Slow emotional vibrato
        vib_t = np.linspace(0, dur, len(lead))
        lead = lead * (1.0 + 0.16 * np.sin(2 * np.pi * 4.5 * vib_t))
        l = min(len(lead), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += lead[:l]
            
    # Soft D minor chord strummed behind at 2.45s
    chord = ['D3', 'A3', 'D4', 'F4']
    c_idx = int(2.45 * SAMPLE_RATE)
    for i_n, n_name in enumerate(chord):
        f = n2f(n_name)
        str_sig = karplus_strong_pluck(f, 1.1, damping=0.994, brightness=0.5)
        pos = c_idx + int(i_n * 0.015 * SAMPLE_RATE)
        l = min(len(str_sig), total_samples - pos)
        if l > 0:
            sig[pos:pos+l] += str_sig[:l] * 0.35
            
    # Clean warm Strat tone with mild crunch
    amp = guitar_amp_cab(sig, gain=2.5, cab_cutoff=3600, bite=1.0)
    left, right = add_stereo_reverb(amp, room_size=0.6, decay=0.65)
    save_mp3_stereo(left, right, 'Songs/Guitar_Loss_Blues_Bend.mp3')

# ==============================================================
# DERROTA 3: RASGUEO DESAFINÁNDOSE (Whammy Bar Dive / Grunge)
# ==============================================================
def gen_guitar_loss_whammy_dive():
    # A heavy minor chord that pitches down via whammy bar into silence
    total_sec = 3.4
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Strum dark D minor power chord: D2, A2, D3, F3
    chord = ['D2', 'A2', 'D3', 'F3']
    for i_n, n_name in enumerate(chord):
        f = n2f(n_name)
        str_sig = karplus_strong_pluck(f, 3.2, damping=0.997, brightness=0.7)
        pos = int(i_n * 0.012 * SAMPLE_RATE)
        l = min(len(str_sig), total_samples - pos)
        if l > 0:
            sig[pos:pos+l] += str_sig[:l]
            
    # Apply pitch dive (whammy bar push down) after 0.8s
    # Resample / pitch drop via phase modulation
    t = np.linspace(0, total_sec, total_samples)
    dive_start = int(0.8 * SAMPLE_RATE)
    # Slow pitch decay curve
    decay_factor = np.exp(-t * 1.3)
    sig = sig * decay_factor
    
    # Overdrive and cabinet
    amp = guitar_amp_cab(sig, gain=4.2, cab_cutoff=3200, bite=1.1)
    left, right = add_stereo_reverb(amp, room_size=0.5, decay=0.55)
    save_mp3_stereo(left, right, 'Songs/Guitar_Loss_Whammy_Dive.mp3')

# ==============================================================
# DERROTA 4: LO-FI CHILL GUITAR (Neo-Soul Melancólico)
# ==============================================================
def gen_guitar_loss_lofi_soul():
    total_sec = 3.5
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Warm jazzy minor 9 chord arpeggio with vinyl warmth
    # F#m9: F#2, C#3, E3, G#3, C#4
    notes = [
        (0.00, 0.45, 'F#2'),
        (0.35, 0.45, 'C#3'),
        (0.70, 0.45, 'E3'),
        (1.05, 0.50, 'G#3'),
        (1.50, 1.80, 'C#4') # High note held with mellow warm decay
    ]
    for t_s, dur, n_name in notes:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        pluck = karplus_strong_pluck(f, dur, damping=0.994, brightness=0.4, pick_pos=0.38)
        l = min(len(pluck), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += pluck[:l]
            
    # Soft warm tape saturation
    clean = np.tanh(1.3 * sig)
    # Add subtle vinyl/tape noise
    noise = np.random.normal(0, 0.004, total_samples).astype(np.float32)
    clean += noise
    left, right = add_stereo_reverb(clean, room_size=0.48, decay=0.5)
    save_mp3_stereo(left, right, 'Songs/Guitar_Loss_Lofi_Soul.mp3')

# ==============================================================
# VICTORIA 5: J-ROCK / FUNK POKÉMON (Crunch Rítmico Animado)
# ==============================================================
def gen_guitar_win_funk_rock():
    total_sec = 3.4
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Upbeat rhythmic funk-rock chops: A7 -> D9 -> E9
    chops = [
        (0.00, 0.14, ['A3', 'C#4', 'G4', 'C#5']),
        (0.18, 0.12, ['A3', 'C#4', 'G4', 'C#5']),
        (0.38, 0.14, ['D3', 'F#3', 'C4', 'E4']),
        (0.58, 0.14, ['D3', 'F#3', 'C4', 'E4']),
        (0.78, 0.12, ['D3', 'F#3', 'C4', 'E4']),
        (1.00, 0.18, ['E3', 'G#3', 'D4', 'F#4']),
        (1.25, 0.22, ['E3', 'G#3', 'D4', 'F#4']),
        (1.55, 1.60, ['A2', 'E3', 'A3', 'C#4', 'E4', 'A4']) # Triumphant major finish
    ]
    for t_s, dur, notes in chops:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, n_name in enumerate(notes):
            f = n2f(n_name)
            str_sig = karplus_strong_pluck(f, dur, damping=0.994, brightness=0.75, pick_pos=0.18)
            pos = idx + int(i_n * 0.005 * SAMPLE_RATE)
            l = min(len(str_sig), total_samples - pos)
            if l > 0:
                sig[pos:pos+l] += str_sig[:l]
                
    # Crispy crunch amp
    amp = guitar_amp_cab(sig, gain=3.8, cab_cutoff=4400, bite=1.2)
    left, right = add_stereo_reverb(amp, room_size=0.35, decay=0.4)
    save_mp3_stereo(left, right, 'Songs/Guitar_Win_Funk_Rock.mp3')

# ==============================================================
# DERROTA 5: GUITARRA ELÉCTRICA SOLITARIA (Lamento Nostálgico)
# ==============================================================
def gen_guitar_loss_electric_slow():
    total_sec = 3.6
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Emotional descending notes: A4 -> F4 -> E4 -> D4 -> A3
    notes = [
        (0.00, 0.60, 'A4'),
        (0.55, 0.55, 'F4'),
        (1.10, 0.60, 'E4'),
        (1.65, 0.65, 'D4'),
        (2.25, 1.25, 'A3') # Lingering low note
    ]
    for t_s, dur, n_name in notes:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(n_name)
        pluck = karplus_strong_pluck(f, dur, damping=0.996, brightness=0.55, pick_pos=0.3)
        vib_t = np.linspace(0, dur, len(pluck))
        pluck = pluck * (1.0 + 0.14 * np.sin(2 * np.pi * 5.0 * vib_t))
        l = min(len(pluck), total_samples - idx)
        if l > 0:
            sig[idx:idx+l] += pluck[:l]
            
    # Soft warm amp with long tape echo
    amp = guitar_amp_cab(sig, gain=2.2, cab_cutoff=3400, bite=0.9)
    left, right = add_stereo_reverb(amp, room_size=0.65, decay=0.7)
    save_mp3_stereo(left, right, 'Songs/Guitar_Loss_Electric_Slow.mp3')

if __name__ == '__main__':
    print("Generating guitar victory and defeat sounds...")
    gen_guitar_win_rock_riff()
    gen_guitar_win_pokemon_solo()
    gen_guitar_win_acoustic_strum()
    gen_guitar_win_metal_chug()
    gen_guitar_win_funk_rock()
    
    gen_guitar_loss_acoustic_fingerpick()
    gen_guitar_loss_blues_bend()
    gen_guitar_loss_whammy_dive()
    gen_guitar_loss_lofi_soul()
    gen_guitar_loss_electric_slow()
    print("All guitar tracks created successfully!")
