import numpy as np
import subprocess
import os

SAMPLE_RATE = 44100

def create_sub_kick(t_len=0.6, start_freq=160, end_freq=38):
    t = np.linspace(0, t_len, int(SAMPLE_RATE * t_len), endpoint=False)
    freq = start_freq * np.exp(-t * 8) + end_freq
    phase = 2 * np.pi * np.cumsum(freq) / SAMPLE_RATE
    env = np.exp(-t * 6.5)
    return 0.7 * np.sin(phase) * env

def create_supersaw_note(freq, duration, detune_cents=12, decay=0.3):
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
    sig = np.zeros_like(t)
    detunes = [-detune_cents, -detune_cents/2, 0, detune_cents/2, detune_cents]
    for d in detunes:
        f = freq * (2 ** (d / 1200))
        # Sawtooth waveform: 2 * (t * f % 1) - 1
        saw = 2 * ((t * f) % 1) - 1
        sig += saw
    sig /= len(detunes)
    
    # ADSR Envelope
    attack = int(0.015 * SAMPLE_RATE)
    decay_s = int(decay * SAMPLE_RATE)
    env = np.ones_like(t)
    if attack > 0 and len(env) > attack:
        env[:attack] = np.linspace(0, 1, attack)
    if decay_s > 0 and len(env) > decay_s:
        env[-decay_s:] = np.linspace(1, 0.001, decay_s)
    else:
        env = np.exp(-t * 2.5)
    return sig * env

def midi_to_freq(m):
    return 440.0 * (2.0 ** ((m - 69) / 12.0))

# Note name dictionary
NOTE_MAP = {
    'C3': 48, 'C#3': 49, 'D3': 50, 'D#3': 51, 'E3': 52, 'F3': 53, 'F#3': 54, 'G3': 55, 'G#3': 56, 'A3': 57, 'A#3': 58, 'B3': 59,
    'C4': 60, 'C#4': 61, 'D4': 62, 'D#4': 63, 'E4': 64, 'F4': 65, 'F#4': 66, 'G4': 67, 'G#4': 68, 'A4': 69, 'A#4': 70, 'B4': 71,
    'C5': 72, 'C#5': 73, 'D5': 74, 'D#5': 75, 'E5': 76, 'F5': 77, 'F#5': 78, 'G5': 79, 'G#5': 80, 'A5': 81, 'A#5': 82, 'B5': 83,
    'C6': 84, 'D6': 86, 'E6': 88, 'G6': 91
}

def save_mp3(audio_left, audio_right, output_filename, normalize=True):
    if normalize:
        max_val = max(np.max(np.abs(audio_left)), np.max(np.abs(audio_right)), 1e-6)
        audio_left = (audio_left / max_val) * 0.95
        audio_right = (audio_right / max_val) * 0.95
    
    stereo = np.empty((len(audio_left) * 2,), dtype=np.int16)
    stereo[0::2] = np.clip(audio_left * 32767, -32768, 32767).astype(np.int16)
    stereo[1::2] = np.clip(audio_right * 32767, -32768, 32767).astype(np.int16)
    
    cmd = [
        'ffmpeg', '-y',
        '-f', 's16le', '-ar', str(SAMPLE_RATE), '-ac', '2',
        '-i', '-',
        '-b:a', '192k',
        output_filename
    ]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    p.communicate(stereo.tobytes())
    print("Saved:", output_filename)

