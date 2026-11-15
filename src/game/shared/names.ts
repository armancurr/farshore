/*
 * Names are generated, never typed: a public site gets no free-text input to
 * moderate, and everyone still gets something evocative to be called.
 */
const FIRST = [
  "Pale",
  "Ashen",
  "Hollow",
  "Silent",
  "Grey",
  "Bone",
  "Salt",
  "Drift",
  "Lunar",
  "Brine",
  "Quiet",
  "Ink",
  "Cinder",
  "Frost",
  "Gloam",
  "Tidal",
  "Still",
  "Dusk",
  "Iron",
  "Chalk",
];
const SECOND = [
  "Heron",
  "Moth",
  "Gull",
  "Crow",
  "Wisp",
  "Tern",
  "Stag",
  "Eel",
  "Hare",
  "Owl",
  "Pike",
  "Wren",
  "Seal",
  "Lynx",
  "Shrike",
  "Newt",
  "Fox",
  "Rook",
  "Kite",
  "Vole",
];

export function randomName(rng: () => number = Math.random) {
  return `${FIRST[Math.floor(rng() * FIRST.length)]} ${SECOND[Math.floor(rng() * SECOND.length)]}`;
}
