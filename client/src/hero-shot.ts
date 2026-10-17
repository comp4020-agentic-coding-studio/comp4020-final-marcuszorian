// The title screen's car: a close-up of the player's own car in its equipped
// trim, parked, with its headlights actually lit.
//
// This reuses the ONE renderer, scene and camera the road already has rather
// than standing up a second of each. A title screen that renders its own
// scene would need its own copy of the sky, sun, fog and tonemapping to look
// like the same place — and would then drift from them. Instead the camera
// simply gets framed differently while the title screen is up, and the car
// sits at the origin where a run starts anyway.
import * as THREE from "three";

/**
 * How far the camera sits from the car. Close enough to read as a portrait
 * rather than a parking lot, far enough that a 2.2m car fits at this FOV.
 */
const DISTANCE = 6.4;
/**
 * Level with the car, per the brief — a hood-height shot, not the elevated
 * chase cam. The car group sits at y = 0.5 and its body spans roughly ±0.5
 * around that, so this is the middle of the bodywork rather than the ground.
 * A touch above dead-level so the car reads as a solid object rather than a
 * flat silhouette, but nowhere near the chase cam's 4.5.
 */
const HEIGHT = 0.35;
/**
 * 45° off the car's nose, per the brief.
 *
 * The camera stays directly in front of the car (-Z) and the CAR turns
 * instead — see HERO_TURN. Turning the subject rather than orbiting the
 * camera is what keeps "45° from the front" and "the car sits on the left,
 * facing the menu" from fighting each other: orbiting to put the nose in
 * view swings the camera around to the car's side, which is how the first
 * three attempts at this all rendered a profile.
 */
const ANGLE = 0;

/**
 * The car's own yaw for the portrait, in radians.
 *
 * It faces -Z by default (straight at the camera, a flat head-on shot) and
 * turning it gives the three-quarter front view the brief asks for — nose
 * and one flank at once. Turning it NEGATIVE points the nose to the right,
 * into the menu, rather than off the left edge of the screen.
 *
 * Slightly under 45° (π/3.2 ≈ 56° of turn, so ~34° off head-on) because this
 * car is long and low: at a true 45° the flank runs most of the frame width
 * and the shot reads as a profile. Pulling it toward the nose is what makes
 * it read as the 45° it nominally already was.
 */
export const HERO_TURN = -Math.PI / 3.2;
/**
 * How far left the car sits, as a fraction of viewport width.
 *
 * Applied with `setViewOffset`, which slides the projection FRUSTUM rather
 * than the camera — so the 45° above survives exactly. Both of the obvious
 * alternatives quietly destroy it: aiming at a point beside the car rotates
 * the camera, and dollying sideways swings it around the car. Either one
 * turns a front-quarter shot into a profile, which is what the first two
 * attempts at this actually rendered.
 */
const FRAME_SHIFT = 0.2;
/**
 * The portrait equivalent, as a fraction of viewport height: on a phone the
 * menu stacks below the car instead of beside it, so the car moves UP rather
 * than left to get out of its way.
 *
 * Small, because the menu's own gradient scrim already covers the bottom
 * ~40% — the car only has to clear the logo, not the whole menu. Lifting it
 * as far as FRAME_SHIFT pushes it sideways takes it off the top of the
 * screen entirely.
 */
const PORTRAIT_LIFT = 0.06;
/** A narrower FOV than the road's 70°: portraits flatter at longer focal lengths. */
export const HERO_FOV = 40;

/**
 * Where the hero car parks. The origin is where a run begins, so the title
 * car and the first frame of a race are the same object in the same place —
 * which is what lets the transition between them be a camera move and
 * nothing else.
 */
export const HERO_POSITION = new THREE.Vector3(0, 0.5, 0);

/**
 * Frames the parked car. Called every frame while a hero-shot screen is up —
 * cheap, and it means a resize or an aspect change is picked up for free.
 *
 * Deliberately NOT routed through CameraRig: that class exists to add lag,
 * shake and speed-widened FOV to a moving chase camera, and every one of
 * those is wrong for a still portrait. A paused title screen whose camera
 * drifts for half a second on arrival looks broken, not alive.
 */
