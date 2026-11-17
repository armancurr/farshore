/*
 * Builds the game's models from the raw asset packs in assets-src/ (see
 * scripts/fetch-assets.sh) into public/models/<pack>/.
 *
 *   node scripts/build-assets.mjs
 *
 * Every model is written as a compressed GLB (meshopt, quantised) with its
 * texture stripped out: each pack's models share one colour atlas, written
 * once beside them as palette.png, recoloured to the world's palette. The
 * bounds of every model go to src/game/shared/models.gen.ts so the server can
 * size collision without loading a mesh.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression } from "@gltf-transform/extensions";
import { dedup, getBounds, meshopt, prune, quantize, reorder } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "assets-src");
const OUT = join(ROOT, "public/models");

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/* ---------- colour ---------- */

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/* Ramps from shadow to highlight, all from the world's palette (src/game/client/scene/materials.ts). */
const RAMP = {
  /* Foliage: coral, from a deep rose in the shade to a pale peach where the sun hits. */
  foliage: [hex(0xa8404f), hex(0xe0606a), hex(0xff8882), hex(0xffb4a6)],
  /* Bark: the deep teal of the palette's bark, lifting toward slate. */
  bark: [hex(0x10303c), hex(0x194350), hex(0x285c6a), hex(0x3d7684)],
  /* Stone: lavender. */
  rock: [hex(0x5d5f86), hex(0x7d80a6), hex(0x9c9ebe), hex(0xc4c5dd)],
};

function ramp(stops, t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return mix(stops[i], stops[i + 1], x - i);
}

