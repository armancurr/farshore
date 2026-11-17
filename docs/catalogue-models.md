# Catalogue models

The finished models the marketplace can sell, built by `scripts/build-assets.mjs` from the
packs `scripts/fetch-assets.sh` downloads (`bun run assets:fetch`, then `bun run assets:build`).
Every pack here is CC0; the licences are listed in `public/models/LICENSES.txt`.

- `public/models/buildings/`: 47 models from the **KayKit Medieval Hexagon Pack** (Kay Lousberg).
- `public/models/castle/`: 67 models from the **Kenney Castle Kit**.
- `public/fx/`: 35 effect sprites from the **Kenney Particle Pack** and **Kenney Smoke Particles**.

Model ids are `<folder>/<name>`, as in `MODEL_BOUNDS` (`src/game/shared/models.gen.ts`); the
file is `public/models/<id>.glb`.

## Sizes and scale

Dimensions below are the bounds as exported, in the pack's own units, which the game reads as
metres. Both packs are miniatures and need scaling up when placed (the player is 1.8 m):

- **KayKit hexagon buildings** are made to stand on its hex tiles, which are **2 units across
  the flats and 2.31 corner to corner**. The props are larger than the buildings would suggest
  (a barrel is 0.21 tall), so a single factor of about **×5** reads well: the cottage becomes
  4.7 m tall, the castle 20 m, a hex tile 10 m across, a barrel 1 m.
- **Kenney castle kit** pieces sit on a 1-unit grid; walls are 1.31 tall, the door 0.6.
  About **×4** makes the door 2.4 m and the walls 5.2 m.

Almost every model has its origin at the centre of its footprint at ground level (y = 0). The
exceptions, which matter when placing them:

- `buildings/fence-*` are drawn on a hex tile's edge: their centre is at x = -1, not 0.
- `buildings/wall-corner-*` are offset toward one corner of their hex (centre around x -0.1 to
  -0.5, z -0.3).
- `buildings/watermill` reaches 0.35 below ground (its wheel dips into a river tile), and
  `buildings/bridge-a`/`-b` reach 1 below (their piers stand in the river bed).
- `castle/wall-doorway`, `castle/wall-narrow`, `castle/wall-half-modular`,
  `castle/wall-narrow-gate`, `castle/wall-corner-half-tower` and `castle/bridge-draw` are
  off-centre within their 1-unit cell, so they line up with the other wall pieces.

## Team colours

**KayKit:** the four colour sets (blue, red, green, yellow) are **the same meshes**: identical
positions, and the same atlas (`hexagons_medieval.png`). Only the UVs of the team-coloured faces
differ: they sample a swatch in the atlas's bottom row, and each team's set shifts them by a
fixed step along u (blue +0, red +0.125, yellow +0.25, green +0.375). The one exception is the
market, whose awning stripes swap places between sets; the colours are still team and white.
There is no neutral set of these buildings; `buildings/neutral` in the pack holds only the
walls, fences, bridges, plots and construction stages, which carry no team colour.

So only the **blue** meshes are exported, and the team comes from the palette. The swatch is
copied in from the other team's place in the atlas:

- `buildings/palette.png` (blue, the default), `palette-red.png`, `palette-yellow.png`,
  `palette-green.png`.

The team colour covers roofs, banners and trim. The team swatch is left ungraded, so a green team
stays green rather than turning coral like the foliage. `buildings/flag` and
`buildings/bucket-arrows` also use the team swatch.

**Kenney castle kit:** same idea. The kit ships whole alternative atlases. `variation-a/b/c`
differ from the default `colormap.png` only in its blue trim swatch, which becomes red, green or
yellow. So the castle has `castle/palette.png` (blue), `palette-red.png`, `palette-yellow.png`
and `palette-green.png`, used by the flags, roofs and `-color` pieces. The kit's stone is a warm
sandstone; it keeps that colour, since the world's stone grading only touches grey.

## Moving parts

Several models keep separate nodes that can be animated or knocked off:

