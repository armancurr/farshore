import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { KIT_IDS, type KitId } from "../../shared/items";
import { localBlocks, type Prefab } from "../../shared/prefabs";
import type { Block } from "../../shared/structures";
import { compose } from "./batch";
import { buildDesertBike } from "./bikes";
import { InstancedModel, type Part } from "./instanced";
import { edges, flatten } from "./materials";

/*
 * Everything you've built. Each kind is one model per tone, drawn instanced,
 * so a dozen huts cost what one does. Campfire flames are the only thing per
 * copy, and there are only ever a few of those.
 */

type Tone = "dark" | "mid" | "light" | "glow";
const TONES: Record<Tone, { tone: number; lineTone: number; lit?: number }> = {
  dark: { tone: 0.05, lineTone: 0.8 },
  mid: { tone: 0.15, lineTone: 0.72 },
  light: { tone: 0.56, lineTone: 0.2 },
  glow: { tone: 0, lineTone: 0.9, lit: 0.95 },
};
const MAX_EACH = 40;

function blockGeo(b: Block) {
  const h = b.top - b.bottom;
  if (b.shape === "cyl") return new THREE.CylinderGeometry(b.hz, b.hx, h, b.sides ?? 10, 1);
  return new THREE.BoxGeometry(b.hx * 2, h, b.hz * 2);
}

/* Extra pieces drawn but never collided with: roofs, stones, trim. */
function decor(kind: KitId): (Part & { tone: Tone })[] {
  const out: (Part & { tone: Tone })[] = [];
  switch (kind) {
    case "campfire": {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        out.push({
          geo: new THREE.IcosahedronGeometry(0.15, 0),
          matrix: compose(Math.cos(a) * 0.55, 0.06, Math.sin(a) * 0.55, a, 1, 0.7, 1.2),
          tone: "mid",
        });
      }
      for (const a of [0, 1.1, 2.2]) {
        out.push({
          geo: new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6),
          matrix: compose(0, 0.12, 0, a, 1, 1, 1, Math.PI / 2 - 0.25),
          tone: "dark",
        });
      }
      break;
    }
    case "chest":
      for (const lx of [-0.3, 0.3])
        out.push({
          geo: new THREE.BoxGeometry(0.06, 0.6, 0.62),
          matrix: compose(lx, 0.3, 0),
          tone: "light",
        });
      break;
    case "hut": {
      const roof = new THREE.ConeGeometry(2.95, 1.5, 4, 1);
      out.push({
        geo: roof,
        matrix: compose(0, 2.94 + 0.75, 0, Math.PI / 4),
        tone: "mid",
        angle: 20,
      });
      out.push({
        geo: new THREE.OctahedronGeometry(0.09, 0),
        matrix: compose(0.9, 2.45, -1.2),
        tone: "glow",
      });
      break;
    }
    case "cabin": {
      const tri = new THREE.Shape();
      tri.moveTo(-3.1, 0);
      tri.lineTo(3.1, 0);
      tri.lineTo(0, 1.9);
      tri.closePath();
      const gable = new THREE.ExtrudeGeometry(tri, { depth: 7.2, bevelEnabled: false });
      gable.translate(0, 0, -3.6);
      out.push({ geo: gable, matrix: compose(0, 3.12, 0), tone: "mid", angle: 20 });
      /* Porch roof, sloping down from the wall. */
      out.push({
        geo: new THREE.BoxGeometry(5.8, 0.1, 1.9),
        matrix: compose(0, 2.75, 4.2, 0, 1, 1, 1, 0.18),
        tone: "dark",
      });
      out.push({
        geo: new THREE.OctahedronGeometry(0.09, 0),
        matrix: compose(1.6, 2.7, -2),
        tone: "glow",
      });
      out.push({
        geo: new THREE.OctahedronGeometry(0.08, 0),
        matrix: compose(1.2, 2.2, 4.3),
        tone: "glow",
      });
      break;
    }
    case "dock":
      for (const s of [-1, 1])
        out.push({
          geo: new THREE.CylinderGeometry(0.13, 0.15, 0.5, 8),
          matrix: compose(s * 0.95, 0.25, -12.05),
          tone: "dark",
        });
      out.push({
        geo: new THREE.BoxGeometry(0.08, 1.8, 0.08),
        matrix: compose(-1.1, 0.9, -12.1),
        tone: "dark",
      });
      out.push({
        geo: new THREE.OctahedronGeometry(0.1, 0),
        matrix: compose(-1.1, 1.9, -12.1),
        tone: "glow",
      });
      break;
    case "rowboat":
      /* Only ever seen as a ghost: the real boats are drawn by the boat view. */
      out.push({
        geo: new THREE.BoxGeometry(1.3, 0.5, 2.6),
        matrix: compose(0, 0.05, 0.35),
        tone: "mid",
      });
      out.push({
        geo: new THREE.ConeGeometry(0.65, 1.2, 4, 1),
        matrix: compose(0, 0.05, -1.55, Math.PI / 4, 1, 1, 0.7, -Math.PI / 2),
        tone: "mid",
      });
      break;
    default:
      break;
  }
  return out;
}

