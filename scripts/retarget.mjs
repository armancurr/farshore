/*
 * Moves an animation from one skeleton onto another at build time, so a clip
 * made for one rig (Quaternius' mannequin, say) plays on the KayKit one.
 *
 * Each target bone takes the world-space turn its source bone makes away from
 * the source's rest pose. The rest poses differ (an A-pose against a T-pose),
 * so the target is first bent into the source's rest pose, bone by bone,
 * pointing each limb where the source's points. The hips also take the
 * source's travel, scaled by how much longer or shorter its legs are.
 */
import * as THREE from "three";

/* A skeleton read from a document: each node's rest transform, its parent, its place in the tree. */
class Skeleton {
  constructor(doc) {
    this.nodes = doc.getRoot().listNodes();
    this.parent = new Map();
    for (const n of this.nodes) for (const c of n.listChildren()) this.parent.set(c, n);
    this.byName = new Map();
    for (const n of this.nodes) if (!this.byName.has(n.getName())) this.byName.set(n.getName(), n);
    /* Parents before children. */
    this.order = [];
    const seen = new Set();
    const visit = (n) => {
      if (seen.has(n)) return;
      const p = this.parent.get(n);
      if (p) visit(p);
      seen.add(n);
      this.order.push(n);
    };
    for (const n of this.nodes) visit(n);
  }

  rest(n) {
    return {
      t: new THREE.Vector3(...n.getTranslation()),
      r: new THREE.Quaternion(...n.getRotation()),
      s: new THREE.Vector3(...n.getScale()),
    };
  }

  /* World matrices for a pose: `locals` overrides any node's rest transform. */
  pose(locals = new Map()) {
    const world = new Map();
    for (const n of this.order) {
      const l = locals.get(n) ?? this.rest(n);
      const m = new THREE.Matrix4().compose(l.t, l.r, l.s);
      const p = this.parent.get(n);
      world.set(n, p ? world.get(p).clone().multiply(m) : m);
    }
    return world;
  }

  /* Every node's local transform in `clip` at time `t` (rest where the clip doesn't move it). */
  sample(clip, t) {
    const locals = new Map();
    for (const n of this.nodes) locals.set(n, this.rest(n));
    for (const ch of clip.listChannels()) {
      const node = ch.getTargetNode();
      const path = ch.getTargetPath();
      const key =
        path === "translation" ? "t" : path === "rotation" ? "r" : path === "scale" ? "s" : null;
      if (!node || !key) continue;
      locals.get(node)[key] = sampleChannel(ch.getSampler(), t, key === "r");
    }
    return locals;
  }
}

function sampleChannel(sampler, t, quat) {
  const input = sampler.getInput().getArray();
  const output = sampler.getOutput();
  const cubic = sampler.getInterpolation() === "CUBICSPLINE";
  /* A cubic spline keeps (in-tangent, value, out-tangent) per key: take the values. */
  const at = (i) => output.getElement(cubic ? i * 3 + 1 : i, []);
  const make = (v) => (quat ? new THREE.Quaternion(...v) : new THREE.Vector3(...v));
  let i = 0;
  while (i < input.length - 1 && input[i + 1] <= t) i++;
  if (i >= input.length - 1 || sampler.getInterpolation() === "STEP") return make(at(i));
  const k = (t - input[i]) / (input[i + 1] - input[i]);
  const a = make(at(i));
  const b = make(at(i + 1));
  return quat ? a.slerp(b, k) : a.lerp(b, k);
}

const rotOf = (m) => new THREE.Quaternion().setFromRotationMatrix(m);
const posOf = (m) => new THREE.Vector3().setFromMatrixPosition(m);

/*
 * Write `clip` (an animation of `src`) into `tgt` as `name`. `map` pairs bones:
 * [target, source, target child, source child]; the children give each
 * bone's direction for lining the rest poses up. `hips` names the bone pair
 * whose travel carries over.
 */
