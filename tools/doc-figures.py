"""Figures du document « Vesper : génération du son ». Toutes les valeurs viennent du moteur (patches.js, patch-player.js)."""
import sys, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from scipy import signal
from scipy.io import wavfile

OUT = sys.argv[1]; WAV = sys.argv[2]
ORANGE, DARK, BLUE, GREEN, PURPLE = "#e07b2e", "#2b211b", "#3f7fb5", "#5f9b4a", "#8a5cb8"
MUTED, GRID, CREAM = "#7a6a5c", "#e6ddd2", "#f7efe5"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 13, "axes.edgecolor": MUTED, "axes.labelcolor": DARK,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.grid": True, "grid.color": GRID, "axes.spines.top": False,
    "axes.spines.right": False, "axes.titlelocation": "left", "axes.titlesize": 14, "legend.frameon": False})
rng = np.random.default_rng(7)
def save(fig, name):
    fig.savefig(f"{OUT}/{name}.png", dpi=100, facecolor="white"); plt.close(fig)

def box(ax, x, y, w, h, text, fc, ec=None, color=DARK, size=12, bold=False):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.02,rounding_size=0.08", fc=fc, ec=ec or fc, lw=1.5))
    ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=size, color=color, weight="bold" if bold else "normal")
def arrow(ax, x1, y1, x2, y2, color=MUTED):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle="-|>", mutation_scale=14, color=color, lw=1.5))
def canvas(h):
    fig = plt.figure(figsize=(11, h)); ax = fig.add_axes([0, 0, 1, 1]); ax.set_xlim(0, 11); ax.set_ylim(0, h); ax.axis("off"); return fig, ax

# 1. Une recette : trois couches du feu de camp
fig, ax = canvas(4.4)
ax.text(0.3, 4.05, "Feu de camp : trois couches qui jouent ensemble", fontsize=15, color=DARK)
cols = [("source", 0.3, 1.9), ("filtres", 2.5, 2.4), ("volume", 5.2, 1.5), ("stéréo", 7.0, 1.2)]
for name, x, w in cols: ax.text(x + w / 2, 3.55, name, ha="center", color=MUTED, fontsize=12)
rows = [("bruit brun", "passe-haut 40 Hz\n2 × passe-bas 160-300 Hz", "vacille\nde près seulement", "centre", 2.65),
        ("crépitements\n(événements)", "passe-bas 5 000 Hz", "× 1,3", "éparpillés", 1.55),
        ("bûches\n(événements)", "passe-bas 3 500 Hz", "× 1", "éparpillées", 0.45)]
for src, flt, vol, st, y in rows:
    box(ax, 0.3, y, 1.9, 0.85, src, "#f3d9c2"); arrow(ax, 2.2, y + 0.42, 2.5, y + 0.42)
    box(ax, 2.5, y, 2.4, 0.85, flt, CREAM, GRID); arrow(ax, 4.9, y + 0.42, 5.2, y + 0.42)
    box(ax, 5.2, y, 1.5, 0.85, vol, CREAM, GRID); arrow(ax, 6.7, y + 0.42, 7.0, y + 0.42)
    box(ax, 7.0, y, 1.2, 0.85, st, CREAM, GRID); arrow(ax, 8.2, y + 0.42, 8.85, 1.97)
box(ax, 8.85, 1.45, 1.85, 1.05, "sortie\n+5 dB", ORANGE, color="white", bold=True)
save(fig, "01-recette")

# 2. Les trois bruits (mêmes algorithmes que patch-player.js)
n = 48000 * 4; w = rng.uniform(-1, 1, n)
pink = np.zeros(n); b = np.zeros(7)
for i in range(n):
    x = w[i]
    b[0] = 0.99886 * b[0] + x * 0.0555179; b[1] = 0.99332 * b[1] + x * 0.0750759; b[2] = 0.969 * b[2] + x * 0.153852
    b[3] = 0.8665 * b[3] + x * 0.3104856; b[4] = 0.55 * b[4] + x * 0.5329522; b[5] = -0.7616 * b[5] - x * 0.016898
    pink[i] = (b[:6].sum() + b[6] + x * 0.5362) * 0.11; b[6] = x * 0.115926
