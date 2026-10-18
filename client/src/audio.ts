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
// Nearness under this is inaudible (n*n*0.5 is below -114dB), and how long it
// has to stay there before the ghost pad is unplugged. See update().
const GHOST_FLOOR = 0.002;
const GHOST_HOLD = 1.0;
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

// A crude stepped quantizer — trickFail()'s "flat, 8-bit, unforgiving" texture.
function bitcrushCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const steps = 8;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  return curve;
}
const BITCRUSH_CURVE = bitcrushCurve();

// Minor pentatonic steps, semitones from root — trickSuccess()'s rising scale.
const PENTATONIC = [0, 3, 5, 7, 10];

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
  #ghostHp!: BiquadFilterNode;
  #ghostLive = true; // is ghostHp -> ghostGain patched in? built patched
  #ghostQuiet = 0; // seconds nearness has sat at/below GHOST_FLOOR
  #sources: Src[] = [];
  #hidden = false;
  #muted = false;
  /** Whether the score (bed + bassline) is playing. See setMusic. */
  #music = false;
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
      if (!this.#hidden) void this.#ctx.resume();
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
    if (!this.#hidden) void ctx.resume();
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

    // Ghost: silent until nearness opens its gain, and unplugged from ghostGain
    // entirely when no ghost is near (see update). No low end. A detuned
    // sine/triangle cluster stands in for a Mellotron choir sample.
    this.#ghostGain = ctx.createGain();
    this.#ghostGain.gain.value = 0;
    const ghostHp = (this.#ghostHp = ctx.createBiquadFilter());
    ghostHp.type = "highpass";
    ghostHp.frequency.value = 500;
    const hall = ctx.createConvolver();
    hall.buffer = hallIR; // fully wet: only the convolved signal is connected
    ghostHp.connect(this.#ghostGain).connect(hall).connect(this.#aged);
    this.#ghostLive = true; // a rebuild after dispose() starts patched again
    this.#ghostQuiet = 0;
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
    // Re-apply the driving state the same way, and for the same reason: both
    // can be set before a gesture ever unlocks the context, and both live in
    // node automation that did not exist until just now. The music starts on
    // the title screen, so by the time a returning player's first click builds
    // this graph, #music has usually been true for a while — without this
    // the bed stays at zero until something happens to toggle it.
    this.setMusic(this.#music);
  }

  /** Pauses output while the page is hidden. Suspending keeps the graph and
   * the music's place intact, unlike dispose(). */
  setHidden(hidden: boolean): void {
    this.#hidden = hidden;
    const ctx = this.#ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend();
    else void ctx.resume();
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

  /**
   * Starts or stops the music — the phaser bed and the sixteenth-note bassline
   * that together are the score.
   *
   * This used to be `setDriving`, and was true only during a live run. It is
   * no longer tied to driving at all: the music now plays under the title
   * screen and its menus as well, so the name had to stop claiming otherwise.
   * What still tracks the car is TIMBRE, not whether anything sounds —
   * `update()` opens the engine filter with speed either way.
   */
  setMusic(on: boolean): void {
    this.#music = on;
    const ctx = this.#ctx;
    if (!ctx) return;
    if (on) this.#nextNote = Math.max(this.#nextNote, ctx.currentTime + 0.05);
    this.#bedGain.gain.setTargetAtTime(on ? 0.085 : 0, ctx.currentTime, 0.2);
  }

  update(dt: number, speed: number, nearness: number): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const s = Math.max(0, Math.min(1, speed));
    // Muting only pulls master's gain to 0, which silences the output without
    // sparing a single node the work — so for the gate below, muted IS "nobody
    // can hear this", and the pad should unplug. Without this the early return
    // would freeze the gate in whatever state muting caught it in: mute while a
    // ghost is alongside and the most expensive part of the graph stays patched
    // in, inaudibly, for the rest of the session.
    const n = this.#muted ? 0 : Math.max(0, Math.min(1, nearness));

    const cutoff = 120 * Math.pow(7000 / 120, s);
    this.#lp1.frequency.setTargetAtTime(cutoff, now, 0.08);
    this.#lp2.frequency.setTargetAtTime(cutoff, now, 0.08);
    this.#phaseLfo.frequency.setTargetAtTime(0.2 + s * 2.3, now, 0.2);
    this.#ghostGain.gain.setTargetAtTime(n * n * 0.5, now, 0.15);
    // A gain of 0 buys nothing: setTargetAtTime only approaches zero
    // asymptotically, so ghostGain keeps emitting non-silence and the 5s stereo
    // hall keeps convolving it. The pad (18 oscillators, 6 gains, 12 detune
    // LFOs, a highpass, the convolution) measured 27.3 of the 40.7% mean
    // renderCapacity — two thirds of all audio CPU, for something nobody hears
    // outside 14m, which is most of a run. Cutting the single ghostHp ->
    // ghostGain edge orphans that entire cluster from ctx.destination, so Chrome
    // stops pulling it at all; the convolver stays wired downstream and so rings
    // its tail out, then costs nothing once its input has been silent that long.
    // Patch back the moment nearness lifts off the floor — that must never lag
    // the audible ramp — but delay the cut by GHOST_HOLD so the 0.15s gain ramp
    // has rung down and the tail is not chopped. The reconnect needs no fade of
    // its own: the gain is already ~0 at that instant and ramps up from there.
    if (n > GHOST_FLOOR) {
      this.#ghostQuiet = 0;
      if (!this.#ghostLive) {
        this.#ghostHp.connect(this.#ghostGain);
        this.#ghostLive = true;
      }
    } else if (this.#ghostLive) {
      this.#ghostQuiet += dt;
      if (this.#ghostQuiet >= GHOST_HOLD) {
        this.#ghostHp.disconnect(this.#ghostGain);
        this.#ghostLive = false;
      }
    }

    // Past the gate, muting means the same as before: no notes get queued. The
    // automation above is cheap and keeps the filters tracking, so unmuting
    // resumes mid-run instead of snapping from stale values.
    if (this.#muted || !this.#music) return;
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

  /** Oil's forced drift (doc/adr/0012): a ring-modulated sine over a
   * resonant noise sweep, auto-panned hard L/R to read as fishtailing, with
   * a downward bandpass sweep for the "frictionless" slip. Routed to #aged
   * like every other world sound — a drift is something happening to the
   * car, not a UI event. */
  oilSlip(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 1.2;

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(260, t);
    carrier.frequency.linearRampToValueAtTime(180, t + dur);
    const ring = ctx.createOscillator();
    ring.type = "sine";
    ring.frequency.setValueAtTime(40, t);
    ring.frequency.linearRampToValueAtTime(90, t + dur);
    const ringAmt = ctx.createGain();
    ringAmt.gain.value = 1; // AM depth via a gain node modulated by `ring`
    ring.connect(ringAmt.gain);
    carrier.connect(ringAmt);

    const noise = ctx.createBufferSource();
    noise.buffer = this.#noise;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 12;
    bp.frequency.setValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    noise.connect(bp).connect(noiseGain);

    const sum = ctx.createGain();
    sum.gain.setValueAtTime(0, t);
    sum.gain.linearRampToValueAtTime(0.4, t + 0.01); // 10ms attack
    sum.gain.exponentialRampToValueAtTime(EPS, t + dur);
    ringAmt.connect(sum);
    noiseGain.connect(sum);

    // Unsynchronized stereo auto-pan: two incommensurate LFOs fighting over
    // the StereoPannerNode so the sweep reads as erratic, not a clean tremolo.
    const pan = ctx.createStereoPanner();
    const panA = ctx.createOscillator();
    panA.type = "sine";
    panA.frequency.value = 5.3;
    const panB = ctx.createOscillator();
    panB.type = "sine";
    panB.frequency.value = 3.7;
    const panAmt = ctx.createGain();
    panAmt.gain.value = 1;
    panA.connect(panAmt);
    panB.connect(panAmt);
    panAmt.connect(pan.pan);
    sum.connect(pan).connect(this.#aged);

    const nodes: AudioNode[] = [carrier, ring, ringAmt, noise, bp, noiseGain, sum, pan, panA, panB, panAmt];
    this.#reap(carrier, nodes);
    for (const o of [carrier, ring, panA, panB]) {
      o.start(t);
      o.stop(t + dur + 0.05);
    }
    noise.start(t);
    noise.stop(t + dur);
  }

  /** A ramp launch (doc/adr/0013): filtered noise plus an ascending sawtooth
   * sweep through a feedback-heavy flanger for a jet-engine liftoff, and a
   * momentary high-pass sweep on the engine bus so the road's sub-bass drops
   * out the instant the tires leave the asphalt. */
  rampLaunch(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 0.7;

    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(140, t);
    saw.frequency.exponentialRampToValueAtTime(900, t + dur);
    const sawGain = ctx.createGain();
    sawGain.gain.setValueAtTime(0, t);
    sawGain.gain.linearRampToValueAtTime(0.22, t + 0.03);
    sawGain.gain.exponentialRampToValueAtTime(EPS, t + dur);

    const noise = ctx.createBufferSource();
    noise.buffer = this.#noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.setValueAtTime(600, t);
    hp.frequency.exponentialRampToValueAtTime(4000, t + dur);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, t);
    noiseGain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    noiseGain.gain.exponentialRampToValueAtTime(EPS, t + dur + 0.2); // longer, airy decay

    // Feedback flanger: a short modulated delay fed back into itself.
    const flange = ctx.createDelay(0.02);
    flange.delayTime.value = 0.004;
    const flangeLfo = ctx.createOscillator();
    flangeLfo.type = "sine";
    flangeLfo.frequency.value = 0.6;
    const flangeDepth = ctx.createGain();
    flangeDepth.gain.value = 0.0035;
    flangeLfo.connect(flangeDepth).connect(flange.delayTime);
    const feedback = ctx.createGain();
    feedback.gain.value = 0.7;
    flange.connect(feedback).connect(flange);

    const sum = ctx.createGain();
    sum.gain.value = 1;
    saw.connect(sawGain).connect(sum);
    noise.connect(hp).connect(noiseGain).connect(flange).connect(sum);
    sum.connect(this.#aged);

    const nodes: AudioNode[] = [saw, sawGain, noise, hp, noiseGain, flange, flangeLfo, flangeDepth, feedback, sum];
    this.#reap(saw, nodes);
    saw.start(t);
    saw.stop(t + dur + 0.05);
    noise.start(t);
    noise.stop(t + dur + 0.25);
    flangeLfo.start(t);
    flangeLfo.stop(t + dur + 0.25);

    // Momentary sub-bass cut on the engine bus: sweep lp1/lp2's own cutoff up
    // and back down rather than adding a new filter, so the "tires leave the
    // asphalt" dip rides on the same bus update() already drives.
    for (const f of [this.#lp1, this.#lp2]) {
      const now = f.frequency.value;
      f.frequency.cancelScheduledValues(t);
      f.frequency.setValueAtTime(now, t);
      f.frequency.linearRampToValueAtTime(Math.max(now, 1800), t + 0.05);
      f.frequency.linearRampToValueAtTime(now, t + 0.4);
    }
  }

  /** One correct trick input (doc/adr/0013/0014): an FM-ish bell (sine
   * carrier + a fast-decaying sine modulator) stepping up the minor
   * pentatonic scale with each call, through a tempo-synced ping-pong delay
   * so a fast combo builds its own cascading arpeggio. `step` resets to 0 at
   * the start of each trick (see main.ts). */
  trickSuccess(step: number): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const semis = PENTATONIC[step % PENTATONIC.length]! + 12 * Math.floor(step / PENTATONIC.length);
    const freq = 523.25 * Math.pow(2, semis / 12); // C5 root

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * 3.01; // inharmonic ratio for a bell-ish timbre
    const modAmt = ctx.createGain();
    modAmt.gain.setValueAtTime(freq * 2, t);
    modAmt.gain.exponentialRampToValueAtTime(EPS, t + 0.15);
    mod.connect(modAmt).connect(carrier.frequency);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.3, t); // 0ms attack
    amp.gain.exponentialRampToValueAtTime(EPS, t + 0.15);

    // 1/16th-note ping-pong delay at the song's fixed 120bpm clock (STEP is
    // already a 16th at that tempo), two cross-feeding delays panned L/R.
    const delayL = ctx.createDelay(1);
    delayL.delayTime.value = STEP;
    const delayR = ctx.createDelay(1);
    delayR.delayTime.value = STEP;
    const fbL = ctx.createGain();
    fbL.gain.value = 0.35;
    const fbR = ctx.createGain();
    fbR.gain.value = 0.35;
    const panL = ctx.createStereoPanner();
    panL.pan.value = -0.8;
    const panR = ctx.createStereoPanner();
    panR.pan.value = 0.8;
    delayL.connect(panL).connect(this.#master);
    delayR.connect(panR).connect(this.#master);
    delayL.connect(fbR).connect(delayR);
    delayR.connect(fbL).connect(delayL);

    carrier.connect(amp);
    amp.connect(this.#master);
    amp.connect(delayL);

    const nodes: AudioNode[] = [carrier, mod, modAmt, amp, delayL, delayR, fbL, fbR, panL, panR];
    this.#reap(carrier, nodes);
    carrier.start(t);
    carrier.stop(t + 0.2);
    mod.start(t);
    mod.stop(t + 0.2);
  }

  /** A completed trick (doc/adr/0013): a detuned-saw synth-brass chord
   * through chorus and a bright plate-ish reverb, plus a high sparkle
   * glissando on top — the big payout sound, deliberately much wetter and
   * longer than every other one-shot here. */
  trickComplete(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 1.8;
    const chord = [0, 4, 7, 12]; // major triad + octave, root at ROOT_HZ*8

    const sum = ctx.createGain();
    sum.gain.value = 1;
    const nodes: AudioNode[] = [sum];

    // Two detuned saws per chord tone for a thick Juno-ish unison.
    for (const semis of chord) {
      const freq = ROOT_HZ * 8 * Math.pow(2, semis / 12);
      for (const detune of [-9, 9]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = freq;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.04); // soft 40ms attack
        g.gain.setValueAtTime(0.09, t + dur * 0.5);
        g.gain.exponentialRampToValueAtTime(EPS, t + dur);
        o.connect(g).connect(sum);
        nodes.push(o, g);
      }
    }

    // Stereo chorus: two short modulated delays, hard-panned.
    const chorusBus = ctx.createGain();
    chorusBus.gain.value = 0.8;
    sum.connect(chorusBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    nodes.push(chorusBus, lfo);
    for (const [base, pan] of [[0.012, -1], [0.018, 1]] as const) {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = base;
      const depth = ctx.createGain();
      depth.gain.value = 0.003;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      lfo.connect(depth).connect(d.delayTime);
      chorusBus.connect(d).connect(p).connect(this.#master);
      nodes.push(d, depth, p);
    }

    // Bright plate-ish reverb send: reuse the gated-hall convolver path with
    // a longer, fully-wet send since this is the one moment meant to feel massive.
    const verbSend = ctx.createGain();
    verbSend.gain.value = 0.6;
    sum.connect(verbSend).connect(this.#gatedVerb).connect(this.#master);
    nodes.push(verbSend);

    // Sparkle glissando: a bright square sweeping up over the chord's attack.
    const sparkle = ctx.createOscillator();
    sparkle.type = "square";
    sparkle.frequency.setValueAtTime(1800, t);
    sparkle.frequency.exponentialRampToValueAtTime(5200, t + 0.3);
    const sparkleHp = ctx.createBiquadFilter();
    sparkleHp.type = "highpass";
    sparkleHp.frequency.value = 3000;
    const sparkleGain = ctx.createGain();
    sparkleGain.gain.setValueAtTime(0.15, t);
    sparkleGain.gain.exponentialRampToValueAtTime(EPS, t + 0.35);
    sparkle.connect(sparkleHp).connect(sparkleGain).connect(this.#master);
    nodes.push(sparkle, sparkleHp, sparkleGain);

    const firstOsc = nodes.find((n): n is OscillatorNode => n instanceof OscillatorNode)!;
    this.#reap(firstOsc, nodes);
    for (const n of nodes) {
      if (n instanceof OscillatorNode) {
        n.start(t);
        n.stop(t + dur + 0.3);
      }
    }
  }

  /** A failed/timed-out trick (doc/adr/0013/0014): two saws a tritone apart
   * through a hard bitcrusher, flat block envelope, a fast downward pitch
   * tail, and deliberately 100% dry — no reverb, no delay — so it snaps the
   * player out of the trick's flow rather than lingering. */
  trickFail(): void {
    const ctx = this.#ctx;
    if (!ctx || this.#muted) return;
    const t = ctx.currentTime;
    const dur = 0.5;
    const tailStart = t + 0.35;

    const crusher = ctx.createWaveShaper();
    crusher.curve = BITCRUSH_CURVE;

    const sum = ctx.createGain();
    sum.gain.setValueAtTime(0.22, t); // instant attack, flat sustain
    sum.gain.setValueAtTime(0.22, tailStart);
    sum.gain.setValueAtTime(0, t + dur); // sharp, abrupt release — no tail
    sum.connect(crusher).connect(this.#master); // dry: straight to master

    const oscs: OscillatorNode[] = [];
    for (const freq of [220, 311.13]) {
      // C4 and F#4 — a tritone apart
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t);
      // Fast downward pitch envelope at the tail, emphasising the "falling"
      // loss of momentum.
      o.frequency.setValueAtTime(freq, tailStart);
      o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
      o.connect(sum);
      oscs.push(o);
    }

    const nodes: AudioNode[] = [sum, crusher, ...oscs];
    this.#reap(oscs[0]!, nodes);
    for (const o of oscs) {
      o.start(t);
      o.stop(t + dur + 0.02);
    }
  }

  dispose(): void {
    this.#music = false;
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
