import numpy as np
import subprocess
import os

SAMPLE_RATE = 44100

def karplus_strong(freq, duration, sr=SAMPLE_RATE, damping=0.994, brightness=0.6, pick_pos=0.22):
    period = max(2, int(round(sr / freq)))
    n_samples = int(duration * sr)
    
    # Burst with brightness filtering
    raw = np.random.uniform(-1, 1, period).astype(np.float32)
    burst = np.copy(raw)
    for i in range(1, period):
        burst[i] = brightness * raw[i] + (1.0 - brightness) * burst[i-1]
        
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

def guitar_amp(sig, gain=3.5, cab_cutoff=4000, bite=1.2):
    pre = sig * gain * bite
    driven = np.tanh(pre + 0.12) - np.tanh(0.12)
    
    # 2-pole lowpass filter for speaker cabinet
    rc = 1.0 / (2.0 * np.pi * cab_cutoff)
    dt = 1.0 / SAMPLE_RATE
    alpha = dt / (rc + dt)
    
    s1 = np.zeros_like(driven)
    y1 = 0.0
    for i in range(len(driven)):
        y1 = y1 + alpha * (driven[i] - y1)
        s1[i] = y1
        
    s2 = np.zeros_like(s1)
    y2 = 0.0
    for i in range(len(s1)):
        y2 = y2 + alpha * (s1[i] - y2)
        s2[i] = y2
        
    return s2

def add_stereo_reverb(mono_sig, room_size=0.35, decay=0.45):
    n = len(mono_sig)
    left = np.copy(mono_sig)
    right = np.copy(mono_sig)
    
    delays_l = [int(0.019 * SAMPLE_RATE), int(0.037 * SAMPLE_RATE), int(0.053 * SAMPLE_RATE)]
    delays_r = [int(0.024 * SAMPLE_RATE), int(0.043 * SAMPLE_RATE), int(0.062 * SAMPLE_RATE)]
    
    for d in delays_l:
        if d < n: left[d:] += mono_sig[:-d] * room_size * decay
    for d in delays_r:
        if d < n: right[d:] += mono_sig[:-d] * room_size * decay
            
    return left, right

def save_mp3(left, right, filename):
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
    print("Saved:", filename)

def n2f(note_str):
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    flats = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}
    octave = int(note_str[-1])
    n = note_str[:-1]
    if n in flats: n = flats[n]
    semi = notes.index(n)
    midi = (octave + 1) * 12 + semi
    return 440.0 * (2.0 ** ((midi - 69) / 12.0))

# ==============================================================
# 06 WIN! MELODY TIMELINE (Exact from original Game Boy Color)
# ==============================================================
WIN_MELODY = [
    (0.00, 0.13, 'A4'),
    (0.14, 0.13, 'A4'),
    (0.28, 0.13, 'F#4'),
    (0.42, 0.13, 'A4'),
    (0.56, 0.13, 'A4'),
    (0.70, 0.18, 'C#5'),
    (0.90, 0.18, 'B4'),
    (1.10, 0.18, 'G4'),
    (1.30, 0.18, 'B4'),
    (1.50, 0.18, 'C#5'),
    (1.70, 0.18, 'D5'),
    (1.90, 0.18, 'D5'),
    (2.10, 0.18, 'C#5'),
    (2.30, 0.18, 'B4'),
    (2.50, 0.18, 'C#5'),
    (2.70, 0.25, 'E5'),
    (3.00, 2.00, 'A5') # Big sustained high A5 note
]

# Supporting Power Chords for 06 Win!
WIN_CHORDS = [
    (0.00, 0.65, ['A2', 'E3', 'A3']),
    (0.70, 0.70, ['A2', 'E3', 'A3']),
    (1.50, 0.55, ['D3', 'A3', 'D4']),
    (2.10, 0.55, ['E3', 'B3', 'E4']),
    (2.70, 2.40, ['A2', 'E3', 'A3', 'C#4', 'E4'])
]

# ==============================================================
# 08 LOST... MELODY TIMELINE (Exact from original Game Boy Color)
# ==============================================================
LOST_MELODY = [
    (0.00, 0.35, 'F4'),
    (0.36, 0.32, 'C4'),
    (0.70, 0.40, 'Bb3'),
    (1.15, 0.35, 'Eb4'),
    (1.52, 0.32, 'Bb3'),
    (1.86, 0.45, 'Ab3'),
    (2.35, 0.35, 'Db4'),
    (2.72, 0.32, 'Ab3'),
    (3.06, 0.45, 'F#3'),
    (3.55, 0.38, 'G3'),
    (3.95, 0.90, 'C4'),
    (4.90, 0.35, 'G3'),
    (5.30, 1.60, 'C3')
]