export function frameHeroShot(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): void {
  const landscape = width >= height;
  // A portrait viewport is far narrower for the same FOV, so the same
  // distance frames the car much tighter — on a phone it filled the screen
  // and ran under the menu. Backing off restores roughly the same crop.
  const distance = landscape ? DISTANCE : DISTANCE * 1.5;

  camera.position.set(
    HERO_POSITION.x + Math.sin(ANGLE) * distance,
    HERO_POSITION.y + HEIGHT,
    HERO_POSITION.z - Math.cos(ANGLE) * distance,
  );
  camera.lookAt(HERO_POSITION);
  camera.fov = HERO_FOV;

  if (landscape) {
    // Push the car into the left half by offsetting the frustum, not the
    // camera — see FRAME_SHIFT. A full-size view taken from a point
    // FRAME_SHIFT·w right of centre slides everything in frame to the left.
    camera.setViewOffset(width, height, width * FRAME_SHIFT, 0, width, height);
  } else {
    // Portrait stacks the menu UNDER the car rather than beside it, so the
    // car shifts UP out of the menu's way instead of sideways. A negative
    // y-offset moves the frame down, which moves the subject up.
    camera.setViewOffset(width, height, 0, -height * PORTRAIT_LIFT, width, height);
  }
  camera.updateProjectionMatrix();
}

/**
 * Drops the frustum offset, so the chase camera gets a plain centred
 * projection back. Without this the whole road renders shifted off-centre
 * for the entire run — setViewOffset is sticky, and `resize()` recomputing
 * `camera.aspect` does not clear it.
 */
export function clearHeroFraming(camera: THREE.PerspectiveCamera): void {
  camera.clearViewOffset();
}

/**
 * Two spotlights at the car's headlights, throwing a real pool of light down
 * the road ahead of it.
 *
 * The headlight meshes themselves are already emissive and already bloom, so
 * this is not what makes them *visible* — it is what makes them *light
 * something*, which is most of what sells a hero shot. The cost is two
 * additional lights in the scene, which is why they are switched off entirely
 * during a run (see setHeadlightsActive): a race is where the 256MB box and a
 * phone GPU actually feel it, and a chase camera never sees the pool anyway.
 */
export function createHeadlights(): THREE.Group {
  const group = new THREE.Group();

  // Matches the headlight meshes in car-model.ts: x = ±0.33, y = -0.19
  // within a group sitting at y = 0.5, nose at z = -0.85.
  for (const x of [-0.33, 0.33]) {
    const light = new THREE.SpotLight(0xdff6ff, 14, 26, Math.PI / 7, 0.55, 1.4);
    light.position.set(x, 0.31, -0.85);
    // A SpotLight aims at its `target`, which must itself be in the scene
    // graph for its world matrix to update — a detail that silently leaves
    // the cone pointing at the world origin if the target is left floating.
    light.target.position.set(x * 2.2, 0.05, -16);
    group.add(light, light.target);
  }

  return group;
}

/** Headlights are a title-screen luxury, not something a race pays for. */
export function setHeadlightsActive(group: THREE.Group, active: boolean): void {
  group.visible = active;
}

/**
 * A key light for the portrait, from the camera's side of the car.
 *
 * The scene's existing rim light is aimed for a car seen from BEHIND at
 * speed, where the body is mostly silhouette and the neon edges do the work.
 * At a front-quarter close-up that leaves the hull reading as a hole with
 * wireframes floating in it — the bodywork needs something actually falling
 * on it. Like the headlights, this is off during a race, where the rim light
 * is correct and this one would flatten it.
 */
export function createHeroKeyLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xd8c4ff, 1.6);
  // Above and ahead on the camera's side, so the faces it lights are the
  // ones the shot actually shows: the nose and the near flank.
  light.position.set(-5, 5, -8);
  light.target.position.copy(HERO_POSITION);
  return light;
}
