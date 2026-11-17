/*
 * What's switched on. Everything here still has its code; flipping a flag
 * back brings it back.
 */
export const FEATURES = {
  /* A lighthouse on every island's summit. The Harbor always has its own, at its centre. */
  lighthouse: false,
  /* Everything else built: windmill, chapel, mast, henge, villages, towers, aqueduct, wrecks. */
  landmarks: false,
  /* Trees, bushes and rocks on the islands, and the grass and flowers between them. */
  trees: true,
  rocks: true,
  ruins: false,
  cairns: false,
  buoys: false,
  /* The herds on the hunting islands. */
  animals: true,
  /* The Guild Board at the top of the Harbor lighthouse: the only source of coins. */
  board: true,
};
