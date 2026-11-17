import * as THREE from "three";
import { piecePalette, type Team } from "../../shared/catalogue";
import { CAPTURE_RADIUS, CAPTURE_STATE, type CaptureState } from "../../shared/raids";
import { bakeModel, packMaterial } from "./packs";
import { NO_CAST } from "./shadows";

/*
 * Raids, as they show on the plots: a banner in the plot's colours on every
 * Hearth (the captor's while a raid's shield lasts), a pale shimmering dome
 * over a shielded Hearth, and, while raiders are ashore, a ring round the
 * plinth that fills as they take it.
 */

/* The banner on the plinth, at the front beside the fire (the tall flag stands behind), and its size. */
const FLAG_AT = { x: 1.7, z: 1.1 };
const FLAG_SCALE = 4.6;
/* The dome over a shielded Hearth. */
const DOME = 11;

const DOME_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const DOME_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vLocal;
  void main() {
    float rim = 1.0 - abs(dot(normalize(vNormal), vView));
    float edge = pow(rim, 2.4);
    /* Slow bands rising up it, and a faint lattice. */
    float bands = 0.5 + 0.5 * sin(vLocal.y * 1.6 - uTime * 1.8);
    float cells = smoothstep(0.92, 1.0, abs(sin(atan(vLocal.z, vLocal.x) * 18.0)))
      + smoothstep(0.92, 1.0, abs(sin(vLocal.y * 2.2)));
    float a = edge * 0.45 + bands * 0.03 + cells * 0.05;
    /* Fading out where it meets the ground. */
    a *= smoothstep(0.0, 1.2, vLocal.y);
    gl_FragColor = vec4(uColor, a);
  }
`;

const RING_VERTEX = /* glsl */ `
  varying vec2 vPos;
  void main() {
    vPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/* The ring fills clockwise from the front: bright up to `uProgress`, a faint track after. */
const RING_FRAGMENT = /* glsl */ `
  uniform float uProgress;
  uniform float uPulse;
  uniform vec3 uColor;
  varying vec2 vPos;
  void main() {
    float a = atan(vPos.x, vPos.y) / 6.28318 + 0.5;
    float on = step(a, uProgress);
    vec3 c = mix(vec3(1.0), uColor, on);
    gl_FragColor = vec4(c, mix(0.28, 0.9 * uPulse, on));
  }
`;

const RAID_RED = new THREE.Color(0xff4a3d);
const CONTESTED = new THREE.Color(0xffc247);

type Marks = {
  root: THREE.Group;
  flag: THREE.Mesh | null;
  team: Team | null;
  dome: THREE.Mesh;
  domeMat: THREE.ShaderMaterial;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  /* What's shown: 0..1 of a capture, and how it's going (null: no raid about). */
  progress: number;
  state: CaptureState | null;
};

export type HearthSpot = { x: number; y: number; z: number; rot: number };

export class RaidView {
  readonly group = new THREE.Group();
  private marks = new Map<number, Marks>();
  private domeGeo = new THREE.SphereGeometry(DOME, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  private ringGeo = new THREE.RingGeometry(CAPTURE_RADIUS - 0.35, CAPTURE_RADIUS + 0.25, 72, 1);
  private disposed = false;

  /* A plot's Hearth: where it is and which way it faces. */
  place(id: number, at: HearthSpot) {
    let m = this.marks.get(id);
    if (!m) {
      const root = new THREE.Group();
      const domeMat = new THREE.ShaderMaterial({
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x9fe8ff) } },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const dome = new THREE.Mesh(this.domeGeo, domeMat);
      dome.visible = false;
      dome.renderOrder = 3;
      dome.layers.set(NO_CAST);
      const ringMat = new THREE.ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: {
          uProgress: { value: 0 },
          uPulse: { value: 1 },
          uColor: { value: RAID_RED.clone() },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
      });
      const ring = new THREE.Mesh(this.ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      ring.renderOrder = 3;
      ring.layers.set(NO_CAST);
      root.add(dome, ring);
      this.group.add(root);
      m = {
        root,
        flag: null,
        team: null,
        dome,
        domeMat,
        ring,
        ringMat,
        progress: 0,
        state: null,
      };
      this.marks.set(id, m);
    }
    /* The plinth's top is a metre up; the dome and ring stand on the ground round it. */
    m.root.position.set(at.x, at.y - 1, at.z);
    m.root.rotation.y = at.rot;
    m.ring.position.y = 0.07;
  }

  remove(id: number) {
    const m = this.marks.get(id);
    if (!m) return;
    this.group.remove(m.root);
    m.domeMat.dispose();
    m.ringMat.dispose();
    this.marks.delete(id);
  }

  /* The colours flying on its Hearth, and whether its shield is up. */
  setState(id: number, team: Team, shield: boolean) {
    const m = this.marks.get(id);
    if (!m) return;
    m.dome.visible = shield;
    if (m.team === team) return;
    m.team = team;
    const made = m;
    void bakeModel("castle/flag").then((baked) => {
      if (this.disposed || made.team !== team || !this.marks.has(id)) return;
      if (made.flag) made.root.remove(made.flag);
      const palette = piecePalette(
        { model: "castle/flag", x: 0, y: 0, z: 0, rot: 0, scale: 1 },
        team,
      );
      const flag = new THREE.Mesh(baked.geo, packMaterial(palette));
      flag.position.set(FLAG_AT.x, 1, FLAG_AT.z);
      /* The cloth flies outward, side on to anyone coming up the path. */
      flag.rotation.y = -Math.PI / 2;
      flag.scale.setScalar(FLAG_SCALE);
      flag.castShadow = true;
      made.root.add(flag);
      made.flag = flag;
    });
  }

  /* How its capture is going: 0..1, and taking, contested or falling back (null: no raid). */
  setCapture(id: number, progress: number, state: CaptureState | null) {
    const m = this.marks.get(id);
    if (!m) return;
    m.progress = progress;
    m.state = state;
  }

  update(t: number) {
    for (const m of this.marks.values()) {
      m.domeMat.uniforms.uTime.value = t;
      m.ring.visible = m.state !== null;
      if (!m.ring.visible) continue;
      const u = m.ringMat.uniforms;
      u.uProgress.value = m.progress;
      const contested = m.state === CAPTURE_STATE.contested;
      (u.uColor.value as THREE.Color).copy(contested ? CONTESTED : RAID_RED);
      u.uPulse.value =
        m.state === CAPTURE_STATE.taking
          ? 0.8 + 0.2 * Math.sin(t * 8)
          : contested
            ? 0.55 + 0.45 * Math.sin(t * 5)
            : 0.6;
    }
  }

  clear() {
    for (const id of [...this.marks.keys()]) this.remove(id);
  }

  dispose() {
    this.disposed = true;
    this.clear();
    this.domeGeo.dispose();
    this.ringGeo.dispose();
  }
}
