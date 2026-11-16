import * as THREE from "three";
import { type CharacterId, type SkinId, skinDef } from "../../shared/skins";
import { edges, flatten, inkMaterial, lineMaterial } from "./materials";

/*
 * The characters players wear, built from the same flat ink faces and pale
 * edges as the rest of the island. Each skin is a small rig: a root standing
 * on the ground at the origin and facing -Z, a head the avatar can tilt, and
 * a right hand to hold weapons.
 */

export type Rig = {
  root: THREE.Group;
  head: THREE.Object3D;
  /* Where a held weapon goes. */
  hand: THREE.Object3D;
  /* How far the right arm lifts while holding something (0 for loose hands). */
  hold: number;
  /* Top of the head, for the name above it. */
  top: number;
  /* Steps per stride compared with the wanderer: heavy divers plod, buoys scurry. */
  cadence: number;
  /*
   * `phase` is how far along the walk cycle we are (radians), `walk` how much
   * of a walk to show (0 standing, 1 striding), `holding` whether a weapon is
   * in hand.
   */
  update(t: number, phase: number, walk: number, holding: boolean): void;
};

/* ---------- parts ---------- */

const fills = new Map<string, THREE.ShaderMaterial>();
function fill(tone: number, lit: number, op: number) {
  const key = `${tone}|${lit}|${op}`;
  let m = fills.get(key);
  if (!m) {
    m = inkMaterial(tone, { lit, side: THREE.DoubleSide });
    if (op < 1) {
      m.uniforms.uOpacity.value = op;
      m.transparent = true;
      m.depthWrite = false;
    }
    fills.set(key, m);
  }
  return m;
}

const lines = new Map<string, THREE.ShaderMaterial>();
function line(tone: number, op: number) {
  const key = `${tone}|${op}`;
  let m = lines.get(key);
  if (!m) {
    m = lineMaterial(tone, op);
    lines.set(key, m);
  }
  return m;
}

type PartOpts = {
  lit?: number;
  op?: number;
  edge?: boolean;
  angle?: number;
  line?: number;
  lineOp?: number;
};

function part(geo: THREE.BufferGeometry, tone = 0.045, o: PartOpts = {}) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(flatten(geo), fill(tone, o.lit ?? 0, o.op ?? 1)));
  if (o.edge !== false)
    g.add(new THREE.LineSegments(edges(geo, o.angle ?? 25), line(o.line ?? 0.85, o.lineOp ?? 1)));
  geo.dispose();
  return g;
}

const grp = () => new THREE.Group();

function put<T extends THREE.Object3D>(
  parent: THREE.Object3D,
  obj: T,
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
) {
  obj.position.set(x, y, z);
  obj.rotation.set(rx, ry, rz);
  parent.add(obj);
  return obj;
}

const lathe = (pts: [number, number][], segs = 7) =>
  new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    segs,
  );
const cyl = (rt: number, rb: number, h: number, segs = 6, open = false) =>
  new THREE.CylinderGeometry(rt, rb, h, segs, 1, open);
/* A limb hanging from its pivot at the top. */
const limb = (len: number, rt: number, rb: number, segs = 6) => {
  const g = cyl(rt, rb, len, segs);
  g.translate(0, -len / 2, 0);
  return g;
};
const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const torus = (r: number, t: number, rs = 4, ts = 10) => new THREE.TorusGeometry(r, t, rs, ts);
const cone = (r: number, h: number, segs = 6) => new THREE.ConeGeometry(r, h, segs);
/* A sphere drawn as a lathe, so its edges are tidy rings and meridians. */
function ball(r: number, rings = 5, segs = 8) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / rings;
    pts.push([Math.max(0.001, Math.cos(a) * r), Math.sin(a) * r]);
  }
  return lathe(pts, segs);
}

let glowTex: THREE.CanvasTexture | null = null;
/* A soft additive halo for anything that gives off light. */
function glow(size: number, opacity: number) {
  if (!glowTex) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.35)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      opacity,
      fog: false,
    }),
  );
  s.scale.set(size, size, 1);
  return s;
}

/* ---------- 1. Hollow Wanderer ---------- */

