/*
 * A generative score, synthesized like everything else. Five layers share one
 * clock and fade in with intensity: a gliding minor pad, a sparse pentatonic
 * pluck through a delay, a sub pulse, soft drums, and a fast ostinato on top.
 * Notes are scheduled slightly ahead of the audio clock from a timer, so the
 * main thread's jitter never reaches the rhythm.
 */

/* How far ahead notes are committed, and how often the timer tops them up. */
const LOOKAHEAD = 0.12;
const INTERVAL_MS = 25;
/* Short-lived voices beyond this are dropped; stingers and swells ignore it. */
const MAX_VOICES = 40;
/* Final level into the destination: peaks near 0.2 at full intensity. */
const LEVEL = 0.2;
const BPM_LOW = 72;
const BPM_HIGH = 98;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const ramp = (x: number, a: number, b: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

/* Voicings sit in one register and move by small steps, so gliding drone voices
 * between them reads as voice leading rather than portamento. */
type Chord = { pad: number[]; root: number };
const DM: Chord = { pad: [57, 62, 65, 69], root: 38 };
const DM9: Chord = { pad: [57, 64, 65, 69], root: 38 };
const BBMAJ7: Chord = { pad: [57, 62, 65, 70], root: 34 };
const FMAJ: Chord = { pad: [57, 60, 65, 69], root: 41 };
const CMAJ: Chord = { pad: [55, 60, 64, 67], root: 36 };
const CSUS2: Chord = { pad: [55, 60, 62, 67], root: 36 };
const GM: Chord = { pad: [58, 62, 67, 70], root: 43 };

/* Aeolian loops in D, a chord every two bars, eight bars per phrase. */
const PROGRESSIONS: Chord[][] = [
  [DM, BBMAJ7, FMAJ, CMAJ],
  [DM9, BBMAJ7, GM, CSUS2],
  [DM, GM, BBMAJ7, CMAJ],
  [DM9, FMAJ, CSUS2, BBMAJ7],
];

/* D minor pentatonic, D4 to D6: it sits over every chord above. */
const SCALE = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86];

type Slot = { degree: number; gate: number; long: boolean };

export class Score {
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  private readonly enableGain: GainNode;
  /* [dry, reverb send] pairs, so a fade or duck also catches the reverb input. */
  private readonly gate: GainNode[];
  private readonly duck: GainNode[];
  private readonly musicBus: GainNode;
  private readonly musicRev: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly stingerBus: GainNode;
  private readonly stingerRev: GainNode;

  private readonly padFilter: BiquadFilterNode;
  private readonly padGain: GainNode;
  private readonly padPans: StereoPannerNode[];
  private readonly melodyBus: GainNode;
  private readonly melodyGain: GainNode;
  private readonly delay: DelayNode;
  private readonly delayIn: GainNode;
  private readonly subGain: GainNode;
  private readonly subFilter: BiquadFilterNode;
  private readonly drumGain: GainNode;
  private readonly hatFilter: BiquadFilterNode;
  private readonly ostGain: GainNode;
  private readonly ostFilter: BiquadFilterNode;
  private readonly glass: PeriodicWave;
  private readonly noise: AudioBuffer;

  private padVoices: OscillatorNode[][] = [];
  private longLived: OscillatorNode[] = [];
  private drone: OscillatorNode | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private enabled = true;
  private disposed = false;
  private stalled = false;
  private voices = 0;
  private seed: number;

  private target = 0;
  private level = 0;
  private floor = 0;
  private lastNow = 0;
  private lastMix = -1;

  private nextTime = 0;
  private stepDur = 15 / BPM_LOW;
  private sixteenth = 0;
  private bar = 0;
  private progIndex = 0;
  private progression = PROGRESSIONS[0];
  private chord = DM;
  private motif: Slot[] = [];
  private ostinato: number[] = [];

  /* `seed` is optional; pass the round seed to make the score repeatable. */
  constructor(ctx: BaseAudioContext, destination: AudioNode, seed = 0x51de) {
    this.ctx = ctx;
    this.seed = seed >>> 0 || 1;
    const gain = (value: number, to?: AudioNode) => {
      const g = ctx.createGain();
      g.gain.value = value;
      if (to) g.connect(to);
      return g;
    };
    const filter = (type: BiquadFilterType, freq: number, q = 0.7, to?: AudioNode) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      if (to) f.connect(to);
      return f;
    };