brown = signal.lfilter([0.02 / 1.02], [1, -1 / 1.02], w) * 3.5
fig, ax = plt.subplots(figsize=(11, 5)); fig.subplots_adjust(left=0.08, right=0.97, top=0.88, bottom=0.14)
for sig, lab, col in [(w, "blanc", "#b9a999"), (pink, "rose (-3 dB par octave)", ORANGE), (brown, "brun (-6 dB par octave)", DARK)]:
    f, p = signal.welch(sig, 48000, nperseg=8192); m = (f > 20) & (f < 20000)
    db = 10 * np.log10(p[m]); db -= np.interp(1000, f[m], db)
    ax.semilogx(f[m], db, color=col, lw=2.4, label=lab)
ax.set_xlim(20, 20000); ax.set_ylim(-36, 30)
ax.set_xticks([50, 100, 200, 500, 1000, 2000, 5000, 10000]); ax.set_xticklabels(["50", "100", "200", "500", "1 k", "2 k", "5 k", "10 k"])
ax.set_xlabel("fréquence (Hz)"); ax.set_ylabel("niveau (dB, 0 à 1 kHz)")
ax.set_title("Les trois bruits de Vesper : la même énergie, répartie autrement"); ax.legend(loc="upper right")
ax.annotate("le brun garde surtout les graves :\ngrondement, flammes", (45, 17.5), (130, 22), color=MUTED, fontsize=11.5, arrowprops=dict(arrowstyle="-", color=MUTED))
save(fig, "02-bruits")

# 3. Quand tombent les événements
def next_interval(rate, reg, u): return (1 / rate) * ((1 - reg) * -np.log(1 - min(u, 0.999999)) + reg)
def sequence(rate, reg, burst, bmin, bmax, gap, amin, amax, skew, T=8):
    t, ev = 0.05, []
    while t < T:
        cnt = bmin + int(rng.random() * (bmax - bmin + 1)) if rng.random() < burst else 1
        tt = t
        for k in range(cnt):
            ev.append((tt, (amin + (amax - amin) * rng.random() ** skew) * (0.85 if cnt > 1 else 1)))
            tt += gap * (0.6 + 0.8 * rng.random() * (1 - reg) + 0.4 * reg)
        t += next_interval(rate, reg, rng.random())
    return [e for e in ev if e[0] < T]
rows = [("Régularité 0 : au hasard (6 par seconde)", sequence(6, 0, 0, 1, 1, 0.03, 0.4, 0.4, 1), BLUE),
        ("Régularité 1 : métronome, rafales de 2 (cœur à 72 battements/min)", sequence(1.2, 1, 1, 2, 2, 0.3, 0.8, 0.8, 1), PURPLE),
        ("Crépitements du feu : au hasard, rafales, beaucoup de petits (skew 4)", sequence(7, 0, 0.06, 2, 5, 0.03, 0.02, 0.3, 4), ORANGE)]
fig, axs = plt.subplots(3, 1, figsize=(11, 6), sharex=True); fig.subplots_adjust(left=0.05, right=0.98, top=0.93, bottom=0.1, hspace=0.55)
for ax, (title, ev, col) in zip(axs, rows):
    tt = [e[0] for e in ev]; aa = [e[1] for e in ev]
    ax.vlines(tt, 0, aa, color=col, lw=2); ax.set_ylim(0, max(aa) * 1.15 if max(aa) > 0 else 1)
    ax.set_title(title, fontsize=12.5, color=DARK); ax.set_yticks([]); ax.grid(axis="y", visible=False); ax.spines["left"].set_visible(False)
