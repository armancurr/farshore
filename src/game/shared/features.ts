/*
 * What's switched on. Everything here still has its code; flipping a flag
 * back brings it back. For now the island is bare: just the sea and you.
 */
export const FEATURES = {
  /* The lighthouse on the summit, with the bounty board and the keeper's stall on its plinth. */
  lighthouse: false,
  /* Everything else built: windmill, chapel, mast, henge, villages, towers, aqueduct, wrecks, jetties. */
  landmarks: false,
  /* Natural and leftover props. */
  trees: true,
  rocks: true,
  ruins: false,
  cairns: false,
  buoys: false,
  /* Deer and boar. */
  animals: false,
  /* Loose weapons on the ground, and weapons in the shop. */
  weapons: false,
  /* The bounty board (the only source of coins) and the shop (the only place to spend them). */
  bounties: false,
  shop: false,
};
