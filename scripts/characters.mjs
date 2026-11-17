/*
 * The player characters' build steps, run from scripts/build-assets.mjs:
 * the liveries (recoloured copies of the KayKit character textures) and the
 * one animation set every player plays, gathered from KayKit's files with a
 * swim and a drive moved over from Quaternius' animation library.
 */
import { join } from "node:path";
import { mergeDocuments, unpartition } from "@gltf-transform/functions";
import sharp from "sharp";
import { retargetClip, UAL_TO_KAYKIT } from "./retarget.mjs";

/* ---------- liveries ---------- */

function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function rgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/*
 * A livery recolours a character's cloth and paint and leaves the rest.
 * The atlas is 8 swatches across and 4 down, each a gradient from light to
 * dark, and each swatch is one material on the model (the knight's steel,
 * his cape, a mage's robe), so a livery works by swatch:
 *
 *   paint: [[column, row], hue, saturation, lightness shift] repaints a
 *     swatch in one hue, keeping its gradient (steel can turn bronze);
 *   turn rotates the hue of every other coloured pixel by that many
 *     degrees, leaving skin, leather, wood and bone (warm browns, hue 8-50)
 *     and greys alone, unless `warm` is set. `sat` and `light` push the
 *     turned colours further, and `minSat` sets what counts as coloured.
 */
const LIVERIES = {
  /* The knight's steel (3,0) and cape (0,1): verdigris and coral, night and gold, a squire's brass. */
  "knight-tide": [
    "knight",
    {
      paint: [
        [[3, 0], 172, 0.26, 0.02],
        [[0, 1], 6, 0.78, 0.04],
        [[2, 2], 6, 0.78, 0.04],
      ],
    },
  ],
  "knight-dusk": [
    "knight",
    {
      paint: [
        [[3, 0], 252, 0.22, -0.1],
        [[0, 1], 42, 0.85, 0.06],
        [[2, 2], 42, 0.85, 0.06],
      ],
    },
  ],
  "knight-brass": ["knight", { paint: [[[3, 0], 38, 0.42, 0.02]] }],
  /* The barbarian's bear pelt (7,0): a white bear's, and a sea-otter's with coral warpaint. */
  "barbarian-snow": ["barbarian", { paint: [[[7, 0], 225, 0.12, 0.32]] }],
  "barbarian-coral": [
    "barbarian",
    { paint: [[[7, 0], 24, 0.28, -0.06]], turn: 160, sat: 1.4, light: 0.05 },
  ],
  /* The mage's robe (0,1) and hat (1,1): to the sea, and to embers. */
  "mage-sea": [
    "mage",
    {
      paint: [
        [[0, 1], 182, 0.5, 0],
        [[1, 1], 168, 0.55, -0.04],
      ],
    },
  ],
  "mage-ember": [
    "mage",
    {
      paint: [
        [[0, 1], 8, 0.62, 0.02],
        [[1, 1], 36, 0.8, 0],
      ],
    },
  ],
  /* The ranger's blue cloak, to coral and to night. */
  "ranger-coral": ["ranger", { turn: 163, sat: 1.05 }],
  "ranger-dusk": ["ranger", { turn: 62, light: -0.05 }],
  /* The rogue's greens, to violet, plum, coral and lagoon blue. */
  "rogue-dusk": ["rogue", { turn: 108, light: -0.06 }],
  "rogue-plum": ["rogue", { turn: 150, sat: 0.9 }],
  "rogue-coral": ["rogue", { turn: -150, sat: 1.05, light: 0.04 }],
  "rogue-lagoon": ["rogue", { turn: 35 }],
  /* Bones gone green under the sea, and bones gone pink as coral. */
  "skeleton-drowned": ["skeleton", { turn: 135, sat: 0.7, warm: true, minSat: 0.12 }],
  "skeleton-coral": ["skeleton", { turn: -28, sat: 1.6, warm: true, minSat: 0.12 }],
};

