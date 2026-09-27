import numpy as np
import subprocess
import os

SAMPLE_RATE = 44100

def midi_to_freq(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))

def n2f(note_str):
    notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    flats = {'Db': 'C#', 'Eb': 'D#', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#'}
    octave = int(note_str[-1])
    n = note_str[:-1]
    if n in flats: n = flats[n]
    semi = notes.index(n)
    midi = (octave + 1) * 12 + semi
    return midi_to_freq(midi)

# 16-bit SNES SPC700 Reverb/Echo simulation
def snes_spc_reverb(mono_sig, delay_ms=180, feedback=0.42, wet=0.38):
    n = len(mono_sig)
    d_samples = int((delay_ms / 1000.0) * SAMPLE_RATE)
    out_l = np.copy(mono_sig)
    out_r = np.copy(mono_sig)
    
    buf_l = np.zeros(n + d_samples * 4, dtype=np.float32)
    buf_r = np.zeros(n + d_samples * 4, dtype=np.float32)
    buf_l[:n] = mono_sig
    buf_r[:n] = mono_sig
    
    # Ping-pong delay with lowpass damping (characteristic of SNES SPC700 DSP)
    d_r = int(d_samples * 1.25)
    for i in range(d_samples, n):
        # lowpass filter echo
        echo_val = (buf_l[i - d_samples] * 0.7 + buf_l[max(0, i - d_samples - 1)] * 0.3) * feedback
        buf_r[i] += echo_val
        buf_l[i + d_r] += buf_r[i] * feedback * 0.8
        
    out_l += buf_l[:n] * wet
    out_r += buf_r[:n] * wet
    return out_l, out_r

# SNES / 16-bit Marimba / Mallet generator
def gen_snes_mallet(freq, duration):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    # Fundamental + mild 2nd & 3rd harmonic
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t) + 0.15 * np.sin(6 * np.pi * freq * t)
    # Fast attack, warm exponential decay
    env = np.exp(-t * 7.5)
    return (sig * env).astype(np.float32)

# SNES / 16-bit Music Box / Celesta generator
def gen_snes_celesta(freq, duration):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    sig = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(6 * np.pi * freq * t) + 0.08 * np.sin(10 * np.pi * freq * t)
    env = np.exp(-t * 4.2)
    return (sig * env).astype(np.float32)

# 16-bit Acoustic Piano generator
def gen_16bit_piano(freq, duration):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    # Piano hammer strike harmonics
    h1 = np.sin(2 * np.pi * freq * t)
    h2 = 0.5 * np.sin(4 * np.pi * freq * t)
    h3 = 0.25 * np.sin(6 * np.pi * freq * t)
    h4 = 0.12 * np.sin(8 * np.pi * freq * t)
    h5 = 0.06 * np.sin(10 * np.pi * freq * t)
    
    # Attack transient
    attack_samples = int(0.008 * SAMPLE_RATE)
    strike = np.ones_like(t)
    strike[:attack_samples] = np.linspace(0, 1, attack_samples)
    
    decay_rate = 2.8 if freq < 400 else 4.5
    env = strike * np.exp(-t * decay_rate)
    return ((h1 + h2 + h3 + h4 + h5) * env).astype(np.float32)

# 16-bit Warm Strings pad generator
def gen_snes_strings(freq, duration):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    # Detuned warmth
    s1 = np.sin(2 * np.pi * freq * t)
    s2 = 0.6 * np.sin(2 * np.pi * (freq * 1.003) * t)
    s3 = 0.6 * np.sin(2 * np.pi * (freq * 0.997) * t)
    sig = s1 + s2 + s3
    
    attack = int(0.08 * SAMPLE_RATE)
    decay = int(0.12 * SAMPLE_RATE)
    env = np.ones_like(t)
    if len(env) > attack: env[:attack] = np.linspace(0, 1, attack)
    if len(env) > decay: env[-decay:] = np.linspace(1, 0.001, decay)
    return (sig * env * 0.35).astype(np.float32)

