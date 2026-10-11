// Low-poly wedge car shared by the player and every ghost. The neon aesthetic
// puts the detail in the glow lines, not the surface, so the body is a plain
// dark extrusion and EdgesGeometry traces it. Geometry is built once at module
// scope (up to ~10 ghosts share it); only materials are per-instance.
import * as THREE from "three";
import { gunmetal, palette } from "./palette.ts";

// Physics fixes the envelope at 1.2 x 2.2; callers sit the group at y = 0.5, so
// the wheel contact patch must land at y = -0.5. The car faces -Z.
const GROUND_Y = -0.5;
const BODY_WIDTH = 1.05; // narrower than the 1.2 envelope so wheels sit proud
const LENGTH = 2.2;
const WHEEL_R = 0.26;
const WHEEL_W = 0.15;
const WHEEL_X = 0.52;
const WHEEL_Z = 0.62;

// Side profile: x along the car (nose at high x), y above the ground. A short
// set-back cabin, steeply raked windshield and a long low nose is what reads
// as Countach at this poly count.
const profile: Array<[number, number]> = [
  [0.0, 0.18], [0.0, 0.4], [0.35, 0.44], [0.75, 0.46], [1.05, 0.62], [1.4, 0.62],
  [1.78, 0.34], [2.1, 0.26], [2.2, 0.2], [2.2, 0.1], [1.6, 0.08], [0.4, 0.08],
];

function buildBody(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  profile.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: BODY_WIDTH, bevelEnabled: false });
  // rotateY(+90deg) maps profile x to -z, so the nose (high x) ends up at -Z.
  g.rotateY(Math.PI / 2);
  g.translate(-BODY_WIDTH / 2, GROUND_Y, LENGTH / 2);
  return g;
}

const bodyGeometry = buildBody();
const bodyEdges = new THREE.EdgesGeometry(bodyGeometry, 1);

// Cylinders default to a Y axis; the wheels spin about X.
const wheelGeometry = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 10).rotateZ(Math.PI / 2);
const wheelEdges = new THREE.EdgesGeometry(wheelGeometry, 1);
const rimGeometry = new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.03, 10).rotateZ(Math.PI / 2);

const wingGeometry = new THREE.BoxGeometry(1.0, 0.03, 0.2);
const wingEdges = new THREE.EdgesGeometry(wingGeometry, 1);
const strutGeometry = new THREE.BoxGeometry(0.04, 0.12, 0.06);
const headlightGeometry = new THREE.BoxGeometry(0.2, 0.03, 0.08);
const taillightGeometry = new THREE.BoxGeometry(0.7, 0.04, 0.02);

const WHEEL_SPOTS: Array<[number, number]> = [
  [-WHEEL_X, -WHEEL_Z], [WHEEL_X, -WHEEL_Z], [-WHEEL_X, WHEEL_Z], [WHEEL_X, WHEEL_Z],
];
const WHEEL_Y = GROUND_Y + WHEEL_R;
const WING_POS = new THREE.Vector3(0, 0.06, 0.95);

// toneMapped:false plus a colour pushed above 1.0 is what clears the bloom
// threshold (0.9); without it the lines render flat. linewidth is a no-op in
// WebGL, so bloom is the only thing that thickens them.
//
// The gain is deliberately modest. ADR 0003 records an earlier pass tuned so
// hot it "washed the player car's magenta out to pale pink" — past about 1.5
// the hue clips toward white, the lines fuse into a solid mass at distance,
// and the car stops being magenta, which is the one thing it has to be.
function neonLine(color: THREE.ColorRepresentation, opacity = 1, gain = 1.4): THREE.LineBasicMaterial {
  const m = new THREE.LineBasicMaterial({ toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
  m.color.set(color).multiplyScalar(gain);
  return m;
}

function neonFill(color: THREE.ColorRepresentation, gain = 1.5): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ toneMapped: false });
  m.color.set(color).multiplyScalar(gain);
  return m;
}

function place<T extends THREE.Object3D>(obj: T, x: number, y: number, z: number): T {
  obj.position.set(x, y, z);
  return obj;
}

export function createPlayerCar(): THREE.Group {
  const group = new THREE.Group();
  // No envMap anywhere in this scene, so any metalness above 0 has nothing to
  // reflect and just drives the hull toward black. The faint emissive is what
  // stops the rear face — the only face the player ever looks at, and the one
  // the key light never reaches — from reading as a hole in the road.
  const dark = new THREE.MeshStandardMaterial({
    color: gunmetal.three,
    flatShading: true,
    roughness: 0.6,
    // Violet, not magenta: magenta at any useful strength tints the whole hull
    // wine-red and the car stops reading as dark metal with magenta trim.
    emissive: palette.violet.three,
    emissiveIntensity: 0.09,
  });
  const trim = neonLine(palette.magenta.three);

  group.add(new THREE.Mesh(bodyGeometry, dark), new THREE.LineSegments(bodyEdges, trim));

  const wheelTrim = neonLine(palette.cyan.three, 1, 1.2);
  for (const [x, z] of WHEEL_SPOTS) {
    group.add(place(new THREE.Mesh(wheelGeometry, dark), x, WHEEL_Y, z));
    // The rim discs face outward, so they're edge-on and invisible from the
    // chase camera — the wheel outline is what actually reads from behind.
    group.add(place(new THREE.LineSegments(wheelEdges, wheelTrim), x, WHEEL_Y, z));
    const side = Math.sign(x);
    group.add(place(new THREE.Mesh(rimGeometry, neonFill(palette.cyan.three)), x + side * (WHEEL_W / 2 - 0.015), WHEEL_Y, z));
  }

  const wing = place(new THREE.Mesh(wingGeometry, dark), WING_POS.x, WING_POS.y, WING_POS.z);
  group.add(wing, place(new THREE.LineSegments(wingEdges, trim), WING_POS.x, WING_POS.y, WING_POS.z));
  for (const x of [-0.35, 0.35]) {
    group.add(place(new THREE.Mesh(strutGeometry, dark), x, WING_POS.y - 0.075, WING_POS.z));
  }

  for (const x of [-0.33, 0.33]) {
    group.add(place(new THREE.Mesh(headlightGeometry, neonFill(palette.laserCyan.three)), x, -0.19, -0.85));
  }
  // Red is the hazard colour here, so the tail strip stays thin and unbloomed.
  const tail = new THREE.MeshBasicMaterial({ color: palette.red.three });
  group.add(place(new THREE.Mesh(taillightGeometry, tail), 0, -0.2, LENGTH / 2 - 0.01));
  return group;
}

export function createGhostCar(color: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  // Barely-there volume hint; the wireframe is the ghost.
  const body = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  const lines = neonLine(color, 0.8, 1.1);

  group.add(new THREE.Mesh(bodyGeometry, body), new THREE.LineSegments(bodyEdges, lines));
  for (const [x, z] of WHEEL_SPOTS) {
    group.add(place(new THREE.LineSegments(wheelEdges, lines), x, WHEEL_Y, z));
  }
  group.add(place(new THREE.LineSegments(wingEdges, lines), WING_POS.x, WING_POS.y, WING_POS.z));
  return group;
}

export function disposeCarModel(group: THREE.Group): void {
  // Materials only: geometry is module-level and shared by every car.
  group.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
