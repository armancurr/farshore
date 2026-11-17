import type { WeaponKind } from "../shared/weapons";

/*
 * Every sound is synthesized: noise through filters for the sea and wind,
 * enveloped sines for thumps.
 * Nothing to download.
 */
/* How each weapon sounds: big slow whooshes, quick whistles, and blunt thuds. */
const HEAVY = new Set<WeaponKind>(["hammer", "axe", "greatsword", "halberd", "mace"]);
const QUICK = new Set<WeaponKind>(["daggers", "sickle", "machete", "spear", "trident"]);
const BLUNT = new Set<WeaponKind>(["hammer", "mace", "shield"]);

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

  /* Something heavy set down: a placed prefab. */
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
    const low = heavy || (!!kind && HEAVY.has(kind));
    const quick = !!kind && QUICK.has(kind);
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
    const big = heavy || (!!kind && HEAVY.has(kind));
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
    if (kind && !BLUNT.has(kind)) this.ring(1800, 0.06 * k, 0.12);
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

  /* A bounty paid out. */
  reward() {
    for (const [i, f] of [392, 523.3, 659.3, 784].entries()) {
      setTimeout(() => this.tone(f, f, 0.12, 0.01, 1.4), i * 140);
    }
  }
}
