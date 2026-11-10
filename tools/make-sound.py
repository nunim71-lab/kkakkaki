# 깍깍이 "깍깍!" 소리 만들기 (개발용, numpy 필요): python3 tools/make-sound.py public/kkak.wav
# 녹음이 아니라 직접 합성한 소리라 저작권 걱정 없음. (재잘이 소리와 같은 방법, 더 짧고 높게)
import sys, wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)

def caw(dur=0.34, f_start=640, f_peak=700, f_end=470, rasp=0.45, bright=1.0):
    n = int(SR * dur)
    t = np.arange(n) / SR
    u = t / dur
    # 음 높이: 살짝 올라갔다가 아래로 떨어지는 "까-악"
    f0 = np.where(u < 0.25, f_start + (f_peak - f_start) * (u / 0.25), f_peak + (f_end - f_peak) * np.clip((u - 0.25) / 0.75, 0, 1) ** 0.8)
    f0 = f0 * (1 + 0.012 * np.sin(2 * np.pi * 9 * t))          # 살짝 떨림
    phase = 2 * np.pi * np.cumsum(f0) / SR
    # "아" 모음처럼 들리게 배음마다 세기를 다르게 (formant)
    formants = [(1150 * bright, 220, 1.0), (1950 * bright, 300, 0.6), (3000 * bright, 420, 0.25)]
    sig = np.zeros(n)
    for h in range(1, 14):
        fh = f0 * h
        gain = sum(a * np.exp(-((fh - fc) / bw) ** 2) for fc, bw, a in formants) + 0.08 / h
        sig += gain * np.sin(h * phase)
    # 까마귀 특유의 거친 소리
    sig *= 1 + rasp * np.sin(2 * np.pi * 63 * t + rng.uniform(0, 6)) * rng.uniform(0.7, 1.0)
    # "ㄲ" 소리: 아주 짧은 잡음
    k = int(SR * 0.018)
    burst = rng.normal(0, 1, k) * np.linspace(1, 0, k) ** 2
    burst = np.convolve(burst, np.ones(6) / 6, mode='same')
    sig[:k] += 0.9 * burst
    # 소리 크기 변화 (빠르게 시작, 끝은 부드럽게)
    env = np.minimum(1, t / 0.012) * np.where(u < 0.6, 1, ((1 - u) / 0.4) ** 1.5)
    return sig * env

def save(path, parts, gap=0.09):
    audio = []
    for p in parts:
        audio.append(p)
        audio.append(np.zeros(int(SR * gap)))
    a = np.concatenate(audio)
    a = a / np.max(np.abs(a)) * 0.8
    pcm = (a * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# 깍깍이 소리: 재잘이(형)보다 높고 짧고 빠르게 "깍깍!" 두 번
save(sys.argv[1], [caw(0.17, 820, 900, 680, rasp=0.4, bright=1.12), caw(0.19, 800, 880, 640, rasp=0.42, bright=1.1)], gap=0.06)
