// The post-processing stack: bloom (the single effect that sells "neon"),
// plus three archive-ageing effects that stay at zero for today and ramp up
// for older days — see setArchiveAge() and plan.md's "Age the archive".
//
// Everything here is already vendored in three@0.182.0's examples/jsm, so
// this file adds no dependency (plan.md constraint #2).
//
// Pass order matters: RenderPass and UnrealBloomPass must combine in linear
// HDR space before anything tonemaps, so OutputPass (which applies the
// renderer's configured toneMapping + colour-space conversion) goes last.
// The ageing passes sit between the two — cheap, and their exact position
// relative to tonemapping doesn't matter for effects this subtle.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { RGBShiftShader } from "three/addons/shaders/RGBShiftShader.js";
import { FilmShader } from "three/addons/shaders/FilmShader.js";
import { HueSaturationShader } from "three/addons/shaders/HueSaturationShader.js";

export interface PostFXOptions {
  /** Low-spec / prefers-reduced-motion fallback: render plain, no bloom. */
  reducedEffects: boolean;
}

export class PostFX {
  #active: boolean;
  #composer: EffectComposer;
  #rgbShift: InstanceType<typeof ShaderPass>;
  #film: InstanceType<typeof ShaderPass>;
  #hueSat: InstanceType<typeof ShaderPass>;
  #renderer: THREE.WebGLRenderer;
  #scene: THREE.Scene;
  #camera: THREE.Camera;
  #clock = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, options: PostFXOptions) {
    this.#renderer = renderer;
    this.#scene = scene;
    this.#camera = camera;
    this.#active = !options.reducedEffects;

    const size = new THREE.Vector2();
    renderer.getSize(size);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(size, 0.5, 0.4, 0.9));

    const hueSat = new ShaderPass(HueSaturationShader);
    hueSat.uniforms.saturation!.value = 0;
    composer.addPass(hueSat);

    const rgbShift = new ShaderPass(RGBShiftShader);
    rgbShift.uniforms.amount!.value = 0;
    composer.addPass(rgbShift);

    const film = new ShaderPass(FilmShader);
    film.uniforms.intensity!.value = 0;
    film.uniforms.grayscale!.value = false;
    composer.addPass(film);

    composer.addPass(new OutputPass());

    this.#composer = composer;
    this.#hueSat = hueSat;
    this.#rgbShift = rgbShift;
    this.#film = film;
  }

  get active(): boolean {
    return this.#active;
  }

  /** The "reduce effects" toggle (plan.md Phase 4, low-spec fallback) — skips the whole composer at render time. */
  setActive(active: boolean): void {
    this.#active = active;
  }

  resize(width: number, height: number): void {
    this.#composer.setSize(width, height);
  }

  /**
   * 0 = today, crisp. Climbs toward 1 the further back the selected day is —
   * see days.ts for how age is computed. This is the one place the
   * aesthetic and the archive mechanic are the same idea: older runs don't
   * just look different, they look like a worn tape of themselves.
   */
  setArchiveAge(age: number): void {
    const a = Math.max(0, Math.min(1, age));
    this.#rgbShift.uniforms.amount!.value = a * 0.0035;
    this.#film.uniforms.intensity!.value = a * 0.35;
    this.#hueSat.uniforms.saturation!.value = -a * 0.25;
  }

  render(dt: number): void {
    if (!this.#active) {
      this.#renderer.render(this.#scene, this.#camera);
      return;
    }
    this.#clock += dt;
    this.#film.uniforms.time!.value = this.#clock;
    this.#composer.render(dt);
  }
}