def generate_win_synthwave():
    # Load original audio
    p = subprocess.Popen(['ffmpeg', '-i', 'Songs/06 Win!.mp3', '-f', 's16le', '-ac', '2', '-ar', str(SAMPLE_RATE), '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw, _ = p.communicate()
    orig = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    left_orig = orig[0::2]
    right_orig = orig[1::2]
    total_len = len(left_orig)
    
    left = np.copy(left_orig) * 0.85
    right = np.copy(right_orig) * 0.85
    
    # Add modern sub kicks at key beats
    kicks_times = [0.0, 0.44, 0.92, 1.40, 2.00, 2.65, 3.30, 4.00, 4.65]
    kick = create_sub_kick(0.45, 170, 42)
    for kt in kicks_times:
        idx = int(kt * SAMPLE_RATE)
        if idx + len(kick) < total_len:
            left[idx:idx+len(kick)] += kick * 0.55
            right[idx:idx+len(kick)] += kick * 0.55
            
    # Add modern stereo supersaw shimmer chords at the climax (around 1.4s - 3.8s)
    # TCG Win in A major (A, C#, E) and D major (D, F#, A)
    climax_chords = [
        (1.40, 0.55, [NOTE_MAP['D4'], NOTE_MAP['F#4'], NOTE_MAP['A4']]),
        (2.00, 0.60, [NOTE_MAP['A3'], NOTE_MAP['C#4'], NOTE_MAP['E4']]),
        (2.65, 0.60, [NOTE_MAP['B3'], NOTE_MAP['D4'], NOTE_MAP['F#4']]),
        (3.30, 1.20, [NOTE_MAP['A3'], NOTE_MAP['E4'], NOTE_MAP['A4'], NOTE_MAP['C#5']])
    ]
    for start_t, dur, chord in climax_chords:
        idx = int(start_t * SAMPLE_RATE)
        for midi_n in chord:
            freq = midi_to_freq(midi_n)
            synth_l = create_supersaw_note(freq, dur, detune_cents=8, decay=dur*0.4)
            synth_r = create_supersaw_note(freq, dur, detune_cents=-8, decay=dur*0.4)
            l_len = min(len(synth_l), total_len - idx)
            if l_len > 0:
                left[idx:idx+l_len] += synth_l[:l_len] * 0.18
                right[idx:idx+l_len] += synth_r[:l_len] * 0.18
                
    save_mp3(left, right, 'Songs/06_Win_Synthwave_Modern.mp3')

def generate_lost_neo_chill():
    # Load original audio
    p = subprocess.Popen(['ffmpeg', '-i', 'Songs/08 Lost.mp3', '-f', 's16le', '-ac', '2', '-ar', str(SAMPLE_RATE), '-'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    raw, _ = p.communicate()
    orig = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    left_orig = orig[0::2]
    right_orig = orig[1::2]
    total_len = len(left_orig)
    
    left = np.copy(left_orig) * 0.8
    right = np.copy(right_orig) * 0.8
    
    # Add deep warm sub-bass pad underneath the melancholy melody
    # Original Lost is around F minor / Bb minor / Eb
    sub_pads = [
        (0.0, 1.0, NOTE_MAP['F3']),
        (1.0, 1.1, NOTE_MAP['D#3']),
        (2.1, 1.2, NOTE_MAP['C#3']),
        (3.3, 1.8, NOTE_MAP['C3'])
    ]
    for start_t, dur, midi_n in sub_pads:
        freq = midi_to_freq(midi_n)
        t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
        sine_sub = np.sin(2 * np.pi * freq * t) * np.exp(-t * 0.5) * 0.28
        idx = int(start_t * SAMPLE_RATE)
        l_len = min(len(sine_sub), total_len - idx)
        if l_len > 0:
            left[idx:idx+l_len] += sine_sub[:l_len]
            right[idx:idx+l_len] += sine_sub[:l_len]
            
    # Add gentle ambient tape hiss / vinyl warmth
    t_full = np.linspace(0, total_len / SAMPLE_RATE, total_len)
    vinyl = (np.random.normal(0, 0.006, total_len) * (t_full < 6.5)).astype(np.float32)
    left += vinyl
    right += vinyl
    
    save_mp3(left, right, 'Songs/08_Lost_Neo_Chill.mp3')

def generate_pokemon_universal_victory():
    # The universal Pokémon Victory theme (Masuda):
    # Intro: G4-G4-G4 C5
    # Theme: E5-D5-C5-D5 E5-D5-C5-B4 C5...
    bpm = 148
    beat = 60.0 / bpm
    total_sec = 5.2
    total_samples = int(total_sec * SAMPLE_RATE)
    left = np.zeros(total_samples, dtype=np.float32)
    right = np.zeros(total_samples, dtype=np.float32)
    
    # Melody timeline (time_in_beats, dur_in_beats, midi_note)
    melody = [
        # Intro fanfare: G4 G4 G4 C5
        (0.0, 0.3, NOTE_MAP['G4']),
        (0.35, 0.3, NOTE_MAP['G4']),
        (0.70, 0.3, NOTE_MAP['G4']),
        (1.05, 1.0, NOTE_MAP['C5']),
        # Main theme: E5, D5, C5, D5, E5, D5, C5, B4, C5
        (2.10, 0.45, NOTE_MAP['E5']),
        (2.55, 0.35, NOTE_MAP['D5']),
        (2.90, 0.35, NOTE_MAP['C5']),
        (3.25, 0.35, NOTE_MAP['D5']),
        (3.60, 0.45, NOTE_MAP['E5']),
        (4.05, 0.45, NOTE_MAP['D5']),
        (4.50, 0.45, NOTE_MAP['C5']),
        (4.95, 0.45, NOTE_MAP['B4']),
        (5.40, 1.5, NOTE_MAP['C5']),
        (7.0, 1.2, NOTE_MAP['G5']),
        (8.2, 2.0, NOTE_MAP['C6'])
    ]
    
    for b_start, b_dur, midi_n in melody:
        t_start = b_start * beat
        t_dur = b_dur * beat
        idx = int(t_start * SAMPLE_RATE)
        freq = midi_to_freq(midi_n)
        synth_l = create_supersaw_note(freq, t_dur, detune_cents=10, decay=t_dur*0.5)
        synth_r = create_supersaw_note(freq, t_dur, detune_cents=-10, decay=t_dur*0.5)
        # Add brass layer (fundamental sine/tri)
        t = np.linspace(0, t_dur, len(synth_l), endpoint=False)
        brass = (np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(4 * np.pi * freq * t)) * np.exp(-t * 2.0)
        synth_l += brass * 0.4
        synth_r += brass * 0.4
        
        l_len = min(len(synth_l), total_samples - idx)
        if l_len > 0:
            left[idx:idx+l_len] += synth_l[:l_len] * 0.32
            right[idx:idx+l_len] += synth_r[:l_len] * 0.32
            
    # Add Modern Beat (Kicks, claps, sub bass)
    kick_beats = [1.05, 2.10, 3.60, 5.40, 7.0, 8.2]
    kick = create_sub_kick(0.4, 180, 44)
    for b in kick_beats:
        idx = int(b * beat * SAMPLE_RATE)
        l_len = min(len(kick), total_samples - idx)
        if l_len > 0:
            left[idx:idx+l_len] += kick[:l_len] * 0.7
            right[idx:idx+l_len] += kick[:l_len] * 0.7
            
    # Sub-bass root notes in C major (C, G, F, G, C)
    bass_notes = [
        (1.05, 1.0, NOTE_MAP['C3']),
        (2.10, 1.5, NOTE_MAP['C3']),
        (3.60, 1.8, NOTE_MAP['G3']),
        (5.40, 2.8, NOTE_MAP['C3'])
    ]
    for b_start, b_dur, midi_n in bass_notes:
        idx = int(b_start * beat * SAMPLE_RATE)
        dur = b_dur * beat
        t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
        f = midi_to_freq(midi_n)
        sub = np.sin(2 * np.pi * f * t) * np.exp(-t * 1.2) * 0.35
        l_len = min(len(sub), total_samples - idx)
        if l_len > 0:
            left[idx:idx+l_len] += sub[:l_len]
            right[idx:idx+l_len] += sub[:l_len]

    save_mp3(left, right, 'Songs/Win_Universal_Pokemon_Modern.mp3')

def generate_pokemon_universal_defeat():
    # The universal Pokémon Black Out / Debilitado theme:
    # Sad descending melody: D5 -> C5 -> Bb4 -> A4 -> G4 -> F4 -> E4 -> D4
    total_sec = 4.8
    total_samples = int(total_sec * SAMPLE_RATE)
    left = np.zeros(total_samples, dtype=np.float32)
    right = np.zeros(total_samples, dtype=np.float32)
    
    notes = [
        (0.0, 0.35, NOTE_MAP['D5']),
        (0.35, 0.35, NOTE_MAP['C5']),
        (0.70, 0.35, NOTE_MAP['A#4']),
        (1.05, 0.35, NOTE_MAP['A4']),
        (1.40, 0.35, NOTE_MAP['G4']),
        (1.75, 0.35, NOTE_MAP['F4']),
        (2.10, 0.40, NOTE_MAP['E4']),
        (2.50, 1.80, NOTE_MAP['D4'])
    ]
    
    for t_start, dur, midi_n in notes:
        idx = int(t_start * SAMPLE_RATE)
        freq = midi_to_freq(midi_n)
        t = np.linspace(0, dur, int(SAMPLE_RATE * dur), endpoint=False)
        # Modern Rhodes / Electric Piano sound (harmonic sines + slight decay)
        piano = (
            np.sin(2 * np.pi * freq * t) * 0.6 +
            np.sin(4 * np.pi * freq * t) * 0.25 +
            np.sin(6 * np.pi * freq * t) * 0.1
        ) * np.exp(-t * 2.2)
        
        # Stereo chorusing
        l_len = min(len(piano), total_samples - idx)
        if l_len > 0:
            left[idx:idx+l_len] += piano[:l_len] * 0.38
            right[idx:idx+l_len] += piano[:l_len] * 0.35
            
    # Dark D minor sustained chord at end (D3, A3, D4, F4)
    end_chord = [NOTE_MAP['D3'], NOTE_MAP['A3'], NOTE_MAP['D4'], NOTE_MAP['F4']]
    idx_end = int(2.50 * SAMPLE_RATE)
    dur_end = 2.0
    t_end = np.linspace(0, dur_end, int(SAMPLE_RATE * dur_end), endpoint=False)
    for midi_n in end_chord:
        freq = midi_to_freq(midi_n)
        pad = np.sin(2 * np.pi * freq * t_end) * np.exp(-t_end * 1.1) * 0.12
        l_len = min(len(pad), total_samples - idx_end)
        if l_len > 0:
            left[idx_end:idx_end+l_len] += pad[:l_len]
            right[idx_end:idx_end+l_len] += pad[:l_len]
            
    # Sub impact at start
    sub_drop = create_sub_kick(0.6, 140, 36)
    left[:len(sub_drop)] += sub_drop * 0.45
    right[:len(sub_drop)] += sub_drop * 0.45

    save_mp3(left, right, 'Songs/Lost_Universal_Pokemon_Modern.mp3')

if __name__ == '__main__':
    print("Generating modern Pokemon tracks...")
    generate_win_synthwave()
    generate_lost_neo_chill()
    generate_pokemon_universal_victory()
    generate_pokemon_universal_defeat()
    print("All modern tracks generated successfully!")