- `buildings/windmill` (`building_windmill_top_fan_blue`), `buildings/watermill` (`…_wheel_blue`),
  `buildings/lumbermill` (`…_saw_blue`, `…_top_blue`), `buildings/tower-catapult`
  (`catapult_arm_blue`, `catapult_turret_blue`).
- Gates: `buildings/wall-straight-gate` and `buildings/wall-corner-a-gate` (`…_door_left`,
  `…_door_right`), `buildings/fence-*-gate` (`…_door`).
- Siege engines: `castle/siege-ballista` (`arrow`, `wheel`), `castle/siege-catapult`
  (`catapult`, `wheel`), `castle/siege-trebuchet` (`arm`, `weight`, `wheel`), `castle/siege-ram`
  (`ram`, `wheel`), `castle/siege-tower` (`wheel`).

## States for raids

The packs come with some damage and build states that can stand in while something burns or
is rebuilt:

- `buildings/destroyed` is a generic ruin. `buildings/stage-a`, `stage-b` and `stage-c` show a
  building going up (or coming down). `buildings/scaffolding` is a building yard.
- Every Kenney siege engine has a `-demolished` wreck.

## KayKit Medieval Hexagon: `public/models/buildings/`

| id | what | footprint x × z (m) | height (m) | shelf | material |
|---|---|---|---|---|---|
| `buildings/castle` | Castle: tall keep with turrets and team banners | 1.98 × 2.26 | 3.98 | Core/Hearth candidate | stone (doesn't burn) |
| `buildings/church` | Church: timber hall with steeple | 1.03 × 1.16 | 1.65 | Core/Hearth candidate | timber on stone (burns) |
| `buildings/home-a` | Cottage with chimney | 0.79 × 0.85 | 0.93 | Homes | timber on stone (burns) |
| `buildings/home-b` | Two-storey house with chimney | 0.88 × 1.10 | 1.28 | Homes | timber on stone (burns) |
| `buildings/tent` | Open canopy on four posts (a tent/awning, prop-sized) | 0.52 × 0.52 | 0.52 | Homes | wood (burns) |
| `buildings/blacksmith` | Blacksmith: timber shop, stone forge, anvil | 1.29 × 1.25 | 0.98 | Village | timber on stone (burns) |
| `buildings/destroyed` | Ruin / rubble of a building (burnt or smashed state) | 1.54 × 1.30 | 0.99 | Village | stone (doesn't burn) |
| `buildings/dirt` | Bare dirt plot, hex-shaped, flat (a whole tile) | 1.79 × 2.01 | 0.09 | Village | none (ground) |
| `buildings/flag` | Team flag on a pole (team swatch) | 0.06 × 0.26 | 0.28 | Village | wood (burns) |
| `buildings/grain` | Wheat field, hex-shaped (a whole tile) | 1.87 × 2.09 | 0.39 | Village | wood (burns) |
| `buildings/lumbermill` | Lumber mill: timber tower with crane; `saw` and `top` nodes | 1.37 × 1.19 | 1.71 | Village | wood (burns) |
| `buildings/market` | Market: stalls and a small house | 1.80 × 1.32 | 0.98 | Village | wood (burns) |
| `buildings/mine` | Mine entrance in a rock mound | 1.61 × 1.92 | 1.14 | Village | stone (doesn't burn) |
| `buildings/resource-lumber` | Lumber pile (prop) | 0.69 × 0.33 | 0.21 | Village | wood (burns) |
| `buildings/resource-stone` | Stone blocks pile (prop) | 0.42 × 0.36 | 0.28 | Village | stone (doesn't burn) |
| `buildings/scaffolding` | Building yard with scaffolding | 1.90 × 2.11 | 1.30 | Village | wood (burns) |
| `buildings/stage-a` | Construction stage A: foundations | 1.05 × 0.88 | 0.29 | Village | timber on stone (burns) |
| `buildings/stage-b` | Construction stage B: half-built | 1.02 × 1.13 | 0.64 | Village | timber on stone (burns) |
| `buildings/stage-c` | Construction stage C: walls up | 1.16 × 1.13 | 0.99 | Village | timber on stone (burns) |
| `buildings/tavern` | Tavern with a giant-barrel front | 1.17 × 1.33 | 1.40 | Village | timber on stone (burns) |
| `buildings/watermill` | Watermill; `wheel` node can spin, wheel dips 0.35 below ground | 1.05 × 1.24 | 1.57 | Village | timber on stone (burns) |
| `buildings/well` | Well: stone ring, timber roof | 0.65 × 0.75 | 0.83 | Village | stone (doesn't burn) |
| `buildings/wheelbarrow` | Wheelbarrow (prop) | 0.24 × 0.51 | 0.19 | Village | wood (burns) |
| `buildings/windmill` | Windmill: stone tower, timber gallery; `top_fan` node can spin | 1.13 × 0.82 | 1.46 | Village | timber on stone (burns) |
| `buildings/fence-stone-straight` | Low stone fence, one hex edge; at x = -1 | 0.20 × 1.15 | 0.27 | Walls | stone (doesn't burn) |
| `buildings/fence-stone-straight-gate` | Low stone fence with wooden gate; at x = -1 | 0.20 × 1.15 | 0.30 | Walls | stone (doesn't burn) |
| `buildings/fence-wood-straight` | Wooden palisade, one hex edge; sits at x = -1 (hex edge) | 0.10 × 1.15 | 0.55 | Walls | wood (burns) |
| `buildings/fence-wood-straight-gate` | Wooden palisade with gate; `door` node; at x = -1 | 0.14 × 1.15 | 0.65 | Walls | wood (burns) |
| `buildings/wall-corner-a-gate` | Wall corner A with gate; door nodes | 1.76 × 1.53 | 1.42 | Walls | stone (doesn't burn) |
| `buildings/wall-corner-a-inside` | Wall corner A (inner); placed off-centre on its hex | 1.85 × 1.42 | 1.10 | Walls | stone (doesn't burn) |
| `buildings/wall-corner-a-outside` | Wall corner A (outer); placed off-centre on its hex | 1.76 × 1.43 | 1.10 | Walls | stone (doesn't burn) |
| `buildings/wall-corner-b-inside` | Wall corner B (inner); off-centre | 0.96 × 1.47 | 1.10 | Walls | stone (doesn't burn) |
| `buildings/wall-corner-b-outside` | Wall corner B (outer); off-centre | 0.96 × 1.35 | 1.10 | Walls | stone (doesn't burn) |
| `buildings/wall-straight` | Stone wall with timber walkway, one hex across (2 units) | 2.00 × 0.80 | 1.10 | Walls | stone (doesn't burn) |
| `buildings/wall-straight-gate` | Stone wall with gate; `door_left`/`door_right` nodes | 2.00 × 0.90 | 1.41 | Walls | stone (doesn't burn) |
| `buildings/tower-a` | Round stone tower, conical roof | 0.99 × 1.15 | 2.19 | Towers | stone (doesn't burn) |
| `buildings/tower-b` | Taller round tower with timber gallery and roof | 1.20 × 1.38 | 2.48 | Towers | stone (doesn't burn) |
| `buildings/tower-base` | Round stone tower, open crenellated top | 0.93 × 1.11 | 1.50 | Towers | stone (doesn't burn) |
| `buildings/bridge-a` | Stone arch bridge (piers reach 1 below ground, for river tiles) | 1.33 × 1.92 | 1.25 | Harbour | stone (doesn't burn) |
| `buildings/bridge-b` | Stone bridge, variant (piers reach 1 below ground) | 1.33 × 1.92 | 1.25 | Harbour | stone (doesn't burn) |
| `buildings/archeryrange` | Archery range: round tower, timber hall, targets | 1.67 × 1.55 | 1.79 | Defenses | timber on stone (burns) |
| `buildings/barracks` | Barracks: fortified stone hall, several roofs | 1.44 × 1.57 | 1.64 | Defenses | stone (doesn't burn) |
| `buildings/bucket-arrows` | Bucket of arrows (prop) | 0.14 × 0.14 | 0.23 | Defenses | wood (burns) |
| `buildings/projectile-catapult` | Catapult stone (projectile) | 0.24 × 0.25 | 0.28 | Defenses | stone (doesn't burn) |
| `buildings/target` | Archery target (prop) | 0.24 × 0.14 | 0.30 | Defenses | wood (burns) |
| `buildings/tower-catapult` | Stone tower with catapult on top; `catapult_arm`, `catapult_turret` nodes | 0.93 × 1.30 | 1.96 | Defenses | stone (doesn't burn) |
| `buildings/weaponrack` | Weapon rack (prop) | 0.20 × 0.13 | 0.24 | Defenses | wood (burns) |

## Kenney Castle Kit: `public/models/castle/`

The kit is modular: whole towers are stacked from `tower-square-*` or `tower-hexagon-*` pieces
(base, mid and top/roof, each sized to sit on the last). `castle/tower-square` and
`castle/tower-slant-roof` are complete on their own. A catalogue tower can be a fixed stack
assembled in code, so the player still buys it whole.

| id | what | footprint x × z (m) | height (m) | shelf | material |
|---|---|---|---|---|---|
| `castle/door` | Wooden door in stone frame | 0.15 × 0.36 | 0.60 | Walls | wood (burns) |
| `castle/flag` | Flag on pole (team colour) | 0.11 × 0.43 | 0.87 | Walls | wood (burns) |
| `castle/flag-banner-long` | Long hanging wall banner | 0.04 × 0.63 | 2.17 | Walls | wood (burns) |
| `castle/flag-banner-short` | Short hanging wall banner | 0.04 × 0.63 | 0.78 | Walls | wood (burns) |
| `castle/flag-pennant` | Pennant on pole | 0.11 × 0.57 | 0.87 | Walls | wood (burns) |
| `castle/flag-wide` | Wide banner on two poles | 0.11 × 0.55 | 0.87 | Walls | wood (burns) |
| `castle/gate` | Wooden gate (doors for a doorway/arch) | 0.15 × 0.66 | 0.91 | Walls | wood (burns) |
| `castle/metal-gate` | Iron portcullis | 0.07 × 0.70 | 0.73 | Walls | metal (doesn't burn) |
| `castle/stairs-stone` | Stone stairs | 0.23 × 0.82 | 0.68 | Walls | stone (doesn't burn) |
| `castle/stairs-stone-square` | Stone stairs, square | 0.23 × 0.82 | 0.68 | Walls | stone (doesn't burn) |
| `castle/wall` | Wall segment, crenellated | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-corner` | Wall corner | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-corner-half` | Wall corner, half depth | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-corner-half-tower` | Wall corner with a small round turret | 1.50 × 1.50 | 1.44 | Walls | stone (doesn't burn) |
| `castle/wall-corner-slant` | Wall corner, slanted | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-doorway` | Wall with an arched doorway | 0.50 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-half` | Wall, half depth | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-half-modular` | Wall half piece, modular | 0.60 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-narrow` | Narrow wall | 0.50 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-narrow-corner` | Narrow wall corner | 0.50 × 0.50 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-narrow-gate` | Narrow wall with gate arch | 0.63 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-narrow-stairs` | Narrow wall with stairs up | 0.97 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-narrow-stairs-rail` | Narrow wall with stairs and rail | 0.99 × 1.03 | 1.45 | Walls | stone (doesn't burn) |
| `castle/wall-narrow-wood` | Narrow wall topped with wooden walkway | 1.00 × 1.00 | 1.31 | Walls | timber on stone (burns) |
| `castle/wall-narrow-wood-fence` | Narrow wall with wooden walkway and fence | 1.05 × 1.00 | 1.45 | Walls | timber on stone (burns) |
| `castle/wall-pillar` | Wall with pillar | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/wall-to-narrow` | Wall stepping down to narrow wall | 1.00 × 1.00 | 1.31 | Walls | stone (doesn't burn) |
| `castle/tower-base` | Round tower base | 1.00 × 1.00 | 1.31 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-base` | Hexagonal tower: base | 0.90 × 0.78 | 1.31 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-mid` | Hexagonal tower: middle with windows | 0.95 × 0.82 | 0.46 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-roof` | Hexagonal tower: conical roof (team colour) | 0.98 × 0.85 | 0.83 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-roof-secondary` | Hexagonal tower: conical roof, smaller | 0.98 × 0.85 | 0.75 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-top` | Hexagonal tower: crenellated ring | 0.86 × 0.75 | 0.13 | Towers | stone (doesn't burn) |
| `castle/tower-hexagon-top-wood` | Hexagonal tower: wooden hoarding top | 0.86 × 0.75 | 0.46 | Towers | wood (burns) |
| `castle/tower-slant-roof` | Square tower with slanted roof, complete | 1.17 × 1.14 | 2.14 | Towers | stone (doesn't burn) |
| `castle/tower-square` | Square tower, complete short | 1.00 × 1.00 | 1.31 | Towers | stone (doesn't burn) |
| `castle/tower-square-arch` | Square tower: arched gate piece | 0.93 × 0.93 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-base` | Square tower: base piece | 1.00 × 1.00 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-base-border` | Square tower: plinth | 1.00 × 1.00 | 0.45 | Towers | stone (doesn't burn) |
| `castle/tower-square-base-color` | Square tower: base with team trim | 1.00 × 1.00 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-mid` | Square tower: middle piece | 0.93 × 0.93 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-mid-color` | Square tower: team-colour band | 0.93 × 0.93 | 0.20 | Towers | stone (doesn't burn) |
| `castle/tower-square-mid-door` | Square tower: middle with door | 0.93 × 0.93 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-mid-open` | Square tower: open timber frame | 0.93 × 0.93 | 1.01 | Towers | wood (burns) |
| `castle/tower-square-mid-open-simple` | Square tower: open timber frame, simple | 0.93 × 0.93 | 0.88 | Towers | wood (burns) |
| `castle/tower-square-mid-windows` | Square tower: middle with windows | 0.93 × 0.93 | 1.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-roof` | Square tower: tall spire roof | 1.00 × 1.00 | 2.01 | Towers | stone (doesn't burn) |
| `castle/tower-square-top` | Square tower: crenellated top | 1.00 × 1.00 | 0.30 | Towers | stone (doesn't burn) |
| `castle/tower-square-top-color` | Square tower: top with team trim | 1.00 × 1.00 | 0.38 | Towers | stone (doesn't burn) |
| `castle/tower-square-top-roof` | Square tower: top with pyramid roof (team colour) | 1.00 × 1.00 | 1.00 | Towers | stone (doesn't burn) |
| `castle/tower-square-top-roof-high` | Square tower: top with tall roof | 1.00 × 1.00 | 1.35 | Towers | stone (doesn't burn) |
| `castle/tower-square-top-roof-high-windows` | Square tower: tall roof with dormer | 1.00 × 1.00 | 1.08 | Towers | stone (doesn't burn) |
| `castle/tower-square-top-roof-rounded` | Square tower: top with rounded roof | 1.00 × 1.00 | 0.95 | Towers | stone (doesn't burn) |
| `castle/tower-top` | Round tower crenellated top | 1.00 × 1.00 | 0.13 | Towers | stone (doesn't burn) |
| `castle/bridge-draw` | Drawbridge deck (hinged at x = -1... 0) | 1.00 × 0.83 | 0.10 | Harbour | wood (burns) |
| `castle/bridge-straight` | Stone bridge section with arch | 0.93 × 0.93 | 1.18 | Harbour | stone (doesn't burn) |
| `castle/bridge-straight-pillar` | Stone bridge section on pillar | 0.93 × 0.93 | 1.18 | Harbour | stone (doesn't burn) |
| `castle/siege-ballista` | Ballista; `arrow`, `wheel` nodes | 1.63 × 1.20 | 0.91 | Defenses | wood (burns) |
| `castle/siege-ballista-demolished` | Ballista, wrecked (destroyed state) | 1.75 × 1.55 | 0.51 | Defenses | wood (burns) |
| `castle/siege-catapult` | Catapult; `catapult` arm, `wheel` nodes | 1.73 × 1.21 | 1.33 | Defenses | wood (burns) |
| `castle/siege-catapult-demolished` | Catapult, wrecked | 1.68 × 1.67 | 0.32 | Defenses | wood (burns) |
| `castle/siege-ram` | Battering ram with roof; `ram`, `wheel` nodes | 2.09 × 1.00 | 1.18 | Defenses | wood (burns) |
| `castle/siege-ram-demolished` | Battering ram, wrecked | 2.08 × 1.65 | 0.72 | Defenses | wood (burns) |
| `castle/siege-tower` | Siege tower on wheels | 1.97 × 1.21 | 2.68 | Defenses | wood (burns) |
| `castle/siege-tower-demolished` | Siege tower, wrecked | 2.17 × 1.85 | 2.10 | Defenses | wood (burns) |
| `castle/siege-trebuchet` | Trebuchet; `arm`, `weight`, `wheel` nodes | 1.85 × 1.26 | 1.96 | Defenses | wood (burns) |
| `castle/siege-trebuchet-demolished` | Trebuchet, wrecked | 1.94 × 2.10 | 0.31 | Defenses | wood (burns) |

## Harbour gap

Neither pack has docks, piers or a shipyard; the only harbour-shelf models here are bridges.
The existing pirate-kit pieces fill that shelf: `coast/structure-platform-dock`,
`coast/structure-platform-dock-small`, `coast/platform`, `coast/platform-planks`, `coast/structure`,
`coast/tower-watch` and `coast/cannon`/`coast/cannon-mobile` (a Defenses cannon).

## Not exported

- KayKit: every hex ground, road, river and coast tile, the nature pieces (hills, mountains,
  trees, rocks, clouds, water plants), the red, green and yellow mesh duplicates, and the
  smaller props (barrels, crates, sacks, buckets, ladder, pallet).
- Kenney castle kit: `ground`, `ground-hills`, `rocks-*`, `tree-*`, `wall-stud`.

## Effect sprites: `public/fx/`

128 × 128 PNGs, transparent. The particle-pack sprites are white, for tinting in the shader
(fire orange, embers red, smoke grey). The smoke-pack sprites keep their own colours. 35 files,
about 260 KB.

| file | source | use |
|---|---|---|
| `fire-01`, `fire-02` | Particle Pack `fire_01/02` | Fire body, blotchy flame mass |
| `flame-05`, `flame-06` | Particle Pack `flame_05/06` | Single flame tongues (torches, roof fires) |
| `flame-01` | Particle Pack `flame_01` | Wispy flame/heat curl |
| `muzzle-01`, `muzzle-02`, `muzzle-05` | Particle Pack `muzzle_*` | Flame bursts: cannon and ballista muzzle flash, flare-ups |
| `scorch-01`, `scorch-02` | Particle Pack `scorch_*` | Starburst blast cores / scorch marks |
| `smoke-02`, `smoke-04`, `smoke-05`, `smoke-07` | Particle Pack `smoke_*` | Soft smoke puffs (tint grey or black) |
| `smoke-08` | Particle Pack `smoke_08` | Smoke ring: shockwave puff |
| `dirt-01`, `dirt-03` | Particle Pack `dirt_*` | Debris and dust bursts (smashed walls, impacts) |
| `circle-05` | Particle Pack `circle_05` | Soft round glow: embers, sparks, glow behind fire |
| `circle-02` | Particle Pack `circle_02` | Ring: shockwave, ground-impact ring |
| `flare-01`, `star-04` | Particle Pack `flare_01`, `star_04` | Spark glints |
| `trace-06`, `trace-07` | Particle Pack `trace_*` | Streaks: flying sparks and embers, arrows in flight |
| `explosion-1` … `explosion-4` | Smoke Particles `Explosion/explosion00/02/04/08` | Coloured fireball puffs (orange to red) |
| `flash-1`, `flash-2` | Smoke Particles `Flash/flash00/02` | Yellow-white blast flash |
| `smoke-black-1` … `-3` | Smoke Particles `Black smoke/blackSmoke00/03/06` | Dark smoke from burning buildings |
| `puff-1` … `puff-3` | Smoke Particles `White puff/whitePuff00/03/06` | White dust and steam puffs |
