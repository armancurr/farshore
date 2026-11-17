import * as THREE from "three";
import {
  CATALOGUE,
  type CatalogueId,
  type Piece,
  type PlacedItem,
  piecePalette,
  type Team,
} from "../../shared/catalogue";
import { type Look, lookOf } from "../../shared/siege";
import { type Baked, bakeModel, packMaterial, packTexture } from "./packs";

/*
 * Everything bought for the plots, drawn. Each model in each team colour is
 * one instanced mesh, however many copies of it stand on however many
 * plots, so a castle of a hundred wall segments is a handful of draw calls.
 * The lists are rebuilt only when something is set down, moved or sold, or
 * changes how it looks: scorched and a little askew below half its health,
 * and swapped for its rubble (a ruin, a pile, a bare trunk) once knocked
 * down, charred if it burnt.
 */

const tmpItem = new THREE.Matrix4();
const tmpPiece = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpTilt = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/* Where a piece of an item stands in the world; `tilt` leans the whole thing a little. */
function pieceMatrix(
  out: THREE.Matrix4,
  item: { x: number; y: number; z: number; rot: number },
  p: Piece,
  tilt = 0,
  id = 0,
) {
  tmpQ.setFromAxisAngle(UP, item.rot);
  if (tilt) {
    /* Each leans its own way, the same way every time. */
    tmpE.set(tilt * (id % 2 ? 1 : -1), 0, tilt * 0.6 * (id % 3 ? 1 : -1));
    tmpQ.multiply(tmpTilt.setFromEuler(tmpE));
  }
  tmpItem.compose(tmpP.set(item.x, item.y, item.z), tmpQ, tmpS.set(1, 1, 1));
  tmpPiece.compose(
    tmpP.set(p.x, p.y, p.z),
    tmpQ.setFromAxisAngle(UP, p.rot),
    tmpS.set(p.scale, p.scale * (p.squash ?? 1), p.scale),
  );
  return out.multiplyMatrices(tmpItem, tmpPiece);
}

/* How it's tinted: sooty brown on what's battered or burning, near black on what burnt down. */
function shadeOf(look: Look, burning: boolean, burnt: boolean): [number, number, number] {
  if (look === "rubble") return burnt ? [0.26, 0.25, 0.24] : [0.8, 0.78, 0.76];
  if (look === "damaged") return burning ? [0.36, 0.31, 0.28] : [0.5, 0.44, 0.4];
  return burning ? [0.75, 0.68, 0.62] : [1, 1, 1];
}

type Shown = { item: PlacedItem; team: Team; burning: boolean; key: string };

/*
 * The engines that visibly swing round to aim, and how far each model is
 * turned from facing +z: the gun's barrel runs along +z, the siege engines
 * shoot along their own +x.
 */
const TURNS: Partial<Record<CatalogueId, number>> = {
  cannon: 0,
  ballista: -Math.PI / 2,
  catapult: -Math.PI / 2,
  trebuchet: -Math.PI / 2,
};

/* An engine drawn on its own while it aims: its models, and the heading it's swinging to. */
type Engine = { group: THREE.Group; yaw: number; want: number; key: string };

type Batch = {
  model: string;
  palette: string;
  mesh: THREE.InstancedMesh | null;
  geo: THREE.BufferGeometry | null;
};

export class ItemsView {
  readonly group = new THREE.Group();
  private items = new Map<number, Shown>();
  private batches = new Map<string, Batch>();
  /* Picked up into the ghost: not drawn where it stood. */
  private hidden: number | null = null;
  private dirty = false;
  private disposed = false;
  private engines = new Map<number, Engine>();
  readonly ghost = new Ghost();

  constructor() {
    this.group.add(this.ghost.group);
  }

  /* Draw it as it is now: redrawn only if where it stands or how it looks has changed. */
  set(item: PlacedItem, team: Team, burning = false) {
    const look = lookOf(item.kind, item.hp);
    const key = `${item.kind}|${item.x}|${item.y}|${item.z}|${item.rot}|${team}|${look}|${burning}|${!!item.burnt}`;
    const was = this.items.get(item.id);
    this.items.set(item.id, { item, team, burning, key });
    if (was?.key !== key) this.dirty = true;
  }

  remove(id: number) {
    if (this.items.delete(id)) this.dirty = true;
  }

  clear() {
    for (const e of this.engines.values()) this.group.remove(e.group);
    this.engines.clear();
    this.items.clear();
    this.hidden = null;
    this.dirty = true;
  }

  hide(id: number | null) {
    if (this.hidden === id) return;
    this.hidden = id;
    this.dirty = true;
  }

  get(id: number) {
    return this.items.get(id)?.item;
  }

  /*
   * The defenses awake right now, from the snapshot ([id, heading,
   * elevation] each). An engine that aims is drawn on its own, turned to
   * its heading, until it settles down again.
   */
  aim(flat: readonly number[]) {
    const seen = new Set<number>();
    for (let i = 0; i + 2 < flat.length; i += 3) {
      const id = flat[i];
      const shown = this.items.get(id);
      const face = shown ? TURNS[shown.item.kind] : undefined;
      if (!shown || face === undefined || shown.item.hp <= 0 || id === this.hidden) continue;
      seen.add(id);
      let e = this.engines.get(id);
      if (e && e.key !== shown.key) {
        this.group.remove(e.group);
        this.engines.delete(id);
        e = undefined;
      }
      if (!e) {
        e = this.engine(shown);
        this.engines.set(id, e);
        this.dirty = true;
      }
      e.want = flat[i + 1] + face;
    }
    for (const [id, e] of this.engines)
      if (!seen.has(id)) {
        this.group.remove(e.group);
        this.engines.delete(id);
        this.dirty = true;
      }
  }