/* The skull from the site's logo, extruded into a mask. */
function skullShape() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.62);
  s.bezierCurveTo(0.42, 0.62, 0.53, 0.3, 0.5, 0.05);
  s.bezierCurveTo(0.48, -0.14, 0.37, -0.2, 0.33, -0.32);
  s.lineTo(0.25, -0.56);
  s.quadraticCurveTo(0, -0.68, -0.25, -0.56);
  s.lineTo(-0.33, -0.32);
  s.bezierCurveTo(-0.37, -0.2, -0.48, -0.14, -0.5, 0.05);
  s.bezierCurveTo(-0.53, 0.3, -0.42, 0.62, 0, 0.62);
  const eye = (cx: number) => {
    const p = new THREE.Path();
    p.absellipse(cx, -0.02, 0.135, 0.12, 0, Math.PI * 2, true, 0);
    return p;
  };
  const nose = new THREE.Path();
  nose.moveTo(0, -0.12);
  nose.lineTo(-0.065, -0.27);
  nose.lineTo(0.065, -0.27);
  nose.lineTo(0, -0.12);
  s.holes.push(eye(-0.2), eye(0.2), nose);
  return s;
}

const MASK_EXTRUDE = {
  bevelEnabled: true,
  bevelThickness: 0.015,
  bevelSize: 0.01,
  bevelSegments: 1,
};

function wanderer(v: number): Rig {
  const root = grp();
  const body = put(root, grp());
  const legs = [-1, 1].map((sd) => {
    const hip = put(body, grp(), 0.14 * sd, 0.62, 0);
    put(hip, part(limb(0.56, 0.07, 0.06), 0.03));
    put(hip, part(box(0.13, 0.08, 0.22), 0.09), 0, -0.55, -0.04);
    return hip;
  });
  put(
    body,
    part(
      lathe([
        [0.001, 0.38],
        [0.44, 0.38],
        [0.42, 0.6],
        [0.35, 0.95],
        [0.33, 1.08],
        [0.4, 1.28],
        [0.32, 1.4],
        [0.15, 1.46],
        [0.001, 1.47],
      ]),
      0.045,
      { angle: 18 },
    ),
  );
  const arms = [-1, 1].map((sd) => {
    const sh = put(body, grp(), 0.38 * sd, 1.3, 0, 0, 0, 0.1 * sd);
    put(sh, part(limb(0.55, 0.07, 0.14), 0.05, { angle: 18 }));
    const hand = put(sh, grp(), 0, -0.6, 0);
    put(hand, part(ico(0.07), 0.3, { lit: 0.35 }));
    return { sh, hand };
  });
  const head = put(body, grp(), 0, 1.45, 0);
  put(
    head,
    part(
      lathe(
        [
          [0.001, 0.57],
          [0.1, 0.5],
          [0.22, 0.39],
          [0.28, 0.23],
          [0.27, 0.07],
          [0.2, -0.03],
          [0.001, -0.04],
        ],
        8,
      ),
      0.045,
      { angle: 18 },
    ),
    0,
    0,
    0.03,
  );
  if (v === 0) {
    const m = new THREE.ExtrudeGeometry(skullShape(), {
      depth: 0.07,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.015,
      bevelSegments: 1,
      curveSegments: 10,
    });
    m.rotateY(Math.PI);
    m.scale(0.36, 0.36, 0.36);
    m.translate(0, 0.2, -0.24);
    put(head, part(m, 0.78, { lit: 0.06, angle: 50 }));
  } else if (v === 1) {
    put(head, part(cyl(0.15, 0.15, 0.04, 10), 0.78, { lit: 0.06 }), 0, 0.2, -0.23, Math.PI / 2);
    put(head, part(cone(0.075, 0.42, 4), 0.7, { lit: 0.04 }), 0, 0.13, -0.45, -Math.PI / 2 - 0.25);
    for (const sd of [-1, 1])
      put(head, part(torus(0.045, 0.014, 3, 8), 0.02), 0.07 * sd, 0.25, -0.26);
  } else {
    const s = new THREE.Shape();
    s.absellipse(0, 0, 0.17, 0.23, 0, Math.PI * 2, false, 0);
    const slit = new THREE.Path();
    slit.moveTo(-0.13, 0.03);
    slit.lineTo(0.13, 0.03);
    slit.lineTo(0.11, 0.065);
    slit.lineTo(-0.11, 0.065);
    slit.lineTo(-0.13, 0.03);
    s.holes.push(slit);
    const m = new THREE.ExtrudeGeometry(s, { depth: 0.05, ...MASK_EXTRUDE, curveSegments: 12 });
    m.rotateY(Math.PI);
    m.translate(0, 0.18, -0.22);
    put(head, part(m, 0.78, { lit: 0.06, angle: 50 }));
    put(head, part(box(0.01, 0.14, 0.01), 0.02, { edge: false }), 0.06, 0.08, -0.29, 0, 0, 0.3);
  }
  return {
    root,
    head,
    hand: arms[1].hand,
    hold: 0.6,
    top: 2.45,
    cadence: 1,
    update(t, p, w, holding) {
      const s = Math.sin(p);
      body.position.y = Math.abs(Math.cos(p)) * 0.06 * w + Math.sin(t * 1.7) * 0.008 * (1 - w);
      body.rotation.z = s * 0.04 * w;
      legs[0].rotation.x = s * 0.6 * w;
      legs[1].rotation.x = -s * 0.6 * w;
      arms[0].sh.rotation.x = -s * 0.45 * w;
      arms[1].sh.rotation.x = holding ? 0.6 : s * 0.45 * w;
      head.rotation.set(0, Math.sin(t * 0.6) * 0.25 * (1 - w), 0);
    },
  };
}