# 16-bit Warm Flute generator
def gen_snes_flute(freq, duration):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    vib = 1.0 + 0.02 * np.sin(2 * np.pi * 5.2 * t)
    sig = np.sin(2 * np.pi * freq * vib * t) + 0.2 * np.sin(4 * np.pi * freq * vib * t)
    # Breath noise
    breath = np.random.normal(0, 0.02, len(t))
    sig = sig + breath
    
    attack = int(0.05 * SAMPLE_RATE)
    decay = int(0.10 * SAMPLE_RATE)
    env = np.ones_like(t)
    if len(env) > attack: env[:attack] = np.linspace(0, 1, attack)
    if len(env) > decay: env[-decay:] = np.linspace(1, 0.001, decay)
    return (sig * env).astype(np.float32)

def save_mp3_16bit(left, right, filename):
    max_val = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-5)
    left = (left / max_val) * 0.92
    right = (right / max_val) * 0.92
    
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
    print("Saved 16-bit track:", filename)

# Melodies for 06 Win! and 08 Lost...
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
    (3.00, 2.20, 'A5')
]

WIN_CHORDS = [
    (0.00, 0.65, ['A3', 'C#4', 'E4']),
    (0.70, 0.70, ['A3', 'C#4', 'E4']),
    (1.50, 0.55, ['D4', 'F#4', 'A4']),
    (2.10, 0.55, ['E4', 'G#4', 'B4']),
    (2.70, 2.40, ['A3', 'E4', 'A4', 'C#5', 'E5'])
]

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
    (5.30, 1.80, 'C3')
]

LOST_CHORDS = [
    (0.00, 1.10, ['F3', 'Ab3', 'C4']),
    (1.15, 1.15, ['Eb3', 'G3', 'Bb3']),
    (2.35, 1.15, ['Db3', 'F3', 'Ab3']),
    (3.55, 3.50, ['C3', 'Eb3', 'G3', 'C4'])
]

# ==============================================================
# VICTORIA 16-BIT TRACKS
# ==============================================================
# 1. SNES: Campanas de Cristal & Marimba
def gen_win_snes_mallet():
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        m = gen_snes_mallet(f, dur * 1.5)
        c = gen_snes_celesta(f * 2.0, dur * 1.5) * 0.4
        min_l = min(len(m), len(c))
        mix = m[:min_l] + c[:min_l]
        l = min(len(mix), n - idx)
        if l > 0: sig[idx:idx+l] += mix[:l]
            
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            st = gen_snes_strings(f, dur)
            l = min(len(st), n - idx)
            if l > 0: sig[idx:idx+l] += st[:l] * 0.45
            
    left, right = snes_spc_reverb(sig, delay_ms=190, feedback=0.45, wet=0.4)
    save_mp3_16bit(left, right, 'Songs/TCG_Win_16Bit_SNES_Bells.mp3')

# 2. GBA / 16-bit: Piano & Strings Pokémon Gym
def gen_win_gba_piano():
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = gen_16bit_piano(f, dur * 1.8)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.85
            
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p_ch = gen_16bit_piano(f, dur * 1.2) * 0.35
            st_ch = gen_snes_strings(f, dur) * 0.35
            min_l = min(len(p_ch), len(st_ch))
            ch_mix = p_ch[:min_l] + st_ch[:min_l]
            l = min(len(ch_mix), n - idx)
            if l > 0: sig[idx:idx+l] += ch_mix[:l]
            
    left, right = snes_spc_reverb(sig, delay_ms=160, feedback=0.4, wet=0.35)
    save_mp3_16bit(left, right, 'Songs/TCG_Win_16Bit_GBA_Piano.mp3')

# 3. Piano Acústico de Cola & Celesta
def gen_win_grand_piano():
    total_sec = 5.4
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = gen_16bit_piano(f, dur * 2.0)
        cel = gen_snes_celesta(f, dur * 2.0) * 0.3
        min_l = min(len(p), len(cel))
        mix = p[:min_l] + cel[:min_l]
        l = min(len(mix), n - idx)
        if l > 0: sig[idx:idx+l] += mix[:l] * 0.9
            
    for t_s, dur, notes in WIN_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p = gen_16bit_piano(f, dur * 1.4)
            l = min(len(p), n - idx)
            if l > 0: sig[idx:idx+l] += p[:l] * 0.4
            
    left, right = snes_spc_reverb(sig, delay_ms=220, feedback=0.35, wet=0.45)
    save_mp3_16bit(left, right, 'Songs/TCG_Win_Piano_Celesta.mp3')