LOST_CHORDS = [
    (0.00, 1.10, ['F2', 'C3', 'F3', 'Ab3']),
    (1.15, 1.15, ['Eb2', 'Bb2', 'Eb3', 'G3']),
    (2.35, 1.15, ['Db2', 'Ab2', 'Db3', 'F3']),
    (3.55, 3.40, ['C2', 'G2', 'C3', 'Eb3', 'G3'])
]

# --------------------------------------------------------------
# 1. WIN: Rock Eléctrico con Overdrive & Power Chords
# --------------------------------------------------------------
def gen_tcg_win_rock_electric():
    total_sec = 5.2
    n = int(total_sec * SAMPLE_RATE)
    lead_sig = np.zeros(n, dtype=np.float32)
    rhythm_sig = np.zeros(n, dtype=np.float32)
    
    # Lead guitar playing exact 06 Win! melody
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.996, brightness=0.82, pick_pos=0.18)
        if dur > 0.4:
            vib_t = np.linspace(0, dur, len(p))
            p = p * (1.0 + 0.18 * np.sin(2 * np.pi * 5.8 * vib_t))
        l = min(len(p), n - idx)
        if l > 0: lead_sig[idx:idx+l] += p[:l]
            
    # Rhythm guitar playing exact chords
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.007 * SAMPLE_RATE)
            pos = idx + str_d
            p = karplus_strong(f, dur, damping=0.993, brightness=0.7, pick_pos=0.22)
            l = min(len(p), n - pos)
            if l > 0: rhythm_sig[pos:pos+l] += p[:l]
            
    lead_amp = guitar_amp(lead_sig, gain=5.5, cab_cutoff=4200, bite=1.3)
    rhythm_amp = guitar_amp(rhythm_sig, gain=4.2, cab_cutoff=3600, bite=1.1)
    
    mix = lead_amp * 0.7 + rhythm_amp * 0.45
    left, right = add_stereo_reverb(mix, room_size=0.4, decay=0.45)
    save_mp3(left, right, 'Songs/TCG_Win_Guitar_Rock.mp3')

# --------------------------------------------------------------
# 2. WIN: Guitarras Gemelas J-Rock (Armonizadas en terceras)
# --------------------------------------------------------------
def gen_tcg_win_twin_lead():
    total_sec = 5.2
    n = int(total_sec * SAMPLE_RATE)
    left_lead = np.zeros(n, dtype=np.float32)
    right_lead = np.zeros(n, dtype=np.float32)
    rhythm = np.zeros(n, dtype=np.float32)
    
    # Harmony intervals (thirds up in A major)
    harmony_map = {
        'A4': 'C#5', 'F#4': 'A4', 'C#5': 'E5', 'B4': 'D5',
        'G4': 'B4', 'D5': 'F#5', 'E5': 'G#5', 'A5': 'C#6'
    }
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f_main = n2f(note)
        f_harm = n2f(harmony_map.get(note, note))
        
        p_main = karplus_strong(f_main, dur, damping=0.996, brightness=0.85, pick_pos=0.15)
        p_harm = karplus_strong(f_harm, dur, damping=0.996, brightness=0.85, pick_pos=0.20)
        
        if dur > 0.4:
            vib_t = np.linspace(0, dur, len(p_main))
            vib = (1.0 + 0.16 * np.sin(2 * np.pi * 6.0 * vib_t))
            p_main *= vib
            p_harm *= vib
            
        l = min(len(p_main), n - idx)
        if l > 0:
            left_lead[idx:idx+l] += p_main[:l]
            right_lead[idx:idx+l] += p_harm[:l]
            
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p = karplus_strong(f, dur, damping=0.994, brightness=0.68)
            l = min(len(p), n - idx)
            if l > 0: rhythm[idx:idx+l] += p[:l] * 0.4
            
    l_amp = guitar_amp(left_lead + rhythm, gain=5.2, cab_cutoff=4400, bite=1.25)
    r_amp = guitar_amp(right_lead + rhythm, gain=5.2, cab_cutoff=4400, bite=1.25)
    save_mp3(l_amp, r_amp, 'Songs/TCG_Win_Guitar_Twin_Lead.mp3')