/* ---------- 2. Lantern Keeper ---------- */

function lantern(v: number): Rig {
  const root = grp();
  const body = put(root, grp());
  const cloak = put(body, grp());
  put(
    cloak,
    part(
      lathe(
        [
          [0.001, 0.3],
          [0.06, 0.32],
          [0.18, 0.6],
          [0.3, 0.95],
          [0.38, 1.25],
          [0.36, 1.38],
          [0.2, 1.45],
          [0.001, 1.46],
        ],
        6,
      ),
      0.045,
      { angle: 18 },
    ),
  );
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    put(
      cloak,
      part(cone(0.06, 0.4, 4), 0.045),
      Math.sin(a) * 0.12,
      0.3,
      Math.cos(a) * 0.12,
      Math.PI + Math.cos(a) * 0.3,
      0,
      -Math.sin(a) * 0.3,
    );
  }
  put(body, part(torus(0.17, 0.05, 4, 8), 0.05), 0, 1.45, 0, Math.PI / 2);
  const hands = [-1, 1].map((sd) => {
    const h = put(body, grp(), 0.56 * sd, 1, -0.05);
    put(h, part(ico(0.085), 0.3, { lit: 0.38 }));
    return h;
  });
  const head = put(body, grp(), 0, 1.5, 0);
  let flame: THREE.Object3D;
  if (v === 0) {
    put(head, part(cyl(0.2, 0.2, 0.05, 6), 0.06), 0, 0.03, 0);
    put(head, part(cyl(0.17, 0.17, 0.34, 6, true), 0.1, { op: 0.22 }), 0, 0.22, 0);
    put(head, part(cone(0.23, 0.16, 6), 0.06), 0, 0.47, 0);
    put(head, part(torus(0.08, 0.016, 3, 8), 0.1), 0, 0.6, 0);
    flame = put(head, part(ico(0.09), 0.5, { lit: 0.6 }), 0, 0.22, 0);
    put(head, glow(0.9, 0.5), 0, 0.22, 0);
  } else if (v === 1) {
    put(head, part(cyl(0.16, 0.18, 0.42, 7), 0.3, { lit: 0.3 }), 0, 0.21, 0);
    put(head, part(torus(0.15, 0.025, 3, 8), 0.3, { lit: 0.3 }), 0, 0.42, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + 0.4;
      put(
        head,
        part(cyl(0.025, 0.03, 0.12 + (i % 2) * 0.08, 5), 0.3, { lit: 0.3 }),
        Math.sin(a) * 0.17,
        0.33 - (i % 2) * 0.04,
        Math.cos(a) * 0.17,
      );
    }
    flame = put(
      head,
      part(
        lathe(
          [
            [0.001, 0],
            [0.065, 0.06],
            [0.05, 0.14],
            [0.001, 0.27],
          ],
          5,
        ),
        0.5,
        { lit: 0.6 },
      ),
      0,
      0.44,
      0,
    );
    put(head, glow(0.8, 0.55), 0, 0.56, 0);
  } else {
    put(
      head,
      part(
        lathe([
          [0.001, 0],
          [0.19, 0],
          [0.21, 0.06],
          [0.21, 0.3],
          [0.15, 0.4],
          [0.07, 0.46],
          [0.07, 0.58],
          [0.001, 0.58],
        ]),
        0.1,
        { op: 0.2 },
      ),
    );
    put(head, part(cyl(0.075, 0.065, 0.1, 6), 0.25), 0, 0.62, 0);
    flame = put(head, part(ico(0.1), 0.5, { lit: 0.6 }), 0, 0.18, 0);
    put(head, glow(0.8, 0.5), 0, 0.18, 0);
  }
  const embers: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++)
    embers.push(
      put(root, part(new THREE.OctahedronGeometry(0.03), 0.5, { lit: 0.6, edge: false })),
    );
  return {
    root,
    head,
    hand: hands[1],
    hold: 0,
    top: 2.55,
    cadence: 1,
    update(t, p, w, holding) {
      const s = Math.sin(p);
      body.position.y = 0.18 + Math.sin(t * 2) * 0.06;
      body.rotation.x = -0.2 * w;
      cloak.rotation.set(0.12 * w + Math.sin(t * 3) * 0.03 * w, 0, Math.sin(t * 1.3) * 0.04);
      hands[0].position.set(-0.56, 1 + Math.sin(t * 2 + 1) * 0.05, -0.05 + s * 0.22 * w);
      if (holding) hands[1].position.set(0.5, 1.02 + Math.sin(t * 2 + 2) * 0.03, -0.3);
      else hands[1].position.set(0.56, 1 + Math.sin(t * 2 + 2) * 0.05, -0.05 - s * 0.22 * w);
      head.rotation.set(0, 0, Math.sin(t * 1.1) * 0.05);
      const f = 1 + Math.sin(t * 17) * 0.08 + Math.sin(t * 7.3) * 0.06;
      flame.scale.set(f, f * (v === 1 ? 1.1 : 1), f);
      embers.forEach((e, i) => {
        const ph = (t * 0.35 + i / 5) % 1;
        e.position.set(
          Math.sin(i * 1.7 + ph * 6) * 0.3,
          0.45 + ph * 1.5,
          0.15 + ph * 0.7 * (0.3 + w),
        );
        e.scale.setScalar(Math.max(0.001, Math.sin(ph * Math.PI)));
      });
    },
  };
}