axs[-1].set_xlim(0, 8); axs[-1].set_xlabel("temps (s) ; la hauteur d'un trait est le volume du grain")
save(fig, "03-evenements")

# 4. Deux grains
sr = 48000
def grain_noise(freq, q, decay_ms, ms=25):
    t = np.arange(int(sr * ms / 1000)) / sr
    nz = rng.uniform(-1, 1, len(t)); bb, aa = signal.iirpeak(freq, q, sr) if q > 0 else (1, 1)
    x = signal.lfilter(bb, aa, nz); env = np.minimum(t / 0.002, 1) * np.exp(-np.maximum(t - 0.002, 0) / (decay_ms / 1000))
    return t * 1000, x / np.abs(x).max() * env
def grain_tone(f0, drop, decay_ms, ms):
    t = np.arange(int(sr * ms / 1000)) / sr; T = decay_ms / 1000 * 3
    f = np.where(t < T, f0 * (drop ** (np.minimum(t, T) / T)), f0 * drop); ph = 2 * np.pi * np.cumsum(f) / sr
    env = np.minimum(t / 0.002, 1) * np.exp(-np.maximum(t - 0.002, 0) / (decay_ms / 1000)); return t * 1000, np.sin(ph) * env, f
fig, axs = plt.subplots(1, 3, figsize=(11, 4)); fig.subplots_adjust(left=0.04, right=0.98, top=0.82, bottom=0.17, wspace=0.18)
t, x = grain_noise(2000, 0.8, 2.5, 20); axs[0].plot(t, x, color=ORANGE, lw=1.2); axs[0].set_title("Crépitement\ngrain de bruit, 2,5 ms", fontsize=12.5)
t, x, f = grain_tone(1000, 1.7, 12, 60); axs[1].plot(t, x, color=BLUE, lw=1.2); axs[1].set_title("Bulle de rivière\nnote qui monte (drop 1,7)", fontsize=12.5)
t, x, f = grain_tone(70, 0.55, 60, 300); axs[2].plot(t, x, color=PURPLE, lw=1.6); axs[2].set_title("Battement de cœur\nnote grave qui descend (drop 0,55)", fontsize=12.5)
for ax in axs: ax.set_yticks([]); ax.set_xlabel("ms"); ax.grid(axis="y", visible=False)
save(fig, "04-grains")

# 5. Modulations du vent : deux oscillations lentes + un vacillement sur le volume des rafales
T = 120; dt = 0.05; tt = np.arange(0, T, dt); ph1, ph2 = rng.uniform(0, 2 * np.pi, 2)
lfo = 1 + 0.4 * np.sin(ph2 + 2 * np.pi * 0.053 * tt)
jit = np.zeros_like(tt); target = 0; nxt = 0; v = 0; tc = 0.35 / 0.2 * 0.5
for i, t in enumerate(tt):
    if t >= nxt: target = rng.uniform(-1, 1); nxt = t + next_interval(0.2, 0.35, rng.random())
    v += (target - v) * (1 - np.exp(-dt / tc)); jit[i] = v
gain = 1.1 * lfo * (1 + 0.25 * jit)
fig, ax = plt.subplots(figsize=(11, 4.4)); fig.subplots_adjust(left=0.08, right=0.97, top=0.86, bottom=0.15)
ax.plot(tt, 1.1 * lfo, color=MUTED, lw=1.6, ls="--", label="oscillation seule (0,053 Hz)")
ax.plot(tt, gain, color=ORANGE, lw=2.2, label="avec le vacillement : ce qu'on entend")
ax.set_xlim(0, T); ax.set_xlabel("temps (s)"); ax.set_ylabel("volume des rafales")
ax.set_ylim(0.45, 2.25); ax.set_title("Vent, intensité 0,5 : le volume ne revient jamais deux fois au même endroit"); ax.legend(loc="upper right", ncol=2)
save(fig, "05-modulations")

