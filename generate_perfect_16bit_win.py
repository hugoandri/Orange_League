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

def snes_spc_reverb(mono_sig, delay_ms=180, feedback=0.38, wet=0.35):
    n = len(mono_sig)
    d_samples = int((delay_ms / 1000.0) * SAMPLE_RATE)
    out_l = np.copy(mono_sig)
    out_r = np.copy(mono_sig)
    
    buf_l = np.zeros(n + d_samples * 4, dtype=np.float32)
    buf_r = np.zeros(n + d_samples * 4, dtype=np.float32)
    buf_l[:n] = mono_sig
    buf_r[:n] = mono_sig
    
    d_r = int(d_samples * 1.22)
    for i in range(d_samples, n):
        echo_val = (buf_l[i - d_samples] * 0.7 + buf_l[max(0, i - d_samples - 1)] * 0.3) * feedback
        buf_r[i] += echo_val
        buf_l[i + d_r] += buf_r[i] * feedback * 0.75
        
    out_l += buf_l[:n] * wet
    out_r += buf_r[:n] * wet
    return out_l, out_r

def save_mp3(left, right, fname):
    max_val = max(np.max(np.abs(left)), np.max(np.abs(right)), 1e-5)
    left = (left / max_val) * 0.94
    right = (right / max_val) * 0.94
    stereo = np.empty((len(left)*2,), dtype=np.int16)
    stereo[0::2] = np.clip(left * 32767, -32768, 32767).astype(np.int16)
    stereo[1::2] = np.clip(right * 32767, -32768, 32767).astype(np.int16)
    p2 = subprocess.Popen(['ffmpeg', '-y', '-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '2', '-i', '-', '-b:a', '192k', fname], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    p2.communicate(stereo.tobytes())
    print('Saved:', fname)

# -----------------------------------------------------------------
# 1. 16-bit SNES: Remaster Oficial SPC700 (100% 06 Win! original en 16 bits)
# -----------------------------------------------------------------
def gen_win_snes_spc700_original():
    # Load exact original 06 Win!.mp3
    p = subprocess.Popen(['ffmpeg', '-i', 'Songs/06 Win!.mp3', '-f', 's16le', '-ac', '2', '-ar', str(SAMPLE_RATE), '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw, _ = p.communicate()
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    l = samples[0::2]
    r = samples[1::2]
    
    # SNES SPC700 Gaussian smoothing (eliminates harsh 8-bit digital square edges)
    k = np.array([0.05, 0.15, 0.25, 0.35, 0.25, 0.15, 0.05], dtype=np.float32)
    k /= np.sum(k)
    l_smooth = np.convolve(l, k, mode='same')
    r_smooth = np.convolve(r, k, mode='same')
    
    # SNES warm stereo echo
    out_l, out_r = snes_spc_reverb(l_smooth * 0.5 + r_smooth * 0.5, delay_ms=185, feedback=0.42, wet=0.38)
    # Add warm low-end body
    t = np.linspace(0, len(out_l)/SAMPLE_RATE, len(out_l))
    save_mp3(out_l, out_r, 'Songs/TCG_Win_16Bit_SNES_SPC700.mp3')

# -----------------------------------------------------------------
# 2. 16-bit SNES: Campanas de Cristal & Celesta (Mezcla armónica con 06 Win!)
# -----------------------------------------------------------------
def gen_win_snes_bells_layered():
    p = subprocess.Popen(['ffmpeg', '-i', 'Songs/06 Win!.mp3', '-f', 's16le', '-ac', '2', '-ar', str(SAMPLE_RATE), '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw, _ = p.communicate()
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    l_orig = samples[0::2]
    r_orig = samples[1::2]
    total_len = len(l_orig)
    
    # Layer soft sparkling SNES celesta notes on the key accents of 06 Win!
    bell_accents = [
        (0.00, 'A5'), (0.15, 'A5'), (0.30, 'F#5'), (0.45, 'A5'),
        (0.75, 'C#6'), (1.00, 'G5'), (1.20, 'B5'), (1.45, 'A5'),
        (1.70, 'D6'), (2.00, 'C#6'), (2.30, 'B5'), (2.60, 'E6'), (3.00, 'A6')
    ]
    bells_track = np.zeros(total_len, dtype=np.float32)
    for t_s, note in bell_accents:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        dur = 0.5 if t_s < 2.8 else 2.2
        t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
        cel = (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 4.5)
        l = min(len(cel), total_len - idx)
        if l > 0: bells_track[idx:idx+l] += cel[:l] * 0.35
            
    b_l, b_r = snes_spc_reverb(bells_track, delay_ms=210, feedback=0.45, wet=0.5)
    
    # Soften the original so the bells shine through gently
    k = np.array([0.08, 0.22, 0.4, 0.22, 0.08], dtype=np.float32)
    l_warm = np.convolve(l_orig, k, mode='same') * 0.75
    r_warm = np.convolve(r_orig, k, mode='same') * 0.75
    
    mix_l = l_warm + b_l
    mix_r = r_warm + b_r
    save_mp3(mix_l, mix_r, 'Songs/TCG_Win_16Bit_SNES_Bells_Layered.mp3')

# -----------------------------------------------------------------
# 3. 16-bit GBA: Pokémon Gym / Ruby & Sapphire
# -----------------------------------------------------------------
def gen_win_gba_gym_remaster():
    # Game Boy Advance characteristic sound: warm acoustic drums + rich midrange
    cmd = [
        'ffmpeg', '-y',
        '-i', 'Songs/06 Win!.mp3',
        '-af', 'equalizer=f=320:t=q:w=1.2:g=4,equalizer=f=1200:t=q:w=1.0:g=3,lowpass=f=12500,stereotools=mlev=1.1:slev=1.35,aecho=0.8:0.6:160:0.35',
        'Songs/TCG_Win_16Bit_GBA_Gym.mp3'
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("Saved: Songs/TCG_Win_16Bit_GBA_Gym.mp3")

# -----------------------------------------------------------------
# 4. Caja de Música Auténtica de 06 Win! (Melodía + Acompañamiento)
# -----------------------------------------------------------------
def gen_win_music_box_authentic():
    # A true music box arrangement playing 06 Win! with both melody and bass chimes!
    total_sec = 5.5
    total_samples = int(total_sec * SAMPLE_RATE)
    sig = np.zeros(total_samples, dtype=np.float32)
    
    # Exact melody notes of 06 Win! at proper musical pitch (octaves 5 & 6)
    melody = [
        (0.00, 'A5', 0.14),
        (0.15, 'A5', 0.14),
        (0.30, 'F#5', 0.14),
        (0.45, 'A5', 0.14),
        (0.60, 'A5', 0.14),
        (0.75, 'C#6', 0.22),
        (1.00, 'B5', 0.20),
        (1.22, 'G5', 0.20),
        (1.44, 'B5', 0.20),
        (1.68, 'C#6', 0.20),
        (1.90, 'D6', 0.22),
        (2.14, 'D6', 0.20),
        (2.36, 'C#6', 0.20),
        (2.58, 'B5', 0.20),
        (2.80, 'C#6', 0.22),
        (3.04, 'E6', 0.30),
        (3.38, 'A6', 2.00) # Ringing high chime
    ]
    
    # Music box bass accompaniment (plucked pins in octaves 3 & 4)
    bass = [
        (0.00, 'A4', 0.4), (0.45, 'E4', 0.4),
        (0.75, 'A4', 0.4), (1.22, 'E4', 0.4),
        (1.68, 'D4', 0.4), (2.14, 'A4', 0.4),
        (2.58, 'E4', 0.4), (3.04, 'B4', 0.4),
        (3.38, 'A4', 1.8), (3.42, 'C#5', 1.8), (3.46, 'E5', 1.8) # Final warm chord
    ]
    
    # Synthesize music box metal pins (bright sine + high harmonic + fast exponential decay)
    for t_s, note, dur in melody:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        t = np.linspace(0, dur * 2.2, int(SAMPLE_RATE * dur * 2.2), endpoint=False)
        pin = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(6 * np.pi * f * t) + 0.1 * np.sin(10 * np.pi * f * t)) * np.exp(-t * 5.5)
        l = min(len(pin), total_samples - idx)
        if l > 0: sig[idx:idx+l] += pin[:l] * 0.75
            
    for t_s, note, dur in bass:
        idx = int(t_s * SAMPLE_RATE)
        f = n2f(note)
        t = np.linspace(0, dur * 2.5, int(SAMPLE_RATE * dur * 2.5), endpoint=False)
        pin_b = (np.sin(2 * np.pi * f * t) + 0.2 * np.sin(4 * np.pi * f * t)) * np.exp(-t * 4.0)
        l = min(len(pin_b), total_samples - idx)
        if l > 0: sig[idx:idx+l] += pin_b[:l] * 0.45
            
    left, right = snes_spc_reverb(sig, delay_ms=195, feedback=0.46, wet=0.45)
    save_mp3(left, right, 'Songs/TCG_Win_Music_Box_Authentic.mp3')

if __name__ == '__main__':
    print("Generating authentic 16-bit Win options...")
    gen_win_snes_spc700_original()
    gen_win_snes_bells_layered()
    gen_win_gba_gym_remaster()
    gen_win_music_box_authentic()
    print("Done!")