export function retargetClip({ src, tgt, clip, name, map, hips, fps = 30 }) {
  const S = new Skeleton(src);
  const T = new Skeleton(tgt);
  const sNode = (n) => {
    const node = S.byName.get(n);
    if (!node) throw new Error(`retarget: no source bone ${n}`);
    return node;
  };
  const tNode = (n) => {
    const node = T.byName.get(n);
    if (!node) throw new Error(`retarget: no target bone ${n}`);
    return node;
  };
  const pairs = map.map(([t, s, tc, sc]) => ({
    t: tNode(t),
    s: sNode(s),
    tc: tc ? tNode(tc) : null,
    sc: sc ? sNode(sc) : null,
  }));

  /* The source's rest pose, and the target bent to match it. */
  const sRest = S.pose();
  const matched = new Map();
  for (const n of T.nodes) matched.set(n, T.rest(n));
  for (const p of pairs) {
    if (!p.tc || !p.sc) continue;
    const w = T.pose(matched);
    const dT = posOf(w.get(p.tc))
      .sub(posOf(w.get(p.t)))
      .normalize();
    const dS = posOf(sRest.get(p.sc))
      .sub(posOf(sRest.get(p.s)))
      .normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(dT, dS);
    const want = turn.multiply(rotOf(w.get(p.t)));
    const parent = T.parent.get(p.t);
    const parentRot = parent ? rotOf(w.get(parent)) : new THREE.Quaternion();
    matched.get(p.t).r = parentRot.invert().multiply(want);
  }
  const tRest = T.pose(matched);

  const hipPair = pairs.find((p) => p.t.getName() === hips);
  const sHip = posOf(sRest.get(hipPair.s));
  const tHip = posOf(tRest.get(hipPair.t));
  /* Leg length, near enough: how high the hips stand. */
  const scale = tHip.y / sHip.y;

  const duration = Math.max(
    ...clip.listChannels().map((c) => c.getSampler().getInput().getMax([])[0]),
  );
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = [];
  const rot = new Map(T.nodes.map((n) => [n, []]));
  const hipTravel = [];
  const byTarget = new Map(pairs.map((p) => [p.t, p]));

  for (let f = 0; f < frames; f++) {
    const t = (duration * f) / (frames - 1);
    times.push(t);
    const sw = S.pose(S.sample(clip, t));
    const locals = new Map();
    const worldRot = new Map();
    for (const n of T.order) {
      const rest = matched.get(n);
      const parent = T.parent.get(n);
      const parentRot = parent ? worldRot.get(parent) : new THREE.Quaternion();
      const p = byTarget.get(n);
      let local = rest.r.clone();
      if (p) {
        /* The source bone's turn from its rest, applied to the matched target bone. */
        const delta = rotOf(sw.get(p.s)).multiply(rotOf(sRest.get(p.s)).invert());
        const want = delta.multiply(rotOf(tRest.get(n)));
        local = parentRot.clone().invert().multiply(want);
      }
      /* Keep each track on one side of the quaternion double cover, so it blends cleanly. */
      const track = rot.get(n);
      const prev = track[track.length - 1];
      if (prev && prev.dot(local) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      track.push(local);
      locals.set(n, local);
      worldRot.set(n, parentRot.clone().multiply(local));
    }
    const travel = posOf(sw.get(hipPair.s)).sub(sHip).multiplyScalar(scale);
    const at = tHip.clone().add(travel);
    const parent = T.parent.get(hipPair.t);
    if (parent) at.applyMatrix4(tRest.get(parent).clone().invert());
    hipTravel.push(at);
  }

  /* Only the bones under the skeleton's root: the rest of the document stays put. */
  const root = T.byName.get("root");
  const bones = T.order.filter((n) => {
    for (let p = n; p; p = T.parent.get(p)) if (p === root) return true;
    return false;
  });

  const buffer = tgt.getRoot().listBuffers()[0];
  const input = tgt
    .createAccessor()
    .setType("SCALAR")
    .setArray(new Float32Array(times))
    .setBuffer(buffer);
  const anim = tgt.createAnimation(name);
  const channel = (node, path, type, values) => {
    const output = tgt
      .createAccessor()
      .setType(type)
      .setArray(new Float32Array(values))
      .setBuffer(buffer);
    const sampler = tgt
      .createAnimationSampler()
      .setInput(input)
      .setOutput(output)
      .setInterpolation("LINEAR");
    anim.addSampler(sampler);
    anim.addChannel(
      tgt.createAnimationChannel().setTargetNode(node).setTargetPath(path).setSampler(sampler),
    );
  };
  for (const n of bones)
    channel(
      n,
      "rotation",
      "VEC4",
      rot.get(n).flatMap((q) => q.toArray()),
    );
  channel(
    hipPair.t,
    "translation",
    "VEC3",
    hipTravel.flatMap((v) => v.toArray()),
  );
  return anim;
}

/* Quaternius' mannequin (Universal Animation Library) onto KayKit's Rig_Medium. */
export const UAL_TO_KAYKIT = [
  ["hips", "pelvis"],
  ["spine", "spine_02"],
  ["chest", "spine_03"],
  ["head", "Head"],
  ["upperarm.l", "upperarm_l", "lowerarm.l", "lowerarm_l"],
  ["lowerarm.l", "lowerarm_l", "wrist.l", "hand_l"],
  ["wrist.l", "hand_l", "hand.l", "middle_01_l"],
  ["upperarm.r", "upperarm_r", "lowerarm.r", "lowerarm_r"],
  ["lowerarm.r", "lowerarm_r", "wrist.r", "hand_r"],
  ["wrist.r", "hand_r", "hand.r", "middle_01_r"],
  ["upperleg.l", "thigh_l", "lowerleg.l", "calf_l"],
  ["lowerleg.l", "calf_l", "foot.l", "foot_l"],
  ["foot.l", "foot_l", "toes.l", "ball_l"],
  ["upperleg.r", "thigh_r", "lowerleg.r", "calf_r"],
  ["lowerleg.r", "calf_r", "foot.r", "foot_r"],
  ["foot.r", "foot_r", "toes.r", "ball_r"],
];