# 6. Intensité : le feu de camp entre calme et maximum
I = np.linspace(0, 1, 101); lerp = lambda a, b: a + (b - a) * I
fig, axs = plt.subplots(1, 3, figsize=(11, 4)); fig.subplots_adjust(left=0.06, right=0.98, top=0.8, bottom=0.17, wspace=0.32)
for ax, (y, title, unit, col) in zip(axs, [(lerp(3, 10), "Crépitements", "par seconde", ORANGE), (lerp(160, 300), "Passe-bas du grondement", "Hz", DARK), (lerp(4, 8), "Chance de rafale", "%", BLUE)]):
    ax.plot(I, y, color=col, lw=2.6); ax.set_title(f"{title}\n({unit})", fontsize=12.5); ax.set_xlabel("intensité"); ax.set_xticks([0, 0.5, 1]); ax.set_xticklabels(["calme", "0,5", "max"])
    ax.axvline(0.45, color=MUTED, lw=1, ls=":")
axs[0].annotate("sans vent : 0,45", (0.45, 6.15), (0.5, 4), color=MUTED, fontsize=11)
fig.suptitle("Feu de camp : chaque paire {a, b} glisse avec le vent d'Ember", x=0.06, ha="left", fontsize=14, color=DARK)
save(fig, "06-intensite")

# 7. Couches de près
d = np.linspace(0, 1.6, 300); near = lambda nr: np.where(d < nr, (1 - d / nr) ** 2, 0)
fig, ax = plt.subplots(figsize=(11, 4.2)); fig.subplots_adjust(left=0.08, right=0.97, top=0.86, bottom=0.16)
ax.plot(d, near(1), color=ORANGE, lw=2.6, label="grondement du feu (near = 1 case)")
ax.plot(d, near(0.6), color=DARK, lw=2.6, ls="--", label="flamme de la torche (near = 0,6 case)")
ax.plot(d, np.ones_like(d), color=BLUE, lw=2, label="crépitements (toujours)")
ax.set_xlim(0, 1.6); ax.set_ylim(0, 1.08); ax.set_xticks(np.arange(0, 1.7, 0.2)); ax.set_xticklabels([f"{v:.1f}".replace(".", ",") for v in np.arange(0, 1.7, 0.2)]); ax.set_yticks(np.arange(0, 1.1, 0.2)); ax.set_yticklabels([f"{v:.1f}".replace(".", ",") for v in np.arange(0, 1.1, 0.2)]); ax.set_xlabel("distance à la source (cases)"); ax.set_ylabel("part de la couche")
ax.set_title("Seulement de près : (1 - distance / near)², avant l'atténuation normale de la distance"); ax.legend(loc="center right")
save(fig, "07-de-pres")

# 8. Programmation à l'avance
fig, ax = canvas(3.8)
ax.text(0.3, 3.45, "Le minuteur réveille, l'horloge audio joue à l'heure", fontsize=15, color=DARK)
x0, sc = 0.6, 9.6 / 1.2
ax.plot([x0, x0 + 1.2 * sc], [1.0, 1.0], color=MUTED, lw=1.5)
for k in range(13): ax.plot([x0 + k * 0.1 * sc] * 2, [0.92, 1.08], color=MUTED, lw=1)
for k, lab in [(0, "0"), (4, "0,4 s"), (8, "0,8 s"), (12, "1,2 s")]: ax.text(x0 + k * 0.1 * sc, 0.62, lab, ha="center", color=MUTED, fontsize=11)
ax.text(x0, 0.25, "horloge audio", color=MUTED, fontsize=11)
wakes = [0.0, 0.1, 0.2, 0.37, 0.4]  # un réveil en retard (Foundry dessine la carte)
for i, wv in enumerate(wakes):
    y = 2.75 - i * 0.33
    ax.plot([x0 + wv * sc] * 2, [y - 0.08, y + 0.08], color=DARK, lw=2)
    ax.add_patch(FancyBboxPatch((x0 + wv * sc, y - 0.07), 0.4 * sc, 0.14, boxstyle="round,pad=0,rounding_size=0.05", fc="#f3d9c2" if wv != 0.37 else "#f2c1a0", ec="none"))