  private engine(shown: Shown): Engine {
    const { item, team } = shown;
    const group = new THREE.Group();
    group.position.set(item.x, item.y, item.z);
    group.rotation.y = item.rot;
    for (const p of CATALOGUE[item.kind].pieces) {
      const mesh = new THREE.Mesh(undefined, packMaterial(piecePalette(p, team)));
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rot;
      mesh.scale.setScalar(p.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false;
      group.add(mesh);
      void bakeModel(p.model).then((baked) => {
        mesh.geometry = baked.geo;
        mesh.visible = true;
      });
    }
    this.group.add(group);
    return { group, yaw: item.rot, want: item.rot, key: shown.key };
  }

  private batch(model: string, palette: string) {
    const key = `${model}|${palette}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { model, palette, mesh: null, geo: null };
      this.batches.set(key, b);
      const made = b;
      void bakeModel(model).then((baked: Baked) => {
        if (this.disposed) return;
        made.geo = baked.geo;
        this.dirty = true;
      });
    }
    return b;
  }

  update(dt = 1 / 60) {
    /* The engines swing round smoothly to where the room has them. */
    for (const e of this.engines.values()) {
      let d = e.want - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 6);
      e.group.rotation.y = e.yaw;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const lists = new Map<Batch, { m: THREE.Matrix4; shade: [number, number, number] }[]>();
    for (const b of this.batches.values()) lists.set(b, []);
    for (const { item, team, burning } of this.items.values()) {
      if (item.id === this.hidden || this.engines.has(item.id)) continue;
      const def = CATALOGUE[item.kind];
      const look = lookOf(item.kind, item.hp);
      const shade = shadeOf(look, burning, !!item.burnt);
      const tilt = look === "damaged" ? 0.035 : 0;
      for (const p of look === "rubble" ? def.rubble : def.pieces) {
        const b = this.batch(p.model, piecePalette(p, team));
        let list = lists.get(b);
        if (!list) lists.set(b, (list = []));
        list.push({ m: pieceMatrix(new THREE.Matrix4(), item, p, tilt, item.id), shade });
      }
    }
    for (const [b, list] of lists) {
      if (!b.geo) continue;
      /* Room to grow, so a few more don't mean a new buffer every time. */
      if (!b.mesh || b.mesh.instanceMatrix.count < list.length) {
        if (b.mesh) {
          this.group.remove(b.mesh);
          b.mesh.dispose();
        }
        const cap = Math.max(8, 2 ** Math.ceil(Math.log2(list.length + 1)));
        b.mesh = new THREE.InstancedMesh(b.geo, packMaterial(b.palette), cap);
        b.mesh.castShadow = true;
        b.mesh.receiveShadow = true;
        this.group.add(b.mesh);
      }
      const mesh = b.mesh;
      list.forEach((o, i) => {
        mesh.setMatrixAt(i, o.m);
        mesh.setColorAt(i, tmpC.setRGB(...o.shade));
      });
      mesh.count = list.length;
      mesh.visible = list.length > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose() {
    this.disposed = true;
    /* Geometry and materials are shared with the rest of the world; only the instance buffers are ours. */
    for (const b of this.batches.values()) b.mesh?.dispose();
    this.batches.clear();
    this.group.clear();
    this.ghost.dispose();
  }
}

/*
 * The thing you're about to set down: the same models, see-through, tinted
 * green where it can go and red where it can't.
 */
export class Ghost {
  readonly group = new THREE.Group();
  private kind: CatalogueId | null = null;
  private team: Team = "blue";
  private ok = true;
  private built = 0;
  private materials = new Map<string, THREE.MeshLambertMaterial>();

  private material(palette: string, ok: boolean) {
    const key = `${palette}|${ok}`;
    let m = this.materials.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        map: packTexture(palette),
        color: ok ? 0x9dffb6 : 0xff7a70,
        emissive: ok ? 0x0f5a2a : 0x6a1410,
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      });
      this.materials.set(key, m);
    }
    return m;
  }

  show(
    kind: CatalogueId | null,
    team: Team,
    at?: { x: number; y: number; z: number; rot: number },
    ok = true,
  ) {
    if (!kind || !at) {
      this.group.visible = false;
      return;
    }
    if (kind !== this.kind || team !== this.team) {
      this.kind = kind;
      this.team = team;
      this.build(kind, team);
    }
    if (ok !== this.ok) {
      this.ok = ok;
      const pieces = CATALOGUE[kind].pieces;
      this.group.children.forEach((c, k) => {
        (c as THREE.Mesh).material = this.material(piecePalette(pieces[k], team), ok);
      });
    }
    this.group.visible = true;
    this.group.position.set(at.x, at.y + 0.02, at.z);
    this.group.rotation.set(0, at.rot, 0);
  }

  private build(kind: CatalogueId, team: Team) {
    this.group.clear();
    const ticket = ++this.built;
    const pieces = CATALOGUE[kind].pieces;
    pieces.forEach((p) => {
      const mesh = new THREE.Mesh(undefined, this.material(piecePalette(p, team), this.ok));
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.rot;
      mesh.scale.setScalar(p.scale);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      void bakeModel(p.model).then((baked) => {
        if (ticket !== this.built) return;
        mesh.geometry = baked.geo;
        mesh.visible = true;
      });
    });
  }

  dispose() {
    this.group.clear();
    for (const m of this.materials.values()) m.dispose();
  }
}