function hsl([r, g, b]) {
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

/*
 * The packs are painted in naturalistic colours. Leaves and grass go to the
 * coral foliage, wood (in the nature packs only) to the teal bark, and grey
 * stone picks up the lavender of the island's rock; everything else (cloth,
 * paint, metal) keeps its colour.
 */
function grade(rgb, opts) {
  const [h, s, l] = hsl(rgb);
  if (s > 0.22 && h >= 62 && h <= 170) return ramp(RAMP.foliage, l * 1.25 - 0.05);
  if (opts.bark && s > 0.3 && (h < 40 || h > 340) && l < 0.75)
    return ramp(RAMP.bark, l * 1.4 - 0.1);
  if (opts.stone && s < 0.16 && l > 0.18 && l < 0.92) return ramp(RAMP.rock, (l - 0.2) * 1.45);
  return rgb;
}

async function palette(src, out, opts = {}) {
  let img = sharp(src).removeAlpha();
  if (opts.resize) img = img.resize(opts.resize[0], opts.resize[1], { kernel: "nearest" });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 3) {
    const c = grade([data[i], data[i + 1], data[i + 2]], opts);
    data[i] = Math.round(c[0]);
    data[i + 1] = Math.round(c[1]);
    data[i + 2] = Math.round(c[2]);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

/* A texture copied as is (characters keep their own colours). */
async function copyTexture(src, out) {
  await sharp(src).png({ compressionLevel: 9 }).toFile(out);
}

/* ---------- models ---------- */

const bounds = {};

/*
 * Write one model. `strip` drops its textures (the pack's palette replaces
 * them); `anims` keeps only the named clips; `meshless` keeps only the
 * skeleton and its clips (an animation library).
 */
async function model(src, pack, id, opts = {}) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  if (opts.anims) {
    for (const a of root.listAnimations()) if (!opts.anims.includes(a.getName())) a.dispose();
  }
  if (opts.meshless) {
    for (const n of root.listNodes()) if (n.getMesh()) n.setMesh(null).setSkin(null);
    for (const m of root.listMeshes()) m.dispose();
    for (const s of root.listSkins()) s.dispose();
  }
  if (opts.strip !== false) {
    for (const t of root.listTextures()) t.dispose();
  }
  /* Their names are what the game looks pieces up by; one material per pack is plenty. */
  for (const m of root.listMaterials()) m.setName(opts.material ?? pack);
  await doc.transform(
    dedup(),
    prune({ keepLeaves: true, keepAttributes: true }),
    reorder({ encoder: MeshoptEncoder }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({
    method: EXTMeshoptCompression.EncoderMethod.QUANTIZE,
  });
  const scene = root.listScenes()[0];
  if (!opts.meshless && scene) {
    const b = getBounds(scene);
    const r = (v) => Math.round(v * 1000) / 1000;
    bounds[`${pack}/${id}`] = { min: b.min.map(r), max: b.max.map(r) };
  }
  mkdirSync(join(OUT, pack), { recursive: true });
  await io.write(join(OUT, pack, `${id}.glb`), doc);
}

const kebab = (s) =>
  s
    .replace(/_Color1$/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();

const gltfs = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".gltf") || f.endsWith(".glb"))
    .sort();

async function each(dir, pack, pick, opts) {
  const files = gltfs(dir).filter((f) => pick(f.replace(/\.(gltf|glb)$/, "")));
  for (const f of files)
    await model(join(dir, f), pack, kebab(f.replace(/\.(gltf|glb)$/, "")), opts);
  return files.length;
}

const KAY = (pack) => {
  const top = join(SRC, pack);
  return join(
    top,
    readdirSync(top).find((d) => d.startsWith("KayKit")),
  );
};
const KENNEY = (pack) => join(SRC, pack, "Models", "GLB format");

const counts = {};
const fresh = (pack) => {
  rmSync(join(OUT, pack), { recursive: true, force: true });
  mkdirSync(join(OUT, pack), { recursive: true });
};

/* Nature: the KayKit forest. */
{
  const dir = KAY("kaykit-forest");
  fresh("forest");
  counts.forest = await each(
    join(dir, "Assets/gltf"),
    "forest",
    (n) => n.endsWith("_Color1") && !n.includes("Singlesided"),
  );
  await palette(join(dir, "Textures/forest_texture.png"), join(OUT, "forest/palette.png"), {
    resize: [32, 256],
    bark: true,
    stone: true,
  });
}

/* Characters: the KayKit adventurers and skeletons, all on the medium rig. */
{
  fresh("characters");
  const adv = KAY("kaykit-adventurers");
  const skel = KAY("kaykit-skeletons");
  let n = 0;
  for (const f of gltfs(join(adv, "Characters/gltf"))) {
    await model(join(adv, "Characters/gltf", f), "characters", kebab(f.replace(".glb", "")), {
      material: "character",
    });
    n++;
  }
  for (const f of gltfs(join(skel, "characters/gltf"))) {
    await model(join(skel, "characters/gltf", f), "characters", kebab(f.replace(".glb", "")), {
      material: "character",
    });
    n++;
  }
  counts.characters = n;
  for (const t of ["barbarian", "knight", "mage", "ranger", "rogue"])
    await copyTexture(
      join(adv, "Characters/gltf", `${t}_texture.png`),
      join(OUT, "characters", `${t}.png`),
    );
  await copyTexture(
    join(skel, "characters/gltf/skeleton_texture.png"),
    join(OUT, "characters/skeleton.png"),
  );

  /* The shared animation set: every clip on the medium rig, meshes dropped. */
  const anim = join(
    SRC,
    "kaykit-character-animations",
    readdirSync(join(SRC, "kaykit-character-animations"))[0],
    "Animations/gltf/Rig_Medium",
  );
  fresh("anims");
  for (const f of gltfs(anim))
    await model(join(anim, f), "anims", kebab(f.replace(".glb", "").replace("Rig_Medium_", "")), {
      meshless: true,
    });
  counts.anims = gltfs(anim).length;
}

/* Weapons and tools: KayKit weapon bits, the adventurers' and skeletons' arms, and the tool bits. */
{
  fresh("weapons");
  const fw = KAY("fantasy-weapons-bits");
  counts.weapons = await each(join(fw, "Assets/gltf"), "weapons", () => true, {
    material: "weapons",
  });
  await copyTexture(
    join(fw, "Textures/weapons_bits_texture.png"),
    join(OUT, "weapons/palette.png"),
  );

  fresh("gear");
  const adv = KAY("kaykit-adventurers");
  counts.gear = await each(join(adv, "Assets/gltf"), "gear", () => true, { material: "gear" });
  for (const t of ["barbarian", "knight", "mage", "ranger", "rogue"])
    await copyTexture(join(adv, "Assets/gltf", `${t}_texture.png`), join(OUT, "gear", `${t}.png`));

  fresh("tools");
  const tb = KAY("rpg-tools-bits");
  const TOOLS = [
    "axe",
    "pickaxe",
    "hammer",
    "mallet",
    "knife",
    "shovel",
    "saw",
    "torch",
    "lantern",
    "rope_bundle_A",
    "bucket_metal",
    "anvil",
    "grindstone",
    "map_rolled",
    "compass_base",
  ];
  counts.tools = await each(join(tb, "Assets/gltf"), "tools", (n) => TOOLS.includes(n), {
    material: "tools",
  });
  await copyTexture(join(tb, "Textures/tools_bits_texture.png"), join(OUT, "tools/palette.png"));
}

/* Vehicles: Kenney watercraft, pirate ships and the car kit's working machines. */
{
  fresh("boats");
  const BOATS = [
    "boat-row-small",
    "boat-row-large",
    "boat-sail-a",
    "boat-sail-b",
    "boat-fishing-small",
    "boat-fan",
    "boat-speed-a",
    "boat-speed-b",
    "boat-speed-c",
    "boat-speed-d",
    "boat-speed-e",
    "boat-speed-f",
    "boat-speed-g",
    "boat-speed-h",
    "boat-speed-i",
    "boat-speed-j",
    "boat-tug-a",
    "boat-tug-b",
    "boat-tug-c",
    "boat-tow-a",
    "boat-tow-b",
    "boat-house-a",
    "boat-house-b",
    "boat-house-c",
    "boat-house-d",
    "ship-small",
    "ship-large",
    "ship-small-ghost",
    "buoy",
    "buoy-flag",
  ];
  counts.boats = await each(KENNEY("k-watercraft-kit"), "boats", (n) => BOATS.includes(n), {
    material: "boats",
  });
  await palette(
    join(KENNEY("k-watercraft-kit"), "Textures/colormap.png"),
    join(OUT, "boats/palette.png"),
    {},
  );

  fresh("ships");
  const SHIPS = [
    "ship-pirate-small",
    "ship-pirate-medium",
    "ship-pirate-large",
    "ship-small",
    "ship-medium",
    "ship-large",
    "ship-ghost",
    "ship-wreck",
    "boat-row-small",
    "boat-row-large",
    "tool-paddle",
  ];
  counts.ships = await each(KENNEY("k-pirate-kit"), "ships", (n) => SHIPS.includes(n), {
    material: "ships",
  });
  await palette(
    join(KENNEY("k-pirate-kit"), "Textures/colormap.png"),
    join(OUT, "ships/palette.png"),
    {},
  );

  fresh("cars");
  const CARS = [
    "tractor",
    "tractor-shovel",
    "truck",
    "truck-flat",
    "suv",
    "suv-luxury",
    "van",
    "sedan",
    "sedan-sports",
    "hatchback-sports",
    "race",
    "race-future",
    "delivery",
    "delivery-flat",
  ];
  counts.cars = await each(KENNEY("k-car-kit"), "cars", (n) => CARS.includes(n), {
    material: "cars",
  });
  await palette(
    join(KENNEY("k-car-kit"), "Textures/colormap.png"),
    join(OUT, "cars/palette.png"),
    {},
  );
}

/* Props for the places on the islands: camps, docks, villages, wrecks. */
{
  fresh("camp");
  counts.camp = await each(
    KENNEY("k-survival-kit"),
    "camp",
    (n) => !n.startsWith("metal") && !n.includes("structure-metal"),
    { material: "camp" },
  );
  await palette(
    join(KENNEY("k-survival-kit"), "Textures/colormap.png"),
    join(OUT, "camp/palette.png"),
    { stone: true },
  );

  fresh("coast");
  const COAST = [
    "barrel",
    "bottle",
    "bottle-large",
    "cannon",
    "cannon-ball",
    "cannon-mobile",
    "chest",
    "crate",
    "crate-bottles",
    "flag",
    "flag-high",
    "flag-pennant",
    "flag-high-pennant",
    "mast",
    "mast-ropes",
    "palm-bend",
    "palm-straight",
    "palm-detailed-bend",
    "palm-detailed-straight",
    "platform",
    "platform-planks",
    "rocks-a",
    "rocks-b",
    "rocks-c",
    "rocks-sand-a",
    "rocks-sand-b",
    "rocks-sand-c",
    "structure",
    "structure-fence",
    "structure-fence-sides",
    "structure-platform",
    "structure-platform-small",
    "structure-platform-dock",
    "structure-platform-dock-small",
    "structure-roof",
    "tower-base",
    "tower-base-door",
    "tower-middle",
    "tower-middle-windows",
    "tower-roof",
    "tower-top",
    "tower-watch",
    "tower-complete-small",
    "tower-complete-large",
    "patch-sand",
    "patch-sand-foliage",
    "patch-grass",
    "patch-grass-foliage",
    "grass",
    "grass-plant",
    "grass-patch",
    "tool-shovel",
    "hole",
    "castle-wall",
    "castle-gate",
    "castle-door",
    "castle-window",
  ];
  counts.coast = await each(KENNEY("k-pirate-kit"), "coast", (n) => COAST.includes(n), {
    material: "coast",
  });
  await palette(
    join(KENNEY("k-pirate-kit"), "Textures/colormap.png"),
    join(OUT, "coast/palette.png"),
    { stone: true },
  );

  fresh("town");
  counts.town = await each(
    KENNEY("k-fantasy-town-kit"),
    "town",
    (n) => !n.startsWith("road") && !n.startsWith("roof-high-") && !n.startsWith("fountain-corner"),
    { material: "town" },
  );
  await palette(
    join(KENNEY("k-fantasy-town-kit"), "Textures/colormap.png"),
    join(OUT, "town/palette.png"),
    { stone: true },
  );
}

/* ---------- manifest ---------- */

const keys = Object.keys(bounds).sort();
const lines = keys.map(
  (k) => `  "${k}": { min: [${bounds[k].min.join(", ")}], max: [${bounds[k].max.join(", ")}] },`,
);
writeFileSync(
  join(ROOT, "src/game/shared/models.gen.ts"),
  `/* Generated by scripts/build-assets.mjs: the bounds of every model in public/models, in its own units. Do not edit. */

export type ModelBounds = { min: readonly [number, number, number]; max: readonly [number, number, number] };

export const MODEL_BOUNDS = {
${lines.join("\n")}
} as const satisfies Record<string, ModelBounds>;

export type ModelId = keyof typeof MODEL_BOUNDS;
`,
);

/* The packs' licences travel with them. */
writeFileSync(
  join(OUT, "LICENSES.txt"),
  `Models in this folder come from these packs, all released under CC0 1.0 (public domain):

  forest, characters, anims, weapons, gear, tools
    KayKit by Kay Lousberg (kaylousberg.itch.io): Forest Nature Pack, Adventurers,
    Skeletons, Character Animations, Fantasy Weapons Bits, RPG Tools Bits.
  boats, ships, cars, camp, coast, town
    Kenney (kenney.nl): Watercraft Kit, Pirate Kit, Car Kit, Survival Kit, Fantasy Town Kit.
  animals
    Quaternius (quaternius.com) and Gobkit; see animals/LICENSE-*.txt.

Textures have been recoloured to the game's palette. https://creativecommons.org/publicdomain/zero/1.0/
`,
);

console.log(counts, `${keys.length} models with bounds`);
void basename;