ax.text(x0 + 0.4 * sc + 0.15, 2.75, "réveil toutes les 100 ms : programme les 0,4 s suivantes", color=DARK, fontsize=11.5, va="center")
ax.text(x0 + 0.77 * sc + 0.15, 1.76, "réveil en retard : rien ne manque", color=ORANGE, fontsize=11.5, va="center")
ev = [0.07, 0.19, 0.22, 0.31, 0.46, 0.58, 0.61, 0.83, 0.97, 1.1]
for e in ev: ax.plot([x0 + e * sc] * 2, [1.0, 1.32], color=ORANGE, lw=2.4)
ax.text(x0 + 1.2 * sc, 1.42, "grains joués à leur instant exact", color=ORANGE, fontsize=11.5, ha="right")
save(fig, "08-programmation")

# 9. Du lecteur à l'oreille
fig, ax = canvas(2.9)
ax.text(0.3, 2.55, "Un son procédural suit le même chemin qu'un fichier", fontsize=15, color=DARK)
steps = [("lecteur\nprocédural", 0.3, 1.5, ORANGE, "white"), ("passe-bas\nair et murs", 2.15, 1.6, CREAM, DARK), ("volume\ndistance", 4.1, 1.4, CREAM, DARK), ("panoramique\nHRTF", 5.85, 1.6, CREAM, DARK)]
for txt, x, wd, fc, tc in steps: box(ax, x, 1.05, wd, 0.95, txt, fc, GRID if fc == CREAM else None, color=tc, bold=fc == ORANGE)
for a, b2 in [(1.8, 2.15), (3.75, 4.1), (5.5, 5.85)]: arrow(ax, a, 1.52, b2, 1.52)
box(ax, 8.15, 1.6, 2.5, 0.65, "son direct", "#f3d9c2"); box(ax, 8.15, 0.55, 2.5, 0.65, "réverbération du lieu", "#d9e6f2")
arrow(ax, 7.45, 1.6, 8.15, 1.92); arrow(ax, 7.45, 1.4, 8.15, 0.88)
ax.text(2.15, 0.6, "intensité et distance renvoyées au lecteur à chaque mise à jour", color=MUTED, fontsize=11)
save(fig, "09-chaine")

# 10. Le vrai feu, rendu par le moteur
fig, axs = plt.subplots(2, 1, figsize=(11, 6.4), sharex=True); fig.subplots_adjust(left=0.08, right=0.97, top=0.9, bottom=0.1, hspace=0.35)
for ax, (fn, title) in zip(axs, [("fire-0.2.wav", "Intensité 0,2 (vent faible)"), ("fire-0.9.wav", "Intensité 0,9 (vent fort)")]):
    srw, data = wavfile.read(f"{WAV}/{fn}"); data = data.astype(float); data = data.mean(axis=1) if data.ndim > 1 else data
    data /= 32768 if np.abs(data).max() > 2 else 1
    f, t, S = signal.spectrogram(data, srw, nperseg=1024, noverlap=768)
    m = f <= 8000; Sdb = 10 * np.log10(S[m] + 1e-12)
    ax.pcolormesh(t, f[m] / 1000, Sdb, cmap="inferno", vmin=Sdb.max() - 75, vmax=Sdb.max(), shading="auto", rasterized=True)
    ax.set_title(title, fontsize=12.5); ax.set_ylabel("kHz"); ax.grid(False)
axs[-1].set_xlabel("temps (s)")
fig.suptitle("Le feu de camp calculé par Vesper, à 0,3 case : chaque trait vertical est un crépitement", x=0.08, ha="left", fontsize=14, color=DARK)
save(fig, "10-feu-reel")
print("ok")