/* ---------- 3. Salt Diver ---------- */

function diver(v: number): Rig {
  const root = grp();
  const body = put(root, grp());
  const legs = [-1, 1].map((sd) => {
    const hip = put(body, grp(), 0.15 * sd, 0.8, 0);
    put(hip, part(limb(0.6, 0.12, 0.11, 7), 0.06));
    put(hip, part(box(0.24, 0.18, 0.34), 0.14), 0, -0.66, -0.04);
    return hip;
  });
  put(
    body,
    part(
      lathe(
        [
          [0.001, 0.72],
          [0.26, 0.72],
          [0.33, 0.9],
          [0.35, 1.15],
          [0.33, 1.35],
          [0.22, 1.44],
          [0.001, 1.45],
        ],
        8,
      ),
      0.06,
      { angle: 18 },
    ),
  );
  put(body, part(torus(0.31, 0.035, 3, 8), 0.2), 0, 0.86, 0, Math.PI / 2);
  put(body, part(cyl(0.3, 0.33, 0.1, 8), 0.16, { lit: 0.04 }), 0, 1.47, 0);
  for (const sd of [-1, 1]) put(body, part(cyl(0.12, 0.12, 0.62, 7), 0.12), 0.13 * sd, 1.1, 0.36);
  const hose = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.13, 1.42, 0.38),
      new THREE.Vector3(0.36, 1.7, 0.3),
      new THREE.Vector3(0.3, 1.78, 0.05),
    ]),
    10,
    0.03,
    4,
  );
  put(body, part(hose, 0.03, { angle: 50 }));
  const arms = [-1, 1].map((sd) => {
    const sh = put(body, grp(), 0.42 * sd, 1.3, 0, 0, 0, 0.12 * sd);
    put(sh, part(limb(0.55, 0.11, 0.1, 7), 0.06));
    const hand = put(sh, grp(), 0, -0.6, 0);
    put(hand, part(ico(0.12), 0.14));
    return { sh, hand };
  });
  const head = put(body, grp(), 0, 1.5, 0);
  let fish: THREE.Object3D | null = null;
  if (v === 0) {
    put(head, part(ball(0.32, 6, 8), 0.16, { lit: 0.04 }), 0, 0.27, 0);
    put(head, part(torus(0.13, 0.03, 4, 10), 0.25, { lit: 0.05 }), 0, 0.25, -0.3);
    put(head, part(cyl(0.12, 0.12, 0.03, 10), 0), 0, 0.25, -0.29, Math.PI / 2);
    for (const sd of [-1, 1])
      put(
        head,
        part(torus(0.08, 0.025, 4, 8), 0.25, { lit: 0.05 }),
        0.31 * sd,
        0.27,
        0,
        0,
        Math.PI / 2,
      );
    put(head, part(cyl(0.05, 0.05, 0.1, 6), 0.2), 0, 0.6, 0);
  } else if (v === 1) {
    put(head, part(ball(0.34, 6, 10), 0.12, { op: 0.16, lineOp: 0.6 }), 0, 0.3, 0);
    const face = put(head, grp(), 0, 0.26, 0);
    put(face, part(ico(0.14), 0.4, { lit: 0.3 }));
    for (const sd of [-1, 1])
      put(face, part(ico(0.025), 0, { edge: false }), 0.055 * sd, 0.02, -0.12);
    fish = put(head, grp(), 0, 0.4, 0);
    const f = put(fish, grp(), 0.22, 0, 0);
    put(f, part(ico(0.04), 0.4, { lit: 0.5, edge: false })).scale.set(0.6, 0.8, 1.8);
    put(f, part(cone(0.04, 0.07, 3), 0.4, { lit: 0.5, edge: false }), 0, 0, 0.09, -Math.PI / 2);
  } else {
    put(head, part(ball(0.3, 6, 8), 0.1), 0, 0.27, 0);
    put(head, part(torus(0.19, 0.04, 4, 12), 0.22, { lit: 0.05 }), 0, 0.25, -0.27);
    put(head, part(cyl(0.18, 0.18, 0.03, 12), 0), 0, 0.25, -0.26, Math.PI / 2);
    put(head, part(ico(0.05), 0.5, { lit: 0.6 }), 0, 0.25, -0.29);
    put(head, glow(0.45, 0.5), 0, 0.25, -0.32);
    put(head, part(box(0.035, 0.16, 0.44), 0.08), 0, 0.56, 0.02);
    put(head, part(cyl(0.06, 0.08, 0.12, 6), 0.2), 0.18, 0.52, -0.14, -0.6);
    put(head, glow(0.5, 0.45), 0.18, 0.56, -0.22);
  }
  return {
    root,
    head,
    hand: arms[1].hand,
    hold: 0.5,
    top: 2.55,
    cadence: 0.8,
    update(t, p, w, holding) {
      const s = Math.sin(p);
      body.position.y = Math.abs(Math.cos(p)) * 0.04 * w + Math.sin(t * 1.4) * 0.008 * (1 - w);
      body.rotation.z = s * 0.06 * w;
      legs[0].rotation.x = s * 0.45 * w;
      legs[1].rotation.x = -s * 0.45 * w;
      arms[0].sh.rotation.x = -s * 0.3 * w;
      arms[1].sh.rotation.x = holding ? 0.5 : s * 0.3 * w;
      head.rotation.set(0, Math.sin(t * 0.5) * 0.2 * (1 - w), 0);
      if (fish) fish.rotation.y = t * 1.6;
    },
  };
}