async function livery(src, out, opts) {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cw = info.width / 8;
  const ch = info.height / 4;
  const paint = new Map((opts.paint ?? []).map(([[c, r], ...p]) => [`${c},${r}`, p]));
  for (let i = 0; i < data.length; i += 3) {
    const px = i / 3;
    const cell = `${Math.floor((px % info.width) / cw)},${Math.floor(px / info.width / ch)}`;
    const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
    let c;
    const p = paint.get(cell);
    if (p) c = rgb(p[0], p[1], Math.min(1, Math.max(0, l + (p[2] ?? 0))));
    else if (opts.turn !== undefined) {
      if (s < (opts.minSat ?? 0.25)) continue;
      if (!opts.warm && h >= 8 && h <= 50) continue;
      c = rgb(
        (h + opts.turn + 360) % 360,
        Math.min(1, s * (opts.sat ?? 1)),
        Math.min(1, Math.max(0, l + (opts.light ?? 0))),
      );
    } else continue;
    data[i] = Math.round(c[0]);
    data[i + 1] = Math.round(c[1]);
    data[i + 2] = Math.round(c[2]);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/* Write every livery beside the characters' own textures in `dir`. */
export async function buildLiveries(dir) {
  for (const [name, [from, opts]] of Object.entries(LIVERIES))
    await livery(join(dir, `${from}.png`), join(dir, `${name}.png`), opts);
  return Object.keys(LIVERIES).length;
}

/* ---------- the players' animation set ---------- */

/* KayKit clips the players use, by the file they come from. */
const CLIPS = {
  General: ["Idle_A", "Idle_B", "Hit_A", "Hit_B", "Death_A", "Death_B", "Interact"],
  MovementBasic: ["Walking_A", "Running_A", "Jump_Start", "Jump_Idle", "Jump_Land"],
  MovementAdvanced: ["Walking_Backwards", "Running_Strafe_Left", "Running_Strafe_Right"],
  CombatMelee: [
    "Melee_1H_Attack_Chop",
    "Melee_1H_Attack_Slice_Diagonal",
    "Melee_1H_Attack_Slice_Horizontal",
    "Melee_1H_Attack_Stab",
    "Melee_2H_Attack_Chop",
    "Melee_2H_Attack_Slice",
    "Melee_2H_Attack_Stab",
    "Melee_2H_Idle",
    "Melee_Block_Attack",
    "Melee_Blocking",
    "Melee_Dualwield_Attack_Chop",
    "Melee_Dualwield_Attack_Slice",
    "Melee_Dualwield_Attack_Stab",
    "Melee_Unarmed_Attack_Punch_A",
    "Melee_Unarmed_Idle",
  ],
  Simulation: ["Sit_Chair_Idle", "Sit_Floor_Idle", "Waving", "Cheering"],
};

/* Quaternius clips moved onto the KayKit rig: KayKit has no swim or drive. */
const UAL_CLIPS = {
  Swim_Fwd_Loop: "Swim_Forward",
  Swim_Idle_Loop: "Swim_Idle",
  Driving_Loop: "Driving",
  Sitting_Idle_Loop: "Sitting",
};

/* A translation track that never leaves its bone's rest position. */
function still(channel) {
  const node = channel.getTargetNode();
  const out = channel.getSampler()?.getOutput();
  if (!node || !out) return true;
  const rest = node.getTranslation();
  const v = [];
  for (let i = 0; i < out.getCount(); i++) {
    out.getElement(i, v);
    if (v.some((x, k) => Math.abs(x - rest[k]) > 1e-4)) return false;
  }
  return true;
}

/*
 * One file of every clip a player plays, on the medium rig with no mesh.
 * `kaykit` is the folder of Rig_Medium_*.glb files; `ual` the library's GLB.
 */
export async function buildPlayerAnims(io, kaykit, ual) {
  const files = Object.keys(CLIPS);
  const doc = await io.read(join(kaykit, `Rig_Medium_${files[0]}.glb`));
  for (const f of files.slice(1))
    mergeDocuments(doc, await io.read(join(kaykit, `Rig_Medium_${f}.glb`)));
  const root = doc.getRoot();

  /* Every clip drives the first file's skeleton, matched by bone name; the rest goes. */
  const scene = root.listScenes()[0];
  const keep = new Set();
  scene.traverse((n) => keep.add(n));
  const bone = new Map([...keep].map((n) => [n.getName(), n]));
  const wanted = new Set(Object.values(CLIPS).flat());
  const seen = new Set();
  for (const a of root.listAnimations()) {
    if (!wanted.has(a.getName()) || seen.has(a.getName())) {
      for (const sampler of a.listSamplers()) sampler.dispose();
      a.dispose();
      continue;
    }
    seen.add(a.getName());
    for (const c of a.listChannels()) {
      const n = c.getTargetNode();
      if (n && !keep.has(n)) c.setTargetNode(bone.get(n.getName()) ?? null);
      /* Scale never changes on this rig, and below the hips the bones only turn. */
      if (c.getTargetPath() === "scale" || (c.getTargetPath() === "translation" && still(c))) {
        c.getSampler()?.dispose();
        c.dispose();
      }
    }
  }
  const missing = [...wanted].filter((n) => !seen.has(n));
  if (missing.length) throw new Error(`player anims: missing ${missing.join(", ")}`);
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  for (const n of root.listNodes()) {
    if (!keep.has(n)) n.dispose();
    else n.setMesh(null).setSkin(null);
  }
  for (const m of root.listMeshes()) {
    for (const p of m.listPrimitives()) p.dispose();
    m.dispose();
  }
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(unpartition());

  const src = await io.read(ual);
  for (const [from, name] of Object.entries(UAL_CLIPS)) {
    const clip = src
      .getRoot()
      .listAnimations()
      .find((a) => a.getName() === from);
    if (!clip) throw new Error(`player anims: no ${from} in the animation library`);
    retargetClip({ src, tgt: doc, clip, name, map: UAL_TO_KAYKIT, hips: "hips" });
  }
  return doc;
}