# 4. Caja de Música Mágica 16-bit (Music Box Celesta)
def gen_win_music_box():
    total_sec = 5.2
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in WIN_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note) * 2.0 # High octaves for music box
        box = gen_snes_celesta(f, dur * 1.6)
        l = min(len(box), n - idx)
        if l > 0: sig[idx:idx+l] += box[:l] * 0.95
            
    left, right = snes_spc_reverb(sig, delay_ms=200, feedback=0.48, wet=0.5)
    save_mp3_16bit(left, right, 'Songs/TCG_Win_16Bit_Music_Box.mp3')

# ==============================================================
# DERROTA 16-BIT TRACKS
# ==============================================================
# 1. SNES: Flauta Melancólica & Cuerdas SPC700
def gen_loss_snes_flute():
    total_sec = 7.0
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        fl = gen_snes_flute(f, dur * 1.1)
        l = min(len(fl), n - idx)
        if l > 0: sig[idx:idx+l] += fl[:l] * 0.85
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            st = gen_snes_strings(f, dur)
            l = min(len(st), n - idx)
            if l > 0: sig[idx:idx+l] += st[:l] * 0.38
            
    left, right = snes_spc_reverb(sig, delay_ms=220, feedback=0.45, wet=0.45)
    save_mp3_16bit(left, right, 'Songs/TCG_Loss_16Bit_SNES_Flute.mp3')

# 2. GBA / 16-bit: Piano Eléctrico & Resignación
def gen_loss_gba_piano():
    total_sec = 7.0
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = gen_16bit_piano(f, dur * 1.5)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.85
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p = gen_16bit_piano(f, dur * 1.3) * 0.35
            l = min(len(p), n - idx)
            if l > 0: sig[idx:idx+l] += p[:l]
            
    left, right = snes_spc_reverb(sig, delay_ms=190, feedback=0.42, wet=0.4)
    save_mp3_16bit(left, right, 'Songs/TCG_Loss_16Bit_GBA_Piano.mp3')

# 3. Piano Acústico Solitario (Elegía)
def gen_loss_grand_piano():
    total_sec = 7.2
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        p = gen_16bit_piano(f, dur * 2.2)
        l = min(len(p), n - idx)
        if l > 0: sig[idx:idx+l] += p[:l] * 0.9
            
    for t_s, dur, notes in LOST_CHORDS:
        idx = int(t_s * SAMPLE_RATE)
        for note in notes:
            f = n2f(note)
            p = gen_16bit_piano(f, dur * 1.6) * 0.38
            l = min(len(p), n - idx)
            if l > 0: sig[idx:idx+l] += p[:l]
            
    left, right = snes_spc_reverb(sig, delay_ms=250, feedback=0.38, wet=0.5)
    save_mp3_16bit(left, right, 'Songs/TCG_Loss_Piano_Solo.mp3')

# 4. Caja de Música Nostálgica 16-bit
def gen_loss_music_box():
    total_sec = 7.0
    n = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(n, dtype=np.float32)
    
    for t_s, dur, note in LOST_MELODY:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note) * 2.0
        box = gen_snes_celesta(f, dur * 1.5)
        l = min(len(box), n - idx)
        if l > 0: sig[idx:idx+l] += box[:l] * 0.95
            
    left, right = snes_spc_reverb(sig, delay_ms=220, feedback=0.5, wet=0.52)
    save_mp3_16bit(left, right, 'Songs/TCG_Loss_16Bit_Music_Box.mp3')

if __name__ == '__main__':
    print("Generating 16-bit (SNES/GBA), Piano & Chime tracks for 06 Win! and 08 Lost...")
    gen_win_snes_mallet()
    gen_win_gba_piano()
    gen_win_grand_piano()
    gen_win_music_box()
    
    gen_loss_snes_flute()
    gen_loss_gba_piano()
    gen_loss_grand_piano()
    gen_loss_music_box()
    print("All 16-bit tracks created successfully!")
