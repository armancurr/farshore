import { type WeaponKind, weaponDef } from "../shared/weapons";

/*
 * Every sound is synthesized: noise through filters for the sea and wind,
 * enveloped sines for thumps.
 * Nothing to download.
 */
/* How each weapon sounds (its heft): big slow whooshes, quick whistles, and blunt thuds. */
const heftOf = (kind: WeaponKind | null) => (kind ? weaponDef(kind).heft : null);

export class TideAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private seaGain!: GainNode;
  private seaFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;
  private lastHeart = 0;
  private motorOscillator: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private motorFilter: BiquadFilterNode | null = null;
  /* The crackle of fires nearby: a loop of pops and hiss, louder the nearer the flames. */
  private fireGain: GainNode | null = null;

  get isMuted() {
    return this.muted;
  }

  /* Must be called from a user gesture. */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 5;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 18000;
    this.muffle.connect(this.master);

    /* Two seconds of brown noise, looped, feeds every wash and splash. */
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }

    const sea = ctx.createBufferSource();
    sea.buffer = this.noise;
    sea.loop = true;
    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = "lowpass";
    this.seaFilter.frequency.value = 500;
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0;
    sea.connect(this.seaFilter).connect(this.seaGain).connect(this.muffle);
    sea.start();

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    wind.playbackRate.value = 1.7;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 900;
    windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(windFilter).connect(this.windGain).connect(this.muffle);
    wind.start();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    void this.ctx?.resume();
  }

  close() {
    void this.ctx?.close();
    this.ctx = null;
    this.motorOscillator = null;
    this.motorGain = null;
    this.motorFilter = null;
    this.fireGain = null;
  }

  /*
   * Fires nearby, 0 (none) to 1 (standing in one). The loop is made once:
   * two seconds of sparse pops and snaps over a low roar, played on repeat.
   */
  crackle(level: number) {
    const ctx = this.ctx;
    if (!ctx || (level <= 0 && !this.fireGain)) return;
    if (!this.fireGain) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let roar = 0;
      for (let i = 0; i < len; i++) {
        roar = (roar + 0.04 * (Math.random() * 2 - 1)) / 1.04;
        data[i] = roar * 2.2;
      }
      /* Pops: a few hundred little decaying clicks, some of them sharp snaps. */
      for (let k = 0; k < 260; k++) {
        const at = Math.floor(Math.random() * (len - 2000));
        const snap = Math.random() < 0.12;
        const amp = snap ? 0.9 : 0.15 + Math.random() * 0.35;
        const decay = snap ? 0.0015 : 0.0006;
        for (let i = 0; i < 1800; i++)
          data[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i * decay * 40);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 180;
      this.fireGain = ctx.createGain();
      this.fireGain.gain.value = 0;
      src.connect(filter).connect(this.fireGain).connect(this.muffle);
      src.start();
    }
    this.fireGain.gain.setTargetAtTime(Math.min(1, level) * 0.32, ctx.currentTime, 0.25);
  }

  /* Something built coming down: a deep crash, then the rubble settling. */
  collapse(near = 1) {
    const k = Math.max(0.1, near);
    this.tone(60, 28, 0.6 * k, 0.01, 1.1, "triangle");
    this.noiseBurst({
      type: "lowpass",
      freq: 700,
      to: 90,
      peak: 0.6 * k,
      attack: 0.01,
      decay: 1.4,
      rate: 0.6,
    });
    for (const [i, at] of [140, 330, 520, 760].entries())
      setTimeout(
        () =>
          this.noiseBurst({
            type: "bandpass",
            freq: 600 + i * 250,
            to: 200,
            q: 1.2,
            peak: 0.22 * k,
            attack: 0.004,
            decay: 0.25,
            rate: 1.3,
          }),
        at,
      );
  }

  /* A blow on something built: a dry crack off timber, a dull knock and a chip of grit off stone. */
  knock(stone: boolean, near = 1) {
    const k = Math.max(0.12, near);
    if (stone) {
      this.tone(160, 90, 0.35 * k, 0.003, 0.14, "triangle");
      this.noiseBurst({ type: "highpass", freq: 2400, peak: 0.16 * k, attack: 0.002, decay: 0.09 });
      this.ring(2300, 0.025 * k, 0.08);
    } else {
      this.tone(130, 70, 0.32 * k, 0.003, 0.16, "triangle");
      this.noiseBurst({
        type: "bandpass",
        freq: 1700,
        to: 700,
        q: 1.6,
        peak: 0.35 * k,
        attack: 0.002,
        decay: 0.11,
        rate: 1.6,
      });
    }
  }

  /* Water on flames: a long falling hiss. */
  hiss(near = 1) {
    const k = Math.max(0.1, near);
    this.noiseBurst({
      type: "highpass",
      freq: 3800,
      to: 1500,
      peak: 0.3 * k,
      attack: 0.02,
      decay: 1.2,
      rate: 2,
    });
    this.splash(0.5 * k);
  }

  /* Something catching: a soft rushing whoomph. */
  ignite(near = 1) {
    const k = Math.max(0.1, near);
    this.noiseBurst({
      type: "lowpass",
      freq: 180,
      to: 1400,
      peak: 0.4 * k,
      attack: 0.08,
      decay: 0.5,
      rate: 0.8,
    });
  }

  /*
   * A quiet synthesized engine, through the mute and underwater chain.
   * `revs` is how hard it's working, 0 (idling) to 1 (flat out); null stops it.
   */
  motor(revs: number | null) {
    const ctx = this.ctx;
    if (!ctx || (revs === null && !this.motorOscillator)) return;
    if (!this.motorOscillator) {
      this.motorOscillator = ctx.createOscillator();
      this.motorOscillator.type = "sawtooth";
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0;
      this.motorFilter = ctx.createBiquadFilter();
      this.motorFilter.type = "lowpass";
      this.motorFilter.Q.value = 0.7;
      this.motorOscillator.connect(this.motorFilter).connect(this.motorGain).connect(this.muffle);
      this.motorOscillator.start();
    }
    const r = Math.min(1, Math.abs(revs ?? 0));
    this.motorOscillator.frequency.setTargetAtTime(38 + r * 100, ctx.currentTime, 0.12);
    this.motorFilter!.frequency.setTargetAtTime(180 + r * 420, ctx.currentTime, 0.12);
    this.motorGain!.gain.setTargetAtTime(
      revs === null ? 0 : 0.025 + r * 0.035,
      ctx.currentTime,
      0.08,
    );
  }

  /* Called every frame with how close the sea is and whether we're under it. */
  ambience(aboveTide: number, underwater: boolean, height: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const near = Math.max(0, 1 - Math.max(0, aboveTide) / 16);
    /* A bed under everything else: faint inland, never more than a soft wash at the shore. */
    this.seaGain.gain.setTargetAtTime(0.025 + near * 0.12, t, 0.3);
    this.seaFilter.frequency.setTargetAtTime(260 + near * 440, t, 0.3);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, Math.max(0, height - 8) / 260), t, 0.5);
    this.muffle.frequency.setTargetAtTime(underwater ? 420 : 18000, t, 0.08);
  }

  private env(gain: GainNode, at: number, peak: number, attack: number, decay: number) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  private noiseBurst(opts: {
    type: BiquadFilterType;
    freq: number;
    to?: number;
    q?: number;
    peak: number;
    attack: number;
    decay: number;
    rate?: number;
  }) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = opts.rate ?? 1;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.frequency.setValueAtTime(opts.freq, t);
    if (opts.to)
      filter.frequency.exponentialRampToValueAtTime(opts.to, t + opts.attack + opts.decay);
    filter.Q.value = opts.q ?? 1;
    const gain = ctx.createGain();
    this.env(gain, t, opts.peak, opts.attack, opts.decay);
    src.connect(filter).connect(gain).connect(this.muffle);
    src.start(t, Math.random() * 1.5);
    src.stop(t + opts.attack + opts.decay + 0.05);
  }

  private tone(
    freq: number,
    to: number,
    peak: number,
    attack: number,
    decay: number,
    type: OscillatorType = "sine",
  ) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
    const gain = ctx.createGain();
    this.env(gain, t, peak, attack, decay);
    osc.connect(gain).connect(this.muffle);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  splash(strength = 1) {
    this.noiseBurst({
      type: "bandpass",
      freq: 1400,
      to: 300,
      q: 0.8,
      peak: 0.35 * strength,
      attack: 0.01,
      decay: 0.45,
    });
  }

  step(wet: boolean) {
    if (wet)
      this.noiseBurst({
        type: "bandpass",
        freq: 900,
        to: 400,
        q: 1.2,
        peak: 0.09,
        attack: 0.01,
        decay: 0.2,
      });
    else
      this.noiseBurst({
        type: "lowpass",
        freq: 500 + Math.random() * 400,
        peak: 0.14,
        attack: 0.004,
        decay: 0.08,
        rate: 2,
      });
  }

  jump() {
    this.noiseBurst({ type: "highpass", freq: 600, peak: 0.05, attack: 0.02, decay: 0.12 });
  }

  land(speed: number) {
    const k = Math.min(1, speed / 14);
    this.tone(90, 45, 0.15 + k * 0.35, 0.005, 0.18);
    this.noiseBurst({
      type: "lowpass",
      freq: 400,
      peak: 0.1 + k * 0.2,
      attack: 0.004,
      decay: 0.12,
    });
  }

  shove() {
    this.noiseBurst({
      type: "bandpass",
      freq: 500,
      to: 2600,
      q: 0.6,
      peak: 0.25,
      attack: 0.04,
      decay: 0.2,
      rate: 1.5,
    });
    this.tone(120, 60, 0.18, 0.005, 0.15, "triangle");
  }

  shoved() {
    this.tone(70, 35, 0.5, 0.005, 0.35);
    this.noiseBurst({ type: "lowpass", freq: 900, to: 200, peak: 0.3, attack: 0.005, decay: 0.3 });
  }

  /* Something heavy set down: a house, a wall, a tower on your land. */
  thud() {
    this.noiseBurst({
      type: "lowpass",
      freq: 120,
      to: 480,
      peak: 0.45,
      attack: 0.05,
      decay: 0.55,
      rate: 0.5,
    });
    this.tone(55, 82, 0.3, 0.02, 0.5, "triangle");
  }

  /* A bright little bell: coins, a catch, a bounty. */
  chime() {
    this.tone(660, 650, 0.12, 0.005, 1.1);
    this.tone(990, 985, 0.07, 0.005, 1.3);
  }

  /* Something takes the bait: two quick ticks on the line and a plop. */
  bite() {
    this.tone(880, 700, 0.07, 0.002, 0.06, "triangle");
    setTimeout(() => this.tone(880, 700, 0.07, 0.002, 0.06, "triangle"), 110);
    this.splash(0.35);
  }

  /* A boar squaring up: a low, rough grunt. */
  snort(near = 1) {
    const k = Math.max(0.15, near);
    this.noiseBurst({
      type: "bandpass",
      freq: 260,
      to: 140,
      q: 2.5,
      peak: 0.4 * k,
      attack: 0.02,
      decay: 0.28,
      rate: 0.7,
    });
    this.tone(95, 70, 0.18 * k, 0.01, 0.25, "sawtooth");
  }

  /* A fish slipping the hook. */
  slip() {
    this.tone(330, 160, 0.1, 0.005, 0.35, "triangle");
    this.splash(0.4);
  }

  heartbeat(rate: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastHeart < rate) return;
    this.lastHeart = ctx.currentTime;
    this.tone(58, 40, 0.4, 0.01, 0.16);
    setTimeout(() => this.tone(52, 38, 0.28, 0.01, 0.16), 170);
  }

  /* Blacking out. */
  blackout() {
    this.tone(220, 55, 0.25, 0.05, 2.2, "triangle");
    this.splash(1.4);
  }

  /* The whoosh of a swing: heavier weapons are lower and slower. */
  swing(kind: WeaponKind | null, heavy = false) {
    const low = heavy || heftOf(kind) === "heavy";
    const quick = heftOf(kind) === "quick";
    this.noiseBurst({
      type: "bandpass",
      freq: low ? 300 : quick ? 1400 : 700,
      to: low ? 1200 : quick ? 4200 : 2600,
      q: 1.4,
      peak: low ? 0.3 : 0.2,
      attack: low ? 0.12 : 0.04,
      decay: low ? 0.25 : 0.12,
      rate: quick ? 2 : 1.4,
    });
  }

  /* Landing a blow: a thud, with a metallic edge for blades. */
  hit(kind: WeaponKind | null, heavy = false, near = 1) {
    const k = Math.max(0.15, near);
    const big = heavy || heftOf(kind) === "heavy";
    this.tone(big ? 70 : 110, big ? 38 : 60, (big ? 0.55 : 0.35) * k, 0.004, big ? 0.3 : 0.16);
    this.noiseBurst({
      type: "lowpass",
      freq: big ? 900 : 1600,
      to: 200,
      peak: 0.3 * k,
      attack: 0.003,
      decay: 0.15,
    });
    /* Edges ring; blunt heads and shields only thud. */
    if (kind && !weaponDef(kind).blunt) this.ring(1800, 0.06 * k, 0.12);
  }

  /* A bowstring let go: a low twang (a crossbow's is a hard clack), and the hiss of the shaft. */
  loose(crossbow: boolean, near = 1) {
    const k = Math.max(0.1, near);
    if (crossbow) {
      this.tone(220, 90, 0.3 * k, 0.002, 0.1, "square");
      this.noiseBurst({ type: "highpass", freq: 1800, peak: 0.2 * k, attack: 0.002, decay: 0.06 });
    } else this.tone(150, 110, 0.25 * k, 0.003, 0.22, "triangle");
    this.noiseBurst({
      type: "bandpass",
      freq: 2600,
      to: 5200,
      q: 2,
      peak: 0.1 * k,
      attack: 0.01,
      decay: 0.18,
      rate: 2,
    });
  }

  /* A spell cast: a falling zap with a hiss behind it. */
  zap(near = 1) {
    const k = Math.max(0.1, near);
    this.tone(980, 260, 0.16 * k, 0.004, 0.22, "triangle");
    this.noiseBurst({ type: "highpass", freq: 3000, peak: 0.08 * k, attack: 0.01, decay: 0.2 });
  }

  /* An arrow striking home: a dull thock in timber or flesh, a dry tick off stone, a plip in the sea. */
  thock(on: "soft" | "hard" | "water", near = 1) {
    const k = Math.max(0.08, near);
    if (on === "water") {
      this.splash(0.25 * k);
      return;
    }
    if (on === "hard") {
      this.noiseBurst({ type: "highpass", freq: 3000, peak: 0.12 * k, attack: 0.001, decay: 0.05 });
      this.ring(2600, 0.02 * k, 0.06);
      return;
    }
    this.tone(180, 90, 0.25 * k, 0.002, 0.09, "triangle");
    this.noiseBurst({
      type: "bandpass",
      freq: 900,
      q: 2,
      peak: 0.12 * k,
      attack: 0.001,
      decay: 0.06,
    });
  }

  /* A gun going off: a hard crack, then the boom rolling away. Further off it's mostly the boom. */
  cannon(near = 1) {
    const k = Math.max(0.06, near);
    this.noiseBurst({
      type: "lowpass",
      freq: 2400,
      to: 300,
      peak: 0.5 * k * k,
      attack: 0.002,
      decay: 0.25,
    });
    this.tone(70, 32, 0.6 * k, 0.004, 0.9, "triangle");
    this.noiseBurst({
      type: "lowpass",
      freq: 500,
      to: 80,
      peak: 0.45 * k,
      attack: 0.01,
      decay: 1.6,
      rate: 0.5,
    });
  }

  /* A siege engine's arm swinging up and over: a creak and a whoosh. */
  heave(near = 1) {
    const k = Math.max(0.06, near);
    this.tone(90, 140, 0.15 * k, 0.05, 0.3, "sawtooth");
    this.noiseBurst({
      type: "bandpass",
      freq: 300,
      to: 1400,
      q: 1,
      peak: 0.25 * k,
      attack: 0.15,
      decay: 0.35,
      rate: 0.8,
    });
  }

  /* A keg going up: a deep blast and the debris coming down after it. */
  blast(near = 1) {
    const k = Math.max(0.05, near);
    this.noiseBurst({
      type: "lowpass",
      freq: 3000,
      to: 200,
      peak: 0.7 * k,
      attack: 0.002,
      decay: 0.5,
    });
    this.tone(55, 24, 0.8 * k, 0.005, 1.4, "triangle");
    this.noiseBurst({
      type: "lowpass",
      freq: 400,
      to: 60,
      peak: 0.6 * k,
      attack: 0.02,
      decay: 2.2,
      rate: 0.4,
    });
    for (const [i, at] of [350, 600, 900].entries())
      setTimeout(
        () =>
          this.noiseBurst({
            type: "bandpass",
            freq: 900 + i * 300,
            to: 300,
            q: 1.2,
            peak: 0.15 * k,
            attack: 0.004,
            decay: 0.2,
            rate: 1.3,
          }),
        at,
      );
  }

  /* A fuse spitting: a short sizzle, called again and again while it burns. */
  sizzle(near = 1) {
    const k = Math.max(0.05, near);
    this.noiseBurst({
      type: "highpass",
      freq: 4200,
      peak: 0.09 * k,
      attack: 0.01,
      decay: 0.12,
      rate: 2,
    });
  }

  /* Steel on a shield. */
  clang(parry = false) {
    this.ring(parry ? 1320 : 980, parry ? 0.16 : 0.11, parry ? 0.9 : 0.4);
    this.ring(parry ? 1980 : 1460, 0.06, 0.3);
    this.noiseBurst({ type: "highpass", freq: 2500, peak: 0.12, attack: 0.002, decay: 0.06 });
  }

  pickup() {
    this.tone(440, 880, 0.08, 0.005, 0.18, "triangle");
    this.ring(1320, 0.05, 0.35);
  }

  /* A weapon snapping. */
  broke() {
    this.noiseBurst({
      type: "bandpass",
      freq: 2200,
      to: 600,
      q: 2,
      peak: 0.25,
      attack: 0.002,
      decay: 0.2,
    });
    this.tone(300, 120, 0.12, 0.003, 0.2, "square");
  }

  /* A metallic partial: a few inharmonic sines with a fast decay. */
  private ring(freq: number, peak: number, decay: number) {
    for (const [mul, amp] of [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.25],
    ]) {
      this.tone(freq * mul, freq * mul * 0.995, peak * amp, 0.002, decay);
    }
  }

  /*
   * The alarm: a bronze bell rung three times, its partials inharmonic as a
   * real bell's (hum, prime, tierce, quint, nominal), each dying slowly.
   */
  bell(times = 3) {
    for (let k = 0; k < times; k++)
      setTimeout(() => {
        for (const [mul, amp, decay] of [
          [0.5, 0.22, 3.2],
          [1, 0.26, 2.6],
          [1.183, 0.16, 2.2],
          [1.506, 0.1, 1.8],
          [2, 0.14, 1.6],
          [2.514, 0.06, 1.1],
          [3.011, 0.04, 0.8],
        ])
          this.tone(392 * mul, 392 * mul * 0.998, amp, 0.004, decay);
        this.noiseBurst({ type: "highpass", freq: 3000, peak: 0.08, attack: 0.001, decay: 0.05 });
      }, k * 700);
  }

  /* A bounty paid out. */
  reward() {
    for (const [i, f] of [392, 523.3, 659.3, 784].entries()) {
      setTimeout(() => this.tone(f, f, 0.12, 0.01, 1.4), i * 140);
    }
  }
}