/* All the parts of a kind, by tone, in its own space. */
function partsOf(kind: KitId) {
  const byTone = new Map<Tone, Part[]>();
  const add = (tone: Tone, p: Part) => {
    let list = byTone.get(tone);
    if (!list) byTone.set(tone, (list = []));
    list.push(p);
  };
  for (const b of localBlocks(kind)) {
    if (b.hidden) continue;
    add(b.tone, {
      geo: blockGeo(b),
      matrix: compose(b.x, (b.bottom + b.top) / 2, b.z, b.rot),
      angle: b.shape === "cyl" ? 35 : 20,
    });
  }
  for (const d of decor(kind)) add(d.tone, d);
  return byTone;
}

const GHOST_OK = new THREE.Color(0.42, 0.86, 0.52);
const GHOST_NO = new THREE.Color(0.95, 0.36, 0.34);
const GHOST_PICK = new THREE.Color(1, 1, 1);

/* A see-through copy of a kind, to show where it would go. */
class Ghost {
  readonly group = new THREE.Group();
  private line = new THREE.LineBasicMaterial({ color: GHOST_OK, transparent: true, opacity: 0.95 });
  private fill = new THREE.MeshBasicMaterial({
    color: GHOST_OK,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  private models = new Map<KitId, THREE.Group>();
  private kind: KitId | null = null;

  show(kind: KitId | null, x = 0, y = 0, z = 0, rot = 0, color: "ok" | "no" | "pick" = "ok") {
    if (kind !== this.kind) {
      for (const g of this.models.values()) g.visible = false;
      this.kind = kind;
    }
    this.group.visible = !!kind;
    if (!kind) return;
    let model = this.models.get(kind);
    if (!model) {
      model = this.build(kind);
      this.models.set(kind, model);
      this.group.add(model);
    }
    model.visible = true;
    model.position.set(x, y, z);
    model.rotation.y = rot;
    const c = color === "ok" ? GHOST_OK : color === "no" ? GHOST_NO : GHOST_PICK;
    this.line.color.copy(c);
    this.fill.color.copy(c);
    this.fill.opacity = color === "pick" ? 0.08 : 0.16;
  }

  private build(kind: KitId) {
    if (kind === "desertbike") {
      const bike = buildDesertBike();
      bike.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = this.fill;
        else if ((o as THREE.LineSegments).isLineSegments)
          (o as THREE.LineSegments).material = this.line;
        o.renderOrder = 4;
      });
      return bike;
    }
    const fills: THREE.BufferGeometry[] = [];
    const lines: THREE.BufferGeometry[] = [];
    for (const parts of partsOf(kind).values()) {
      for (const p of parts) {
        const f = flatten(p.geo);
        f.applyMatrix4(p.matrix);
        f.deleteAttribute("normal");
        fills.push(f);
        const l = edges(p.geo, p.angle ?? 28);
        l.applyMatrix4(p.matrix);
        lines.push(l);
        p.geo.dispose();
      }
    }
    const group = new THREE.Group();
    const fill = new THREE.Mesh(mergeGeometries(fills), this.fill);
    fill.renderOrder = 4;
    const line = new THREE.LineSegments(mergeGeometries(lines), this.line);
    line.renderOrder = 5;
    group.add(fill, line);
    for (const g of [...fills, ...lines]) g.dispose();
    return group;
  }