    this.out = gain(LEVEL, destination);
    this.enableGain = gain(1, this.out);

    /* Shared reverb: a convolver over three seconds of decaying noise, darkened
     * so it reads as night air rather than a bright hall. */
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.impulse(3);
    this.convolver
      .connect(filter("highpass", 160))
      .connect(filter("lowpass", 4200))
      .connect(gain(1, this.enableGain));

    this.gate = [gain(0, this.enableGain), gain(0, this.convolver)];
    this.duck = [gain(1, this.gate[0]), gain(1, this.gate[1])];
    this.musicBus = this.duck[0];
    this.musicRev = this.duck[1];
    this.stingerBus = gain(1, this.enableGain);
    this.stingerRev = gain(0.7, this.convolver);
    this.stingerBus.connect(this.stingerRev);

    /* Pad: detuned saw pairs split left and right, one breathing lowpass. */
    this.padGain = gain(0, this.musicBus);
    this.padGain.connect(gain(0.55, this.musicRev));
    this.padFilter = filter("lowpass", 500, 0.9, this.padGain);
    this.padPans = [-0.45, 0.45].map((p) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p;
      pan.connect(this.padFilter);
      return pan;
    });

    /* Pluck melody: dotted-eighth feedback delay, filtered so repeats darken. */
    this.melodyGain = gain(0, this.musicBus);
    this.melodyGain.connect(gain(0.5, this.musicRev));
    this.melodyBus = gain(1);
    this.melodyBus.connect(filter("lowpass", 2600, 0.5, this.melodyGain));
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 45 / BPM_LOW;
    this.delayIn = gain(0.32, this.delay);
    this.melodyGain.connect(this.delayIn);
    const delayTone = filter("lowpass", 1800, 0.5);
    this.delay.connect(delayTone);
    delayTone.connect(gain(0.42, this.delay));
    const delayOut = ctx.createStereoPanner();
    delayOut.pan.value = 0.35;
    delayTone.connect(delayOut);
    delayOut.connect(this.musicBus);
    delayOut.connect(gain(0.4, this.musicRev));

    this.subGain = gain(0, this.musicBus);
    this.subFilter = filter("lowpass", 240, 0.8, this.subGain);

    this.drumGain = gain(0, this.musicBus);
    const hatPan = ctx.createStereoPanner();
    hatPan.pan.value = -0.25;
    hatPan.connect(this.drumGain);
    hatPan.connect(gain(0.15, this.musicRev));
    this.hatFilter = filter("highpass", 6500, 0.8, hatPan);

    this.ostGain = gain(0, this.musicBus);
    this.ostGain.connect(gain(0.25, this.delayIn));
    this.ostGain.connect(gain(0.2, this.musicRev));
    this.ostFilter = filter("lowpass", 900, 4, this.ostGain);

    /* A glassy partial mix for the pluck: one oscillator per note. */
    const real = new Float32Array(7);
    const imag = new Float32Array([0, 1, 0.32, 0.12, 0.1, 0.03, 0.04]);
    this.glass = ctx.createPeriodicWave(real, imag);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this.rand() * 2 - 1;
  }

  /* Begins scheduling. The context may still be suspended; nothing is queued
   * until it runs. */
  start() {
    if (this.disposed || this.running) return;
    this.running = true;
    const t = this.ctx.currentTime;
    this.bar = 0;
    this.sixteenth = 0;
    this.progIndex = 0;
    this.progression = PROGRESSIONS[0];
    this.chord = this.progression[0];
    this.newPhrase();
    this.startDrones(t);
    this.applyMix(t, 0.05);
    this.fade(this.gate, 1, t, 1.2);
    this.nextTime = t + 0.1;
    this.lastNow = t;
    this.stalled = false;
    this.timer = setInterval(this.tick, INTERVAL_MS);
  }

  stop() {
    if (this.disposed || !this.running) return;
    this.running = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const t = this.ctx.currentTime;
    this.fade(this.gate, 0, t, 1.5);
    for (const osc of this.longLived) osc.stop(t + 1.6);
    this.longLived = [];
    this.padVoices = [];
    this.drone = null;
    this.floor = 0;
  }

  setEnabled(on: boolean) {
    if (this.disposed || on === this.enabled) return;
    this.enabled = on;
    this.enableGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.25);
  }

  setIntensity(v: number) {
    if (Number.isFinite(v)) this.target = clamp01(v);
  }

  /* The sea is surging: the current chord swells up through an opening filter,
   * with a low root underneath, then falls back over about four seconds. */
  surge() {
    if (!this.audible()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const amt = 0.55 + 0.45 * this.level;
    const sweep = ctx.createBiquadFilter();
    sweep.type = "lowpass";
    sweep.Q.value = 3;
    sweep.frequency.setValueAtTime(220, t);
    sweep.frequency.exponentialRampToValueAtTime(2800, t + 2.2);
    sweep.frequency.exponentialRampToValueAtTime(300, t + 4.2);
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(0.0001, t);
    swell.gain.exponentialRampToValueAtTime(0.09 * amt, t + 2);
    swell.gain.exponentialRampToValueAtTime(0.0001, t + 4.3);
    sweep.connect(swell);
    swell.connect(this.musicBus);
    swell.connect(this.musicRev);
    for (const [k, m] of this.chord.pad.entries()) {
      this.osc("sawtooth", mtof(m), t, t + 4.3, sweep, k % 2 ? 6 : -6);
    }
    this.osc("sawtooth", mtof(this.chord.root + 12), t, t + 4.3, sweep);
    this.voice({
      type: "sine",
      freq: mtof(this.chord.root),
      t,
      peak: 0.4 * amt,
      attack: 1.9,
      decay: 2.45,
      dest: this.musicBus,
      force: true,
      release: [sweep, swell],
    });
  }

  stinger(kind: "win" | "drowned" | "final") {
    if (!this.audible()) return;
    const t = this.ctx.currentTime + 0.02;
    if (kind === "win") this.win(t);
    else if (kind === "drowned") this.drowned(t);
    else this.final(t);
  }

  dispose() {
    if (this.disposed) return;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const osc of this.longLived) {
      try {
        osc.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.longLived = [];
    this.padVoices = [];
    this.running = false;
    this.disposed = true;
    this.out.disconnect();
  }

  /* --- clock --- */

  private tick = () => {
    if (this.ctx.state !== "running") {
      this.stalled = true;
      return;
    }
    this.schedule(this.ctx.currentTime);
  };

  private schedule(now: number) {
    this.smooth(now);
    /* After a suspend or a throttled timer, jump forward instead of firing every
     * missed note at once. */
    if (this.stalled || this.nextTime < now) {
      if (this.nextTime < now + 0.02) this.nextTime = now + 0.05;
      this.stalled = false;
    }
    while (this.nextTime < now + LOOKAHEAD) this.step(this.nextTime);
  }

  private smooth(now: number) {
    const dt = Math.min(0.5, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    const target = Math.max(this.target, this.floor);
    const tc = target > this.level ? 2.5 : 6;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tc));
    if (Math.abs(this.level - this.lastMix) > 0.004) this.applyMix(now, 0.4);
  }

  private applyMix(t: number, tc: number) {
    const i = this.level;
    this.lastMix = i;
    this.padGain.gain.setTargetAtTime(0.055 * (1 - 0.2 * i), t, tc);
    this.padFilter.frequency.setTargetAtTime(480 + 1500 * i ** 1.3, t, tc);
    this.melodyGain.gain.setTargetAtTime(0.75 + 0.25 * i, t, tc);
    this.subGain.gain.setTargetAtTime(ramp(i, 0.12, 0.4), t, tc);
    this.drumGain.gain.setTargetAtTime(ramp(i, 0.42, 0.65), t, tc);
    this.ostGain.gain.setTargetAtTime(ramp(i, 0.7, 0.92), t, tc);
    this.ostFilter.frequency.setTargetAtTime(700 + 2600 * ramp(i, 0.7, 1), t, tc);
  }

  private step(t: number) {
    const s = this.sixteenth;
    if (s === 0) this.onBar(t);
    if (this.enabled) this.play(t, s);
    this.nextTime += this.stepDur;
    if (++this.sixteenth === 16) {
      this.sixteenth = 0;
      this.bar++;
    }
  }

  /* Tempo, chord and phrase only change on the barline. */
  private onBar(t: number) {
    const bpm = BPM_LOW + (BPM_HIGH - BPM_LOW) * this.level;
    this.stepDur = 15 / bpm;
    this.delay.delayTime.setTargetAtTime(45 / bpm, t, 0.5);
    const phrase = this.bar % 8;
    if (phrase === 0 && this.bar > 0) {
      this.progIndex = (this.progIndex + 1 + Math.floor(this.rand() * 3)) % PROGRESSIONS.length;
      this.progression = PROGRESSIONS[this.progIndex];
      this.newPhrase();
    } else if (phrase % 2 === 0) this.vary();
    if (this.bar % 2 === 0) this.setChord(this.progression[phrase / 2], t);
  }

  private setChord(chord: Chord, t: number) {
    this.chord = chord;
    for (const [v, pair] of this.padVoices.entries()) {
      for (const osc of pair) osc.frequency.setTargetAtTime(mtof(chord.pad[v]), t, 0.2);
    }
    this.drone?.frequency.setTargetAtTime(mtof(chord.root + 12), t, 0.25);
  }

  /* A two-bar motif, kept for a phrase so the melody repeats like a melody. Each
   * slot carries a gate threshold, so intensity thins or fills the same line. */
  private newPhrase() {
    let degree = 3 + Math.floor(this.rand() * 3);
    this.motif = [];
    for (let k = 0; k < 16; k++) {
      const steps = [-2, -1, -1, 0, 1, 1, 2];
      degree = Math.min(9, Math.max(0, degree + steps[Math.floor(this.rand() * steps.length)]));
      const strong = k % 4 === 0;
      this.motif.push({
        degree,
        gate: this.rand() * (strong ? 0.6 : 1),
        long: this.rand() < 0.3,
      });
    }
    this.motif[0].gate = 0;
    this.ostinato = [];
    for (let k = 0; k < 16; k++) {
      this.ostinato.push(k % 4 === 0 ? (k % 8) / 4 : Math.floor(this.rand() * 4));
    }
  }

  private vary() {
    const slot = this.motif[Math.floor(this.rand() * this.motif.length)];
    slot.degree = Math.min(9, Math.max(0, slot.degree + (this.rand() < 0.5 ? -1 : 1)));
  }

  private play(t: number, s: number) {
    const i = this.level;
    const beat = this.stepDur * 4;

    if (s % 2 === 0) {
      const slot = this.motif[(this.bar % 2) * 8 + s / 2];
      if (slot.gate < 0.16 + 0.4 * i) {
        const lift = i > 0.8 && this.bar % 4 === 3 ? 12 : 0;
        this.pluck(
          t + this.rand() * 0.008,
          mtof(SCALE[slot.degree] + lift),
          (s === 0 ? 1 : 0.7 + 0.3 * this.rand()) * 0.36,
          (slot.long ? 2.2 : 1.3) - 0.6 * i,
        );
      }
    }

    if (i > 0.12) {
      const root = mtof(this.chord.root);
      if (i < 0.55) {
        if (s === 0 || s === 8) this.sub(t, root, 0.36, beat * 1.8);
      } else if (i < 0.8) {
        if (s % 4 === 0) this.sub(t, root, 0.32, beat * 0.85);
        else if (s % 4 === 3 && this.rand() < 0.4) this.sub(t, root, 0.18, beat * 0.2);
      } else if (s % 2 === 0) {
        this.sub(t, root, s % 4 === 0 ? 0.26 : 0.34, beat * 0.42);
      }
    }

    if (i > 0.42) {
      if (s === 0 || s === 8 || (i > 0.65 && s % 4 === 0)) this.kick(t, s === 0 ? 1 : 0.8);
      if (s % 4 === 2) this.hat(t, 0.9, i > 0.75 ? 0.07 : 0.04);
      else if (i > 0.75 && s % 2 === 1 && this.rand() < 0.3 + 0.6 * (i - 0.75)) {
        this.hat(t, 0.4 + 0.3 * this.rand(), 0.025);
      }
    }

    if (i > 0.7) {
      const m = this.chord.pad[this.ostinato[s]] + 12;
      this.voice({
        type: "sawtooth",
        freq: mtof(m),
        t,
        peak: s % 4 === 0 ? 0.17 : 0.11,
        attack: 0.004,
        decay: 0.13,
        dest: this.ostFilter,
      });
    }
  }

  /* --- instruments --- */

  private startDrones(t: number) {
    const chord = this.chord;
    this.padVoices = chord.pad.map((m) =>
      [-7, 7].map((cents, k) => {
        const osc = this.osc("sawtooth", mtof(m), t, null, this.padPans[k], cents);
        this.longLived.push(osc);
        return osc;
      }),
    );
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 1.4;
    droneGain.connect(this.padFilter);
    this.drone = this.osc("triangle", mtof(chord.root + 12), t, null, droneGain);
    this.longLived.push(this.drone);

    /* A very slow LFO on the pad cutoff, so the bed never sits still. */
    const depth = this.ctx.createGain();
    depth.gain.value = 260;
    depth.connect(this.padFilter.frequency);
    this.longLived.push(this.osc("sine", 0.043, t, null, depth));
  }

  private pluck(t: number, freq: number, peak: number, decay: number) {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = this.rand() * 0.8 - 0.4;
    pan.connect(this.melodyBus);
    const g = this.voice({
      wave: this.glass,
      freq,
      t,
      peak,
      attack: 0.005,
      decay,
      dest: pan,
      release: [pan],
    });
    if (!g) pan.disconnect();
  }

  private sub(t: number, freq: number, peak: number, decay: number) {
    this.voice({ type: "triangle", freq, t, peak, attack: 0.015, decay, dest: this.subFilter });
  }

  private kick(t: number, vel: number) {
    this.voice({
      type: "sine",
      freq: 130,
      to: 44,
      glide: 0.11,
      t,
      peak: 0.3 * vel,
      attack: 0.004,
      decay: 0.34,
      dest: this.drumGain,
    });
  }

  private hat(t: number, vel: number, decay: number) {
    if (this.voices >= MAX_VOICES) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.07 * vel, 0.001, decay);
    src.connect(g).connect(this.hatFilter);
    this.track(src, g);
    src.start(t, this.rand() * 0.9);
    src.stop(t + decay + 0.03);
  }

  private win(t: number) {
    this.floor = 0;
    this.duckFor(t, 0.3, 2, 1.5);
    /* D major with an added ninth: the minor home key, finally resolved. */
    for (const [k, m] of [50, 57, 62, 66, 69, 76].entries()) {
      const at = t + k * 0.09;
      this.voice({
        type: "triangle",
        freq: mtof(m),
        t: at,
        peak: 0.13,
        attack: 0.06,
        decay: 3.6,
        dest: this.stingerBus,
        force: true,
      });
      this.voice({
        wave: this.glass,
        freq: mtof(m + 12),
        t: at,
        peak: 0.045,
        attack: 0.01,
        decay: 2.4,
        dest: this.stingerBus,
        force: true,
      });
    }
    this.voice({
      type: "sine",
      freq: mtof(38),
      t,
      peak: 0.3,
      attack: 0.4,
      decay: 3.5,
      dest: this.stingerBus,
      force: true,
    });
  }

  private drowned(t: number) {
    this.floor = 0;
    this.duckFor(t, 0.2, 1.4, 1.2);
    /* Falling through A, F, D to a low A, heard as if from under the water. */
    const muffle = this.ctx.createBiquadFilter();
    muffle.type = "lowpass";
    muffle.frequency.setValueAtTime(1400, t);
    muffle.frequency.exponentialRampToValueAtTime(380, t + 2.5);
    muffle.connect(this.stingerBus);
    for (const [k, m] of [69, 65, 62, 45].entries()) {
      const f = mtof(m);
      this.voice({
        type: "triangle",
        freq: f,
        to: f * 0.97,
        glide: 1,
        t: t + k * 0.32,
        peak: k === 3 ? 0.32 : 0.22,
        attack: 0.02,
        decay: k === 3 ? 2.6 : 1.1,
        dest: muffle,
        force: true,
        release: k === 3 ? [muffle] : [],
      });
    }
  }

  /* Two left: a hit, then the score holds near full intensity. */
  private final(t: number) {
    this.floor = 0.9;
    this.level = Math.max(this.level, 0.8);
    this.applyMix(this.ctx.currentTime, 0.2);
    this.voice({
      type: "sine",
      freq: 92,
      to: 32,
      glide: 1.2,
      t,
      peak: 0.6,
      attack: 0.005,
      decay: 1.8,
      dest: this.stingerBus,
      force: true,
    });
    const stab = this.ctx.createBiquadFilter();
    stab.type = "lowpass";
    stab.Q.value = 2;
    stab.frequency.setValueAtTime(4200, t);
    stab.frequency.exponentialRampToValueAtTime(260, t + 1.6);
    stab.connect(this.stingerBus);
    for (const [k, m] of [38, 50, 57, 62, 65].entries()) {
      this.voice({
        type: "sawtooth",
        freq: mtof(m),
        t,
        peak: 0.09,
        attack: 0.006,
        decay: 2.2,
        dest: stab,
        detune: k % 2 ? 8 : -8,
        force: true,
        release: k === 4 ? [stab] : [],
      });
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const g = this.ctx.createGain();
    this.env(g.gain, t, 0.25, 0.003, 0.7);
    src.connect(g).connect(stab);
    this.track(src, g);
    src.start(t);
    src.stop(t + 0.8);
  }

  /* --- plumbing --- */

  private audible() {
    return !this.disposed && this.enabled;
  }

  private voice(o: {
    type?: OscillatorType;
    wave?: PeriodicWave;
    freq: number;
    to?: number;
    glide?: number;
    t: number;
    peak: number;
    attack: number;
    decay: number;
    dest: AudioNode;
    detune?: number;
    force?: boolean;
    release?: AudioNode[];
  }): GainNode | null {
    if (!o.force && this.voices >= MAX_VOICES) return null;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave);
    else osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, o.t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, o.t + (o.glide ?? o.decay));
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    this.env(g.gain, o.t, o.peak, o.attack, o.decay);
    osc.connect(g).connect(o.dest);
    this.track(osc, g, ...(o.release ?? []));
    osc.start(o.t);
    osc.stop(o.t + o.attack + o.decay + 0.05);
    return g;
  }

  /* Long-lived (end null) or fixed-length oscillator with no envelope. */
  private osc(
    type: OscillatorType,
    freq: number,
    t: number,
    end: number | null,
    dest: AudioNode,
    cents = 0,
  ) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = cents;
    osc.connect(dest);
    osc.start(t);
    if (end !== null) osc.stop(end);
    return osc;
  }

  /* Counts the voice and unhooks its nodes (plus any per-note extras) once it ends. */
  private track(src: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
    this.voices++;
    src.onended = () => {
      this.voices--;
      for (const n of nodes) n.disconnect();
    };
  }

  private env(param: AudioParam, t: number, peak: number, attack: number, decay: number) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private fade(nodes: GainNode[], to: number, t: number, over: number) {
    for (const g of nodes) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(to, t + over);
    }
  }

  private duckFor(t: number, depth: number, hold: number, release: number) {
    for (const g of this.duck) {
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(depth, t + 0.12);
      g.gain.setValueAtTime(depth, t + hold);
      g.gain.setTargetAtTime(1, t + hold, release / 3);
    }
  }

  private impulse(seconds: number) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    /* -60 dB at the end of the buffer, with a short predelay. */
    const k = 6.9 / seconds;
    const pre = Math.floor(rate * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = pre; i < len; i++) {
        data[i] = (this.rand() * 2 - 1) * Math.exp((-k * (i - pre)) / rate);
      }
    }
    return buf;
  }

  /* LCG: the score is repeatable for a seed but never loops audibly. */
  private rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