# --------------------------------------------------------------
# 3. WIN: Guitarra Acústica Fingerstyle & Rasgueo
# --------------------------------------------------------------
def gen_tcg_win_acoustic():
    total_sec = 5.0
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    # Melody on nylon/bronze acoustic
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.995, brightness=0.65, pick_pos=0.3)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.85
            
    # Strummed chords on acoustic
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.008 * SAMPLE_RATE)
            pos = idx + str_d
            p = karplus_strong(f, dur, damping=0.994, brightness=0.6, pick_pos=0.32)
            l = min(len(p), n - pos)
            if l > 0: sig[pos:pos+l] += p[:l] * 0.45
            
    clean = np.tanh(1.25 * sig)
    left, right = add_stereo_reverb(clean, room_size=0.45, decay=0.5)
    save_mp3(left, right, 'Songs/TCG_Win_Guitar_Acoustic.mp3')

# --------------------------------------------------------------
# 4. WIN: Heavy Metal Power Chug Edition
# --------------------------------------------------------------
def gen_tcg_win_metal():
    total_sec = 5.2
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    # Lead guitar with bite
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.997, brightness=0.9, pick_pos=0.12)
        if dur > 0.4:
            vib_t = np.linspace(0, dur, len(p))
            p = p * (1.0 + 0.25 * np.sin(2 * np.pi * 6.5 * vib_t))
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.75
            
    # Heavy low drop chords
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        # Drop notes 1 octave down
        for note in notes:
            oct = int(note[-1]) - 1
            low_n = note[:-1] + str(oct)
            f = n2f(low_n)
            p = karplus_strong(f, dur, damping=0.995, brightness=0.85, pick_pos=0.15)
            l = min(len(p), n - idx)
            if l > 0: sig[idx:idx+l] += p[:l] * 0.65
            
    metal_amp = guitar_amp(sig, gain=7.5, cab_cutoff=4600, bite=1.45)
    left, right = add_stereo_reverb(metal_amp, room_size=0.38, decay=0.42)
    save_mp3(left, right, 'Songs/TCG_Win_Guitar_Metal.mp3')

# --------------------------------------------------------------
# 5. WIN: Clean Stratocaster con Chorus Funk/Pop
# --------------------------------------------------------------
def gen_tcg_win_clean_chorus():
    total_sec = 5.0
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.996, brightness=0.72, pick_pos=0.25)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.8
            
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.005 * SAMPLE_RATE)
            p = karplus_strong(f, dur, damping=0.994, brightness=0.65, pick_pos=0.28)
            pos = idx + str_d
            l = min(len(p), n - pos)
            if l > 0: sig[pos:pos+l] += p[:l] * 0.35
            
    # Warm clean tone + chorus
    clean = guitar_amp(sig, gain=2.2, cab_cutoff=4800, bite=1.0)
    # Chorus modulation
    t = np.linspace(0, total_sec, n)
    chorus_delay = (0.015 + 0.004 * np.sin(2 * np.pi * 1.5 * t)) * SAMPLE_RATE
    left = np.copy(clean)
    right = np.copy(clean)
    for i in range(len(clean)):
        d = int(chorus_delay[i])
        if i >= d:
            left[i] += clean[i - d] * 0.4
            right[i] += clean[i - d] * -0.4
            
    left, right = add_stereo_reverb(left, room_size=0.45, decay=0.5)
    save_mp3(left, right, 'Songs/TCG_Win_Guitar_Clean_Chorus.mp3')


# --------------------------------------------------------------
# 1. LOST: Guitarra Acústica Solitaria (Fingerstyle Triste)
# --------------------------------------------------------------
def gen_tcg_loss_acoustic():
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    # Exact 08 Lost... melody
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.996, brightness=0.48, pick_pos=0.35)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.85
            
    # Soft acoustic fingerpicked chords
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.015 * SAMPLE_RATE)
            pos = idx + str_d
            p = karplus_strong(f, dur, damping=0.995, brightness=0.42, pick_pos=0.38)
            l = min(len(p), n - pos)
            if l > 0: sig[pos:pos+l] += p[:l] * 0.4
            
    clean = np.tanh(1.15 * sig)
    left, right = add_stereo_reverb(clean, room_size=0.6, decay=0.65)
    save_mp3(left, right, 'Songs/TCG_Loss_Guitar_Acoustic.mp3')

# --------------------------------------------------------------
# 2. LOST: Blues Eléctrico con Reverb de Válvulas
# --------------------------------------------------------------
def gen_tcg_loss_blues_strat():
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.997, brightness=0.62, pick_pos=0.28)
        # Slow soulful vibrato
        vib_t = np.linspace(0, dur, len(p))
        p = p * (1.0 + 0.16 * np.sin(2 * np.pi * 4.8 * vib_t))
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.9
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.012 * SAMPLE_RATE)
            pos = idx + str_d
            p = karplus_strong(f, dur, damping=0.995, brightness=0.5, pick_pos=0.3)
            l = min(len(p), n - pos)
            if l > 0: sig[pos:pos+l] += p[:l] * 0.35
            
    amp = guitar_amp(sig, gain=2.8, cab_cutoff=3600, bite=1.0)
    left, right = add_stereo_reverb(amp, room_size=0.65, decay=0.7)
    save_mp3(left, right, 'Songs/TCG_Loss_Guitar_Blues.mp3')

