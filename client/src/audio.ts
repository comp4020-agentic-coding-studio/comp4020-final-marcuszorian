// The sound layer, synthesised entirely at runtime (no assets, like the GLSL
// visuals). Two buses: the aged bus carries the world and runs through the
// archive degradation chain; the dry bus carries UI blips straight to master
// so they pierce the processed world. See setArchiveAge() — it is the audio
// twin of PostFx.setArchiveAge(), same 0..1 number.

// exponentialRampToValueAtTime to or from exactly 0 silently fails.
const EPS = 1e-4;
const STEP = 0.125; // 16th note at 120 bpm; tempo stays constant, speed binds to timbre
const LOOKAHEAD = 0.2;
const ROOT_HZ = 55;
const PATTERN = [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 0, 10, 12, 7];

type Src = OscillatorNode | AudioBufferSourceNode;

function makeBuffer(ctx: AudioContext, seconds: number, channels: number, fill: (d: Float32Array, ch: number) => void): AudioBuffer {
  const buf = ctx.createBuffer(channels, Math.max(1, Math.floor(ctx.sampleRate * seconds)), ctx.sampleRate);
  for (let c = 0; c < channels; c++) fill(buf.getChannelData(c), c);
  return buf;
}

// Diode-clipper-ish: soft knee on the positive half, harder on the negative.
function clipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x >= 0 ? 1 - Math.exp(-3 * x) : -(1 - Math.exp(2.2 * x)) * 0.8;
  }
  return curve;
}

export class AudioEngine {
  #ctx: AudioContext | null = null;
  #master!: GainNode;
  #aged!: GainNode; // input of the degradation chain
  #hp!: BiquadFilterNode;
  #lp!: BiquadFilterNode;
  #wowDepth: [GainNode, GainNode] | null = null;
  #humGain!: GainNode;
  #hissGain!: GainNode;
  #noise!: AudioBuffer;
  #gatedIR!: AudioBuffer;
  #gatedVerb!: ConvolverNode;
  #clip!: WaveShaperNode;
  #lp1!: BiquadFilterNode;
  #lp2!: BiquadFilterNode;
  #engineBus!: GainNode;
  #bedGain!: GainNode;
  #phaseLfo!: OscillatorNode;
  #phaseDepth!: GainNode;
  #ghostGain!: GainNode;
  #sources: Src[] = [];
  #muted = false;
  #driving = false;
  #nextNote = 0;
  #step = 0;
  #age = 0;

  get available(): boolean {
    return this.#ctx !== null;
  }

  get muted(): boolean {
    return this.#muted;
  }

  unlock(): void {
    if (this.#ctx) {
      void this.#ctx.resume();
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
      this.#build(ctx);
    } catch {
      this.#ctx = null;
      return;
    }
    void ctx.resume();
  }