  dispose() {
    for (const g of this.models.values()) g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.line.dispose();
    this.fill.dispose();
  }
}

export class PrefabView {
  readonly group = new THREE.Group();
  readonly ghost = new Ghost();
  private models = new Map<KitId, InstancedModel[]>();
  private prefabs = new Map<number, Prefab>();
  private flames = new Map<number, THREE.Group>();
  private flameGeo = new THREE.OctahedronGeometry(0.22, 0);
  private flameMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private dirty = true;

  constructor() {
    this.group.add(this.ghost.group);
    this.ghost.show(null);
  }

  private modelsOf(kind: KitId) {
    let list = this.models.get(kind);
    if (!list) {
      list = [];
      for (const [tone, parts] of partsOf(kind)) {
        const m = new InstancedModel(parts, MAX_EACH, TONES[tone]);
        list.push(m);
        this.group.add(m.group);
      }
      this.models.set(kind, list);
    }
    return list;
  }

  set(p: Prefab) {
    this.prefabs.set(p.id, p);
    if (p.kind === "campfire" && !this.flames.has(p.id)) {
      const g = new THREE.Group();
      for (const a of [0, 0.8]) {
        const f = new THREE.Mesh(this.flameGeo, this.flameMat);
        f.rotation.y = a;
        g.add(f);
      }
      g.position.set(p.x, p.y + 0.42, p.z);
      this.group.add(g);
      this.flames.set(p.id, g);
    }
    this.dirty = true;
  }

  remove(id: number) {
    this.prefabs.delete(id);
    const f = this.flames.get(id);
    if (f) {
      this.group.remove(f);
      this.flames.delete(id);
    }
    this.dirty = true;
  }

  reset(list: readonly Prefab[]) {
    for (const id of [...this.prefabs.keys()]) this.remove(id);
    for (const p of list) this.set(p);
  }

  get(id: number) {
    return this.prefabs.get(id);
  }

  list() {
    return this.prefabs.values();
  }

  update(time: number) {
    for (const [id, f] of this.flames) {
      const k = 0.85 + Math.sin(time * 11 + id) * 0.1 + Math.sin(time * 23 + id * 3) * 0.06;
      f.scale.set(k, 1.6 * k + Math.sin(time * 7 + id) * 0.15, k);
      f.rotation.y = time * 0.7;
    }
    if (!this.dirty) return;
    this.dirty = false;
    /* Rebuild the instance lists only when something was built or taken down. */
    for (const kind of KIT_IDS) {
      if (kind === "rowboat" || kind === "desertbike") continue;
      let n = 0;
      for (const p of this.prefabs.values()) {
        if (p.kind !== kind) continue;
        if (!n) this.modelsOf(kind);
        for (const m of this.models.get(kind)!) {
          m.inst[n * 4] = p.x;
          m.inst[n * 4 + 1] = p.y;
          m.inst[n * 4 + 2] = p.z;
          m.inst[n * 4 + 3] = p.rot;
        }
        n++;
      }
      for (const m of this.models.get(kind) ?? []) m.commit(n);
    }
  }

  dispose() {
    for (const list of this.models.values()) for (const m of list) m.dispose();
    this.ghost.dispose();
    this.flameGeo.dispose();
    this.flameMat.dispose();
  }
}