# --------------------------------------------------------------
# 3. LOST: Lo-Fi Chill Guitar (Vintage Tape & Chorus)
# --------------------------------------------------------------
def gen_tcg_loss_lofi():
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.995, brightness=0.45, pick_pos=0.35)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.8
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for i_n, note in enumerate(notes):
            f = n2f(note)
            str_d = int(i_n * 0.018 * SAMPLE_RATE)
            pos = idx + str_d
            p = karplus_strong(f, dur, damping=0.994, brightness=0.38, pick_pos=0.4)
            l = min(len(p), n - pos)
            if l > 0: sig[pos:pos+l] += p[:l] * 0.4
            
    clean = np.tanh(1.2 * sig)
    # Subtle tape flutter & vinyl warmth
    t = np.linspace(0, total_sec, n)
    flutter = np.sin(2 * np.pi * 0.8 * t) * 0.05
    clean = clean * (1.0 + flutter)
    noise = np.random.normal(0, 0.0035, n).astype(np.float32)
    clean += noise
    left, right = add_stereo_reverb(clean, room_size=0.55, decay=0.6)
    save_mp3(left, right, 'Songs/TCG_Loss_Guitar_Lofi.mp3')

# --------------------------------------------------------------
# 4. LOST: Balada Rock Triste (Lead Lento con Overdrive Cálido)
# --------------------------------------------------------------
def gen_tcg_loss_ballad():
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    lead = np.zeros(n, dtype=np.float32)
    rhythm = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = karplus_strong(f, dur, damping=0.997, brightness=0.7, pick_pos=0.22)
        vib_t = np.linspace(0, dur, len(p))
        p = p * (1.0 + 0.2 * np.sin(2 * np.pi * 5.2 * vib_t))
        l = min(len(p), n - idx)
        if l > 0: lead[idx:idx+l] += p[:l]
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p = karplus_strong(f, dur, damping=0.995, brightness=0.55, pick_pos=0.25)
            l = min(len(p), n - idx)
            if l > 0: rhythm[idx:idx+l] += p[:l] * 0.45
            
    lead_amp = guitar_amp(lead, gain=4.5, cab_cutoff=3800, bite=1.15)
    rhythm_amp = guitar_amp(rhythm, gain=3.0, cab_cutoff=3400, bite=1.0)
    mix = lead_amp * 0.75 + rhythm_amp * 0.45
    left, right = add_stereo_reverb(mix, room_size=0.55, decay=0.65)
    save_mp3(left, right, 'Songs/TCG_Loss_Guitar_Ballad.mp3')

# --------------------------------------------------------------
# 5. LOST: Dúo Acústico Íntimo (Guitarra Melódica + Bajo)
# --------------------------------------------------------------
def gen_tcg_loss_acoustic_duo():
    total_sec = 6.8
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        # Shift melody up an octave for delicate acoustic chime
        oct = int(note[-1]) + 1
        high_n = note[:-1] + str(oct)
        f = n2f(high_n)
        p = karplus_strong(f, dur, damping=0.995, brightness=0.55, pick_pos=0.32)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.8
            
    # Deep acoustic bass root notes
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        root_note = notes[0] # Bass root
        f = n2f(root_note)
        p = karplus_strong(f, dur, damping=0.996, brightness=0.35, pick_pos=0.4)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.75
            
    clean = np.tanh(1.2 * sig)
    left, right = add_stereo_reverb(clean, room_size=0.6, decay=0.65)
    save_mp3(left, right, 'Songs/TCG_Loss_Guitar_Acoustic_Duo.mp3')

if __name__ == '__main__':
    print("Generating guitar adaptations of original 06 Win! and 08 Lost...")
    gen_tcg_win_rock_electric()
    gen_tcg_win_twin_lead()
    gen_tcg_win_acoustic()
    gen_tcg_win_metal()
    gen_tcg_win_clean_chorus()
    
    gen_tcg_loss_acoustic()
    gen_tcg_loss_blues_strat()
    gen_tcg_loss_lofi()
    gen_tcg_loss_ballad()
    gen_tcg_loss_acoustic_duo()
    print("All 10 guitar adaptations created successfully!")