/* ---------- 4. Corsair Shade ---------- */

function corsair(v: number): Rig {
  const root = grp();
  const body = put(root, grp());
  const legs = [-1, 1].map((sd) => {
    const hip = put(body, grp(), 0.12 * sd, 0.8, 0);
    put(hip, part(limb(0.5, 0.05, 0.045, 5), 0.03));
    put(hip, part(cyl(0.085, 0.07, 0.26, 6), 0.08), 0, -0.6, 0);
    put(hip, part(box(0.12, 0.07, 0.25), 0.08), 0, -0.74, -0.05);
    return hip;
  });
  const coat = put(body, grp());
  put(
    coat,
    part(
      lathe(
        [
          [0.001, 0.5],
          [0.42, 0.5],
          [0.36, 0.8],
          [0.3, 1.1],
          [0.33, 1.35],
          [0.27, 1.45],
          [0.12, 1.5],
          [0.001, 1.5],
        ],
        8,
      ),
      0.045,
      { angle: 18 },
    ),
  );
  put(body, part(torus(0.315, 0.03, 3, 8), 0.3), 0, 1.02, 0, Math.PI / 2);
  put(body, part(box(0.1, 0.08, 0.04), 0.5, { lit: 0.25 }), 0, 1.02, -0.32);
  put(body, part(cyl(0.21, 0.25, 0.24, 8, true), 0.045), 0, 1.58, 0);
  const arms = [-1, 1].map((sd) => {
    const sh = put(body, grp(), 0.36 * sd, 1.36, 0, 0, 0, 0.09 * sd);
    put(sh, part(limb(0.53, 0.09, 0.12), 0.05));
    put(sh, part(torus(0.12, 0.03, 3, 8), 0.3), 0, -0.52, 0, Math.PI / 2);
    const hand = put(sh, grp(), 0, -0.6, 0);
    put(hand, part(ico(0.06), 0.02));
    return { sh, hand };
  });
  const head = put(body, grp(), 0, 1.55, 0);
  put(head, part(ball(0.2, 4, 7), 0, { lineOp: 0.25 }), 0, 0.2, 0);
  const eyes = put(head, grp(), 0, 0.21, -0.19);
  for (const sd of [-1, 1]) {
    put(eyes, part(ico(0.032), 0.5, { lit: 0.6, edge: false }), 0.07 * sd, 0, 0);
    put(eyes, glow(0.2, 0.6), 0.07 * sd, 0, -0.01);
  }
  const plume: THREE.Object3D[] = [];
  if (v === 0) {
    put(head, part(cyl(0.48, 0.48, 0.05, 3), 0.045), 0, 0.37, 0, 0, Math.PI);
    put(head, part(cyl(0.18, 0.22, 0.22, 7), 0.045), 0, 0.48, 0);
    put(head, part(torus(0.215, 0.025, 3, 8), 0.3), 0, 0.4, 0, Math.PI / 2);
  } else if (v === 1) {
    put(
      head,
      part(
        lathe(
          [
            [0.62, 0.31],
            [0.44, 0.41],
            [0.23, 0.53],
            [0.001, 0.63],
          ],
          10,
        ),
        0.22,
        { lit: 0.02 },
      ),
    );
    put(head, part(torus(0.19, 0.02, 3, 8), 0.03), 0, 0.33, 0, Math.PI / 2);
  } else {
    const s = new THREE.Shape();
    s.absarc(0, 0, 0.47, 0, Math.PI, false);
    s.closePath();
    const hat = new THREE.ExtrudeGeometry(s, {
      depth: 0.15,
      bevelEnabled: false,
      curveSegments: 8,
    });
    hat.scale(1, 0.55, 1);
    hat.translate(0, 0, -0.075);
    put(head, part(hat, 0.045), 0, 0.33, 0);
    put(head, part(torus(0.07, 0.015, 3, 8), 0.5, { lit: 0.2 }), 0.22, 0.45, -0.08);
    let seg = put(head, grp(), -0.18, 0.5, 0, 0.5, 0, 0.3);
    for (let i = 0; i < 4; i++) {
      const c = cone(0.04 - i * 0.006, 0.2, 4);
      c.translate(0, 0.1, 0);
      put(seg, part(c, 0.6, { lit: 0.3 }));
      plume.push(seg);
      seg = put(seg, grp(), 0, 0.19, 0);
    }
  }
  const scarf: THREE.Object3D[] = [];
  let seg = put(body, grp(), 0.08, 1.52, 0.2);
  for (let i = 0; i < 5; i++) {
    const g = box(0.12, 0.025, 0.17);
    g.translate(0, 0, 0.085);
    put(seg, part(g, 0.35, { lit: 0.12 }));
    scarf.push(seg);
    seg = put(seg, grp(), 0, 0, 0.17);
  }
  return {
    root,
    head,
    hand: arms[1].hand,
    hold: 0.6,
    top: 2.55,
    cadence: 1.07,
    update(t, p, w, holding) {
      const s = Math.sin(p);
      body.position.y = Math.abs(Math.cos(p)) * 0.05 * w;
      body.rotation.z = s * 0.03 * w;
      legs[0].rotation.x = s * 0.7 * w;
      legs[1].rotation.x = -s * 0.7 * w;
      arms[0].sh.rotation.x = -s * 0.35 * w;
      arms[1].sh.rotation.x = holding ? 0.6 : s * 0.35 * w;
      coat.rotation.set(0.05 * w, 0, Math.sin(t * 1.2) * 0.015 + s * 0.02 * w);
      scarf.forEach((piece, i) => {
        piece.rotation.x =
          (i === 0 ? 1.25 - 0.85 * w : 0.12 - 0.05 * w) +
          Math.sin(t * 7 - i * 0.9) * (0.06 + 0.22 * w);
        piece.rotation.z = Math.sin(t * 2.3 - i) * 0.08;
      });
      plume.forEach((piece, i) => {
        piece.rotation.x =
          (i === 0 ? 0.6 : 0.35) + 0.15 * w + Math.sin(t * 5 - i) * 0.08 * (0.4 + w);
      });
      head.rotation.set(0, Math.sin(t * 0.55) * 0.3 * (1 - w), 0);
      eyes.scale.y = t % 4.2 < 0.12 ? 0.1 : 1;
    },
  };
}