  #build(ctx: AudioContext): void {
    this.#ctx = ctx;
    const sr = ctx.sampleRate;
    const start = (s: Src): void => {
      s.start();
      this.#sources.push(s);
    };
    const osc = (type: OscillatorType, freq: number): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      start(o);
      return o;
    };
    const loop = (buffer: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      start(s);
      return s;
    };

    // Generated once and reused by every trigger.
    this.#noise = makeBuffer(ctx, 2, 1, (d) => {
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    });
    const pink = makeBuffer(ctx, 4, 1, (d) => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    });
    // The RMX16 character is the cliff: flat envelope, then abruptly nothing.
    const gateLen = 0.38;
    this.#gatedIR = makeBuffer(ctx, gateLen + 0.02, 2, (d) => {
      const cliff = Math.floor(gateLen * sr);
      for (let i = 0; i < d.length; i++) {
        const fade = i > cliff ? Math.max(0, 1 - (i - cliff) / (0.02 * sr)) : 1;
        d[i] = (Math.random() * 2 - 1) * fade * 0.5;
      }
    });
    const hallIR = makeBuffer(ctx, 5, 2, (d) => {
      for (let i = 0; i < d.length; i++) {
        const t = i / d.length;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.5) * Math.min(1, t * 40);
      }
    });

    this.#master = ctx.createGain();
    this.#master.gain.value = this.#muted ? 0 : 0.8;
    this.#master.connect(ctx.destination);

    // Aged bus: bandlimit -> wow/flutter delay -> (+ hum, hiss) -> compressor -> master.
    // Hum and hiss join after the bandlimit (else the 100Hz roll-off would eat
    // the hum) but before the compressor, so loud hits duck them: pumping
    // without a sidechain input, which Web Audio lacks.
    this.#aged = ctx.createGain();
    this.#hp = ctx.createBiquadFilter();
    this.#hp.type = "highpass";
    this.#hp.frequency.value = 20;
    this.#lp = ctx.createBiquadFilter();
    this.#lp.type = "lowpass";
    this.#lp.frequency.value = 20000;
    const wow = ctx.createDelay(0.05);
    wow.delayTime.value = 0.015;
    // Incommensurate rates so the wobble is lopsided rather than a clean vibrato.
    const wowA = ctx.createGain();
    const wowB = ctx.createGain();
    wowA.gain.value = 0;
    wowB.gain.value = 0;
    osc("sine", 0.63).connect(wowA).connect(wow.delayTime);
    osc("sine", 1.91).connect(wowB).connect(wow.delayTime);
    this.#wowDepth = [wowA, wowB];
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -26;
    comp.knee.value = 8;
    comp.ratio.value = 14;
    comp.attack.value = 0.003;
    comp.release.value = 0.9;
    this.#aged.connect(this.#hp).connect(this.#lp).connect(wow).connect(comp).connect(this.#master);

    this.#humGain = ctx.createGain();
    this.#humGain.gain.value = 0;
    osc("sine", 60).connect(this.#humGain);
    const h2 = ctx.createGain();
    h2.gain.value = 0.4;
    osc("sine", 120).connect(h2).connect(this.#humGain);
    this.#humGain.connect(comp);
    this.#hissGain = ctx.createGain();
    this.#hissGain.gain.value = 0;
    const hissHp = ctx.createBiquadFilter();
    hissHp.type = "highpass";
    hissHp.frequency.value = 5000;
    loop(this.#noise).connect(hissHp).connect(this.#hissGain).connect(comp);

    // Dry bus: UI only, skips degradation and compression on purpose.
    // (Voices connect to master directly; see uiBlip.)

    // Engine: pulse sequence -> two cascaded 12dB lowpasses = 24dB/oct.
    this.#lp1 = ctx.createBiquadFilter();
    this.#lp2 = ctx.createBiquadFilter();
    for (const f of [this.#lp1, this.#lp2]) {
      f.type = "lowpass";
      f.frequency.value = 120;
      f.Q.value = 1.2;
    }
    this.#engineBus = ctx.createGain();
    // Held well under the one-shots: this one runs continuously, so it sets the
    // floor everything else has to clear rather than competing for the front.
    this.#engineBus.gain.value = 0.6;
    this.#engineBus.connect(this.#lp1).connect(this.#lp2).connect(this.#aged);

    // Pink bed through a 4-stage allpass phaser; LFO rate rises with speed.
    this.#bedGain = ctx.createGain();
    this.#bedGain.gain.value = 0;
    const bedIn = ctx.createGain();
    bedIn.gain.value = 0.5;
    loop(pink).connect(bedIn);
    this.#phaseLfo = osc("sine", 0.2);
    this.#phaseDepth = ctx.createGain();
    this.#phaseDepth.gain.value = 600;
    this.#phaseLfo.connect(this.#phaseDepth);
    let prev: AudioNode = bedIn;
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 900 + i * 350;
      this.#phaseDepth.connect(ap.frequency);
      prev.connect(ap);
      prev = ap;
    }
    // Phaser needs the dry signal summed with the allpassed one to notch.
    bedIn.connect(this.#bedGain);
    prev.connect(this.#bedGain);
    this.#bedGain.connect(this.#aged);

    // Ghost: always running, silent until nearness opens its gain. No low end.
    // A detuned sine/triangle cluster stands in for a Mellotron choir sample.
    this.#ghostGain = ctx.createGain();
    this.#ghostGain.gain.value = 0;
    const ghostHp = ctx.createBiquadFilter();
    ghostHp.type = "highpass";
    ghostHp.frequency.value = 500;
    const hall = ctx.createConvolver();
    hall.buffer = hallIR; // fully wet: only the convolved signal is connected
    ghostHp.connect(this.#ghostGain).connect(hall).connect(this.#aged);
    [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => {
      const o = osc(i % 2 ? "triangle" : "sine", f * (1 + (i - 2.5) * 0.002));
      const g = ctx.createGain();
      g.gain.value = 0.12;
      o.connect(g).connect(ghostHp);
      // Slow, irregular warble: two unrelated LFOs per voice into detune.
      for (const [rate, cents] of [[0.23 + i * 0.071, 35], [0.61 + i * 0.113, 18]] as const) {
        const l = osc("sine", rate);
        const d = ctx.createGain();
        d.gain.value = cents;
        l.connect(d).connect(o.detune);
      }
    });

    this.#clip = ctx.createWaveShaper();
    this.#clip.curve = clipCurve();
    this.#clip.oversample = "2x";
    this.#gatedVerb = ctx.createConvolver();
    this.#gatedVerb.buffer = this.#gatedIR;
    const verbSend = ctx.createGain();
    verbSend.gain.value = 0.5;
    this.#clip.connect(this.#aged);
    this.#clip.connect(verbSend).connect(this.#gatedVerb).connect(this.#aged);

    this.#nextNote = ctx.currentTime + 0.05;
    this.setArchiveAge(this.#age);
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (!this.#ctx) return;
    this.#master.gain.setTargetAtTime(muted ? 0 : 0.8, this.#ctx.currentTime, 0.03);
  }

  setArchiveAge(age: number): void {
    const a = Math.max(0, Math.min(1, age));
    this.#age = a;
    const ctx = this.#ctx;
    if (!ctx || !this.#wowDepth) return;
    const t = ctx.currentTime;
    const tc = 0.25;
    this.#hp.frequency.setTargetAtTime(20 * Math.pow(100 / 20, a), t, tc);
    this.#lp.frequency.setTargetAtTime(20000 * Math.pow(8000 / 20000, a), t, tc);
    this.#wowDepth[0].gain.setTargetAtTime(a * 0.0025, t, tc);
    this.#wowDepth[1].gain.setTargetAtTime(a * 0.0015, t, tc);
    this.#humGain.gain.setTargetAtTime(a * 0.03, t, tc);
    this.#hissGain.gain.setTargetAtTime(a * 0.025, t, tc);
  }

  setDriving(driving: boolean): void {
    this.#driving = driving;
    const ctx = this.#ctx;
    if (!ctx) return;
    if (driving) this.#nextNote = Math.max(this.#nextNote, ctx.currentTime + 0.05);
    this.#bedGain.gain.setTargetAtTime(driving ? 0.085 : 0, ctx.currentTime, 0.2);
  }

  update(_dt: number, speed: number, nearness: number): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const now = ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    const n = Math.max(0, Math.min(1, nearness));

    const cutoff = 120 * Math.pow(7000 / 120, s);
    this.#lp1.frequency.setTargetAtTime(cutoff, now, 0.08);
    this.#lp2.frequency.setTargetAtTime(cutoff, now, 0.08);
    this.#phaseLfo.frequency.setTargetAtTime(0.2 + s * 2.3, now, 0.2);
    this.#ghostGain.gain.setTargetAtTime(n * n * 0.5, now, 0.15);

    if (!this.#driving) return;
    // A backgrounded tab or long hitch leaves the clock far ahead of us;
    // resync instead of firing a burst of stale notes.
    if (this.#nextNote < now - 0.05) this.#nextNote = now + 0.02;
    // Scheduled against the audio clock with a lookahead: setInterval drifts
    // and is throttled in background tabs.
    while (this.#nextNote < now + LOOKAHEAD) {
      this.#note(this.#nextNote, PATTERN[this.#step % PATTERN.length]!);
      this.#step++;
      this.#nextNote += STEP;
    }
  }

  #note(at: number, semis: number): void {
    const ctx = this.#ctx!;
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = ROOT_HZ * Math.pow(2, semis / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.3, at + 0.015);
    g.gain.exponentialRampToValueAtTime(EPS, at + 0.115);
    o.connect(g).connect(this.#engineBus);
    this.#reap(o, [o, g]);
    o.start(at);
    o.stop(at + 0.13);
  }

  // One-shot voices stop and disconnect themselves so nodes never pile up.
  #reap(last: Src, nodes: AudioNode[]): void {
    last.onended = () => {
      for (const n of nodes) n.disconnect();
    };
  }

  laneShift(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 0.15;
    const car = ctx.createOscillator();
    car.type = "square";
    // Falls about an octave in the first 20ms.
    car.frequency.setValueAtTime(1400, t);
    car.frequency.exponentialRampToValueAtTime(700, t + 0.02);
    const mod = ctx.createOscillator();
    mod.frequency.value = 2100;
    const modAmt = ctx.createGain();
    modAmt.gain.setValueAtTime(900, t);
    modAmt.gain.exponentialRampToValueAtTime(EPS, t + dur);
    mod.connect(modAmt).connect(car.frequency);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.25, t);
    amp.gain.exponentialRampToValueAtTime(EPS, t + dur);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    car.connect(amp).connect(hp);

    // Short wide chorus: two modulated delays hard-panned L/R.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 9;
    const nodes: AudioNode[] = [car, mod, modAmt, amp, hp, lfo];
    for (const [base, pan] of [[0.009, -1], [0.014, 1]] as const) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = base;
      const depth = ctx.createGain();
      depth.gain.value = 0.002;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      lfo.connect(depth).connect(d.delayTime);
      hp.connect(d).connect(p).connect(this.#aged);
      nodes.push(d, depth, p);
    }
    this.#reap(car, nodes);
    for (const o of [car, mod, lfo]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  crash(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 1.8;
    const sum = ctx.createGain();
    sum.gain.setValueAtTime(0.9, t);
    sum.gain.setValueAtTime(0.9, t + 0.2);
    sum.gain.exponentialRampToValueAtTime(EPS, t + dur);
    sum.connect(this.#clip);
    const nodes: AudioNode[] = [sum];

    // Detuned saws, one octave down over 1.5s like a power-down.
    const reese: OscillatorNode[] = [];
    for (const detune of [-14, 14]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.detune.value = detune;
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 1.5);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 400;
      o.connect(lp).connect(sum);
      nodes.push(o, lp);
      reese.push(o);
    }
    const nz = ctx.createBufferSource();
    nz.buffer = this.#noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(5000, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.5);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1.2, t);
    ng.gain.exponentialRampToValueAtTime(EPS, t + 0.5);
    nz.connect(bp).connect(ng).connect(sum);
    nodes.push(nz, bp, ng);

    this.#reap(reese[0]!, nodes);
    for (const o of reese) {
      o.start(t);
      o.stop(t + dur);
    }
    nz.start(t);
    nz.stop(t + 0.5);
  }

  uiBlip(kind: "select" | "best"): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t0 = ctx.currentTime;
    // Ascending fifths; the single select tone is just the first note.
    const freqs = kind === "best" ? [523.25, 783.99, 1046.5, 1567.98] : [659.25];
    freqs.forEach((f, i) => {
      const t = t0 + i * 0.06;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(EPS, t + 0.1);
      o.connect(g).connect(this.#master);
      this.#reap(o, [o, g]);
      o.start(t);
      o.stop(t + 0.12);
    });
  }

  dispose(): void {
    this.#driving = false;
    const ctx = this.#ctx;
    if (!ctx) return;
    for (const s of this.#sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.#sources = [];
    this.#ctx = null;
    void ctx.close();
  }
}