/* ---------- 5. Buoy Folk ---------- */

function buoy(v: number): Rig {
  const root = grp();
  const body = put(root, grp());
  const legs = [-1, 1].map((sd) => {
    const hip = put(body, grp(), 0.16 * sd, 0.32, 0);
    put(hip, part(limb(0.2, 0.06, 0.06, 5), 0.03));
    put(hip, part(ico(0.09), 0.1), 0, -0.24, -0.03).scale.set(1, 0.6, 1.4);
    return hip;
  });
  const shell = put(body, grp());
  put(
    shell,
    part(
      lathe(
        [
          [0.001, 0.25],
          [0.3, 0.28],
          [0.42, 0.45],
          [0.46, 0.75],
        ],
        8,
      ),
      0.045,
    ),
  );
  const crusted = v === 2;
  put(
    shell,
    part(
      lathe(
        [
          [0.46, 0.75],
          [0.44, 1.05],
        ],
        8,
      ),
      crusted ? 0.045 : 0.4,
      { lit: crusted ? 0 : 0.5 },
    ),
  );
  put(
    shell,
    part(
      lathe(
        [
          [0.44, 1.05],
          [0.38, 1.3],
          [0.26, 1.5],
          [0.001, v === 1 ? 1.52 : 1.6],
        ],
        8,
      ),
      0.045,
    ),
  );
  put(shell, part(torus(0.15, 0.03, 4, 10), 0.25, { lit: 0.1 }), 0, 1.22, -0.37, -0.25);
  put(shell, part(cyl(0.14, 0.14, 0.03, 10), 0), 0, 1.22, -0.36, Math.PI / 2 - 0.25);
  const eyes = put(shell, grp(), 0, 1.23, -0.39);
  for (const sd of [-1, 1])
    put(eyes, part(ico(0.028), 0.5, { lit: 0.6, edge: false }), 0.05 * sd, 0, 0);
  const kelp: THREE.Object3D[] = [];
  let lens: THREE.Object3D | null = null;
  if (v === 0) {
    put(shell, part(cyl(0.03, 0.03, 0.08, 5), 0.1), 0, 1.62, 0);
    put(shell, part(torus(0.1, 0.025, 3, 8), 0.1), 0, 1.75, 0);
  } else if (v === 1) {
    put(shell, part(torus(0.22, 0.022, 3, 10), 0.3), 0, 1.54, 0, Math.PI / 2);
    put(shell, part(cyl(0.16, 0.16, 0.22, 6, true), 0.1, { op: 0.22 }), 0, 1.64, 0);
    lens = put(shell, grp(), 0, 1.64, 0);
    put(lens, part(ico(0.08), 0.5, { lit: 0.6 }));
    put(lens, glow(0.9, 0.55));
    put(shell, part(cone(0.22, 0.18, 6), 0.045), 0, 1.84, 0);
    put(shell, part(ico(0.03), 0.5, { lit: 0.3 }), 0, 1.95, 0);
  } else {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 12; i++) {
      const y = 0.45 + ((i * 0.37) % 1) * 0.95;
      const a = i * 2.4;
      /* Leave the porthole clear. */
      if (Math.cos(a) < -0.5 && y > 0.95 && y < 1.45) continue;
      const r = y < 0.75 ? 0.42 + (y - 0.45) * 0.13 : y < 1.05 ? 0.45 : 0.44 - (y - 1.05) * 0.4;
      const b = put(
        shell,
        part(cyl(0.025, 0.065, 0.07, 5), 0.25, { lit: 0.06 }),
        Math.sin(a) * r,
        y,
        Math.cos(a) * r,
      );
      b.quaternion.setFromUnitVectors(
        up,
        new THREE.Vector3(Math.sin(a), 0.3, Math.cos(a)).normalize(),
      );
    }
    let k = put(shell, grp(), 0.05, 1.58, 0.05);
    for (let i = 0; i < 4; i++) {
      const g = box(0.06, 0.18, 0.015);
      g.translate(0, 0.09, 0);
      put(k, part(g, 0.15, { lit: 0.08 }));
      kelp.push(k);
      k = put(k, grp(), 0, 0.17, 0);
    }
  }
  const hands = [-1, 1].map((sd) => {
    const h = put(body, grp(), 0.62 * sd, 0.85, 0);
    put(h, part(ico(0.09), 0.3, { lit: 0.35 }));
    return h;
  });
  return {
    root,
    head: shell,
    hand: hands[1],
    hold: 0,
    top: v === 1 ? 2.45 : 2.3,
    cadence: 1.13,
    update(t, p, w, holding) {
      const s = Math.sin(p);
      body.position.y = Math.abs(Math.cos(p)) * 0.07 * w + Math.sin(t * 1.8) * 0.01;
      legs[0].rotation.x = s * 0.6 * w;
      legs[1].rotation.x = -s * 0.6 * w;
      shell.rotation.set(-0.05 * w, 0, s * 0.12 * w);
      hands[0].position.set(-0.62, 0.85 + Math.sin(t * 2) * 0.05, s * 0.22 * w);
      if (holding) hands[1].position.set(0.55, 0.9 + Math.sin(t * 2 + 1.5) * 0.03, -0.3);
      else hands[1].position.set(0.62, 0.85 + Math.sin(t * 2 + 1.5) * 0.05, -s * 0.22 * w);
      eyes.scale.y = t % 3.7 < 0.12 ? 0.1 : 1;
      if (lens) lens.rotation.y = t * 2;
      kelp.forEach((piece, i) => {
        piece.rotation.set(
          0.15 * w + Math.sin(t * 1.5 - i) * 0.1,
          0,
          Math.sin(t * 2 - i * 0.8) * 0.25,
        );
      });
    },
  };
}

const BUILDERS: Record<CharacterId, (variant: number) => Rig> = {
  wanderer,
  lantern,
  diver,
  corsair,
  buoy,
};

export function buildRig(skin: SkinId): Rig {
  const def = skinDef(skin);
  return BUILDERS[def.character](def.variant);
}

/* Geometry is per rig; materials and the glow texture are shared and stay. */
export function disposeRig(rig: Rig) {
  rig.root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
    if (o instanceof THREE.Sprite) o.material.dispose();
  });
}
