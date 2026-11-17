import { CheckIcon, CoinsIcon, FireIcon, MountainsIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { BuildView, Game } from "../../game/client/game";
import { islandImage, span } from "../../game/client/map";
import { CREATIVE } from "../../game/client/modes";
import type { Showcase } from "../../game/client/scene/showcase";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  type CatalogueId,
  SHELF_IDS,
  SHELVES,
  type ShelfId,
} from "../../game/shared/catalogue";
import { CREW_PRICE, type CrewView } from "../../game/shared/crew";
import {
  type IslandInfo,
  isPlotShape,
  islandHeights,
  PLOT_SHAPE_IDS,
  PLOT_SHAPES,
  type PlotShapeId,
} from "../../game/shared/islands";
import {
  PLOT_SIZE_IDS,
  PLOT_SIZES,
  type PlotSizeId,
  plotTeam,
  upgradesOf,
} from "../../game/shared/plots";
import { SKINS, type SkinId, skinDef } from "../../game/shared/skins";
import {
  controlsOf,
  VEHICLE_KINDS,
  VEHICLE_SECTIONS,
  VEHICLES,
  type VehicleKind,
} from "../../game/shared/vehicles";
import {
  type Grip,
  gripOf,
  isThrown,
  WEAPON_KINDS,
  WEAPONS,
  type WeaponDef,
  type WeaponKind,
} from "../../game/shared/weapons";
import { SHOTS, SMOKE } from "../../game/shared/shots";

type Tab = "skins" | "weapons" | "vehicles" | "land" | "build" | "crew";

const TABS: readonly [Tab, string][] = [
  ["skins", "Skins"],
  ["weapons", "Weapons"],
  ["vehicles", "Vehicles"],
  ["land", "Land"],
  ["build", "Build"],
  ["crew", "Crew"],
];

/*
 * The marketplace: whatever you're looking at stands large on the left; the
 * right is everything on offer. Four shelves: skins (one row per character),
 * weapons (you carry one at a time), vehicles (spawned on suitable terrain
 * near you, one at a time) and land (a plot of your own, set down on the
 * grand map), then build: ready-made houses, walls, towers and the rest,
 * shelf by shelf, to set down on your land; and crew: men hired to live on
 * it, each armed with a weapon you buy him. Skins, weapons and vehicles are
 * free for now, their prices showing what each will cost once the market
 * takes coins; land, what you build on it and your crew are paid for from
 * your purse.
 */
export function Marketplace(props: {
  game: Game;
  touch: boolean;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
  /* A plot was chosen: go and pick a spot for it on the grand map. */
  onPlace: (size: PlotSizeId, shape: PlotShapeId) => void;
}) {
  const [tab, setTab] = useState<Tab>("skins");
  const [worn, setWorn] = useState<SkinId>(() => props.game.skin);
  const [picked, setPicked] = useState<SkinId>(worn);
  const [held, setHeld] = useState<WeaponKind | null>(() => props.game.armedWith);
  const [eyed, setEyed] = useState<WeaponKind>(() => held ?? WEAPON_KINDS[0]);
  const [ride, setRide] = useState<VehicleKind>(VEHICLE_KINDS[0]);
  const [shelf, setShelf] = useState<ShelfId>("homes");
  const [thing, setThing] = useState<CatalogueId>("cottage");
  /* Your land as it stands, refreshed every so often (coins come in, things go up). */
  const [build, setBuild] = useState(() => props.game.buildView());
  /* Your crew, likewise; the man you're looking at ("hire": the next one), and the weapon eyed for him. */
  const [crew, setCrew] = useState(() => props.game.crew);
  const [man, setMan] = useState<number | "hire">(() => props.game.crew.men[0]?.id ?? "hire");
  const [kit, setKit] = useState<WeaponKind | null>(
    () => props.game.crew.men[0]?.weapon ?? "cutlass",
  );
  /* Your land, if you have some: then the shelf offers to grow it instead. */
  const [mine] = useState(() => props.game.myPlot);
  const owns = mine?.plot?.size ?? null;
  const growTo = owns ? upgradesOf(owns) : [];
  /* Your own land as the map charts it. */
  const [minePicture] = useState(() =>
    mine
      ? (props.game
          .mapView()
          .islands.find((o) => o.info.id === mine.id)
          ?.image.toDataURL() ?? null)
      : null,
  );
  const [plot, setPlot] = useState<{ size: PlotSizeId; shape: PlotShapeId }>(() => ({
    size: owns ?? "cove",
    shape: mine && isPlotShape(mine.shape) ? mine.shape : "round",
  }));
  /* Looking at the land you already have, rather than something on offer. */
  const ownsThis = owns !== null && plot.size === owns;
  const [portraits, setPortraits] = useState<Map<SkinId, string> | null>(null);
  const [weaponPortraits, setWeaponPortraits] = useState<Map<WeaponKind, string> | null>(null);
  const [vehiclePortraits, setVehiclePortraits] = useState<Map<VehicleKind, string> | null>(null);
  const [itemPortraits, setItemPortraits] = useState<Map<CatalogueId, string> | null>(null);
  /* Built things wear your land's colours (blue until you have some). */
  const team = mine ? plotTeam(mine.id) : "blue";
  const canvas = useRef<HTMLCanvasElement>(null);
  const showcase = useRef<Showcase | null>(null);
  const drag = useRef<number | null>(null);
  /* The man in the preview: the one you're looking at, or a likely-looking hand to hire. */
  const hand = crew.men.find((c) => c.id === man) ?? null;
  const handSkin: SkinId =
    hand?.skin ?? (props.game.skin === "bear-chief" ? "cutpurse" : "bear-chief");
  const latest = useRef({ tab, picked, eyed, ride, thing, team, handSkin });
  latest.current = { tab, picked, eyed, ride, thing, team, handSkin };
  const { onClose } = props;

  /* The preview and the grid's portraits share three.js with the game. */
  useEffect(() => {
    let disposed = false;
    void import("../../game/client/scene/showcase").then((mod) => {
      if (disposed || !canvas.current) return;
      showcase.current = new mod.Showcase(canvas.current);
      const now = latest.current;
      if (now.tab === "skins") showcase.current.show(now.picked);
      else if (now.tab === "weapons") showcase.current.showWeapon(now.eyed);
      else if (now.tab === "build") showcase.current.showItem(now.thing, now.team);
      else if (now.tab === "crew") showcase.current.show(now.handSkin);
      else showcase.current.showVehicle(now.ride);
      void mod.portraitsOf(SKINS.map((s) => s.id)).then((p) => {
        if (!disposed) setPortraits(p);
      });
      void mod.weaponPortraitsOf(WEAPON_KINDS).then((p) => {
        if (!disposed) setWeaponPortraits(p);
      });
      void mod.vehiclePortraitsOf(VEHICLE_KINDS).then((p) => {
        if (!disposed) setVehiclePortraits(p);
      });
      void mod.itemPortraitsOf(CATALOGUE_IDS, latest.current.team).then((p) => {
        if (!disposed) setItemPortraits(p);
      });
    });
    return () => {
      disposed = true;
      showcase.current?.dispose();
      showcase.current = null;
    };
  }, []);

  useEffect(() => {
    if (tab === "skins") showcase.current?.show(picked);
    else if (tab === "weapons") showcase.current?.showWeapon(eyed);
    else if (tab === "vehicles") showcase.current?.showVehicle(ride);
    else if (tab === "build") showcase.current?.showItem(thing, team);
    else if (tab === "crew") showcase.current?.show(handSkin);
  }, [tab, picked, eyed, ride, thing, team, handSkin]);

  useEffect(() => {
    const timer = setInterval(() => {
      setBuild(props.game.buildView());
      setCrew(props.game.crew);
    }, 500);
    return () => clearInterval(timer);
  }, [props.game]);

  /* A man just hired is the one you look at next; one let go takes you back to hiring. */
  const known = useRef(crew.men.map((c) => c.id));
  useEffect(() => {
    const fresh = crew.men.find((c) => !known.current.includes(c.id));
    known.current = crew.men.map((c) => c.id);
    if (fresh) {
      setMan(fresh.id);
      setKit(fresh.weapon ?? "cutlass");
    } else if (man !== "hire" && !crew.men.some((c) => c.id === man)) setMan("hire");
  }, [crew, man]);

  /* The land's pictures (a chart of each shape at each size) are drawn when the shelf is first opened. */
  const [landOpened, setLandOpened] = useState(false);
  if (tab === "land" && !landOpened) setLandOpened(true);
  const lands = useMemo(() => (landOpened ? chartLands() : null), [landOpened]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const wear = (skin: SkinId) => {
    props.game.wear(skin);
    setWorn(skin);
  };

  const hold = (kind: WeaponKind | null) => {
    props.game.arm(kind);
    setHeld(kind);
  };

  /* Out it goes, and the market closes so you can see it land. */
  const spawn = (kind: VehicleKind) => {
    if (!props.game.canSpawn) return;
    props.game.spawnVehicle(kind);
    onClose(true);
  };

  /* Off to set it down: the market closes and the ghost follows your crosshair. */
  const placeThing = (kind: CatalogueId) => {
    if (props.game.startPlacing(kind)) onClose(true);
  };

  const skin = skinDef(picked);
  const weapon = WEAPONS[eyed];
  const vehicle = VEHICLES[ride];
  const wearing = picked === worn;
  const holding = eyed === held;
  const canSpawn = props.game.canSpawn;
  const land = PLOT_SIZES[plot.size];
  const landName = mine
    ? ownsThis
      ? mine.name
      : `Grow to a ${land.name.toLowerCase()}`
    : `${PLOT_SHAPES[plot.shape].name} ${land.name.toLowerCase()}`;
  const name =
    tab === "skins"
      ? skin.name
      : tab === "weapons"
        ? weapon.name
        : tab === "vehicles"
          ? vehicle.name
          : tab === "build"
            ? CATALOGUE[thing].name
            : tab === "crew"
              ? (hand?.name ?? "Hire a man")
              : landName;
  const price = tab === "skins" ? skin.price : tab === "weapons" ? weapon.price : vehicle.price;
  const landPicture =
    tab !== "land"
      ? null
      : ownsThis && minePicture
        ? minePicture
        : (lands?.get(landKey(plot.size, plot.shape))?.url ?? null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-title"
      className="@container absolute inset-0 z-40 flex flex-col bg-black/85 text-white backdrop-blur-md select-none"
    >
      <header className="flex items-center justify-between gap-6 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-baseline gap-5 sm:gap-7">
          <h2 id="market-title" className="font-sans text-2xl leading-none font-extrabold">
            Marketplace
          </h2>
          <div role="tablist" aria-label="Shelves" className="flex items-baseline gap-4 sm:gap-5">
            {TABS.map(([t, label]) => (
              <Button
                key={t}
                role="tab"
                aria-selected={tab === t}
                variant="menu"
                size="inline"
                onClick={() => setTab(t)}
                className={cn(
                  "transition-colors",
                  tab === t ? "text-white" : "text-white/80 hover:text-white/70",
                )}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <Button variant="menu" size="inline" onClick={() => onClose(true)}>
          Close
          {!props.touch && <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Esc</Kbd>}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:flex-row @3xl:overflow-hidden">
        {/* The preview: no frame, it stands over the dimmed island. */}
        <section className="relative flex h-[min(26rem,60vh)] shrink-0 flex-col @3xl:h-auto @3xl:min-w-0 @3xl:flex-1">
          <canvas
            ref={canvas}
            aria-label={`${name}, drag to turn`}
            aria-hidden={tab === "land"}
            className={cn(
              "block min-h-0 w-full flex-1 cursor-grab touch-pan-y active:cursor-grabbing",
              tab === "land" && "invisible",
            )}
            onPointerDown={(e) => {
              drag.current = e.clientX;
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (drag.current === null) return;
              showcase.current?.turn(e.clientX - drag.current);
              drag.current = e.clientX;
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
          {/* Land is shown as it would be charted on the grand map. */}
          {tab === "land" && landPicture && (
            <img
              src={landPicture}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%-10rem)] w-full object-contain p-6"
            />
          )}
          <div className="flex items-end justify-between gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="truncate font-sans text-3xl leading-none font-extrabold">{name}</h3>
              {tab === "weapons" && <WeaponStats def={weapon} grip={gripOf(eyed)} />}
              {tab === "vehicles" && <VehicleStats kind={ride} />}
              {tab === "crew" ? (
                <CrewStats
                  hand={hand}
                  kit={kit}
                  order={crew.order}
                  men={crew.men.length}
                  cap={build.plot?.crew ?? null}
                  coins={props.game.coins}
                />
              ) : tab === "build" ? (
                <ThingStats kind={thing} build={build} />
              ) : tab === "land" ? (
                <LandStats
                  size={plot.size}
                  shape={plot.shape}
                  area={lands?.get(landKey(plot.size, plot.shape))?.area ?? null}
                  coins={props.game.coins}
                  owned={ownsThis ? (growTo.length ? "growable" : "full") : null}
                  shield={ownsThis && mine ? props.game.shieldLeft(mine.id) : null}
                />
              ) : tab === "weapons" && isThrown(eyed) ? (
                <div className="font-sans text-sm tabular-nums text-white/80">
                  ◎ {price} each · up to five on your belt
                </div>
              ) : (
                <Price price={price} />
              )}
            </div>
            {tab === "crew" ? (
              <CrewAction
                game={props.game}
                hand={hand}
                kit={kit}
                men={crew.men.length}
                cap={build.plot?.crew ?? null}
                ashore={build.ashore}
              />
            ) : tab === "build" ? (
              <ThingAction game={props.game} kind={thing} build={build} onPlace={placeThing} />
            ) : tab === "land" ? (
              <LandAction
                game={props.game}
                mine={mine}
                size={plot.size}
                shape={plot.shape}
                onPlace={props.onPlace}
                onClose={onClose}
              />
            ) : tab === "vehicles" ? (
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Button disabled={!canSpawn} onClick={() => spawn(ride)}>
                  Spawn
                </Button>
                {!canSpawn && (
                  <span className="font-sans text-[12px] text-white/80">Go ashore first</span>
                )}
              </div>
            ) : tab === "skins" ? (
              <Button disabled={wearing} onClick={() => wear(picked)}>
                {wearing ? "Wearing" : "Wear"}
                {wearing && <CheckIcon size={14} weight="bold" />}
              </Button>
            ) : isThrown(eyed) ? (
              /* Kegs and smoke bombs are bought, one at a time, onto the belt. */
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Button
                  disabled={!canSpawn || props.game.coins < weapon.price}
                  onClick={() => props.game.arm(eyed)}
                >
                  Buy one · ◎ {weapon.price}
                </Button>
                {!canSpawn && (
                  <span className="font-sans text-[12px] text-white/80">Go ashore first</span>
                )}
              </div>
            ) : holding ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="secondary" onClick={() => hold(null)}>
                  Put away
                </Button>
                <Button disabled>
                  Holding
                  <CheckIcon size={14} weight="bold" />
                </Button>
              </div>
            ) : (
              <Button onClick={() => hold(eyed)}>Hold</Button>
            )}
          </div>
        </section>

        {/* Everything on the shelf: skins one row per character, weapons light to heavy, then vehicles. */}
        <ul className="grid shrink-0 grid-cols-3 content-start gap-2 px-5 pb-5 sm:px-6 sm:pb-6 @3xl:w-[min(30rem,44%)] @3xl:overflow-y-auto @3xl:pt-1 @3xl:pl-1">
          {tab === "crew" ? (
            <>
              <li className="col-span-3 flex items-baseline justify-between pb-0.5 font-sans text-[11px] font-bold tracking-wide text-white/60 uppercase">
                <span>Your crew</span>
                <span className="tabular-nums">
                  {build.plot ? `${crew.men.length} of ${build.plot.crew}` : "no land yet"}
                </span>
              </li>
              {crew.men.map((c) => (
                <li key={c.id}>
                  <Tile
                    name={c.name}
                    caption
                    note={c.down ? "Knocked out" : c.weapon ? WEAPONS[c.weapon].name : "Fists"}
                    portrait={portraits?.get(c.skin) ?? null}
                    picked={man === c.id}
                    chosen={false}
                    chosenLabel=""
                    dim={c.down}
                    onPick={() => {
                      setMan(c.id);
                      setKit(c.weapon ?? kit);
                    }}
                    onChoose={() => setMan(c.id)}
                  />
                </li>
              ))}
              <li>
                <button
                  type="button"
                  aria-pressed={man === "hire"}
                  onClick={() => setMan("hire")}
                  onDoubleClick={() => props.game.hireCrew()}
                  className={cn(
                    "relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/25 bg-white/[0.02] font-sans text-[11px] font-bold text-white/70 transition-colors outline-none hover:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60",
                    man === "hire" && "border-solid bg-white/[0.08] ring-2 ring-white",
                  )}
                >
                  <PlusIcon size={22} weight="bold" />
                  <span>Hire · ◎ {CREW_PRICE}</span>
                </button>
              </li>
              {hand && (
                <>
                  <li className="col-span-3 pt-3 pb-0.5 font-sans text-[11px] font-bold tracking-wide text-white/60 uppercase">
                    Arm {hand.name}
                  </li>
                  {WEAPON_KINDS.filter((k) => !isThrown(k)).map((k) => (
                    <li key={k}>
                      <Tile
                        name={WEAPONS[k].name}
                        caption
                        price={WEAPONS[k].price}
                        portrait={weaponPortraits?.get(k) ?? null}
                        picked={kit === k}
                        chosen={hand.weapon === k}
                        chosenLabel="carrying"
                        onPick={() => setKit(k)}
                        onChoose={() => props.game.armCrew(hand.id, k)}
                      />
                    </li>
                  ))}
                </>
              )}
            </>
          ) : tab === "build" ? (
            <>
              <li className="col-span-3 flex flex-wrap items-baseline gap-x-4 gap-y-2 pb-1">
                <div role="tablist" aria-label="Build shelves" className="contents">
                  {SHELF_IDS.map((id) => (
                    <Button
                      key={id}
                      role="tab"
                      aria-selected={shelf === id}
                      variant="menu"
                      size="inline"
                      onClick={() => {
                        setShelf(id);
                        setThing(CATALOGUE_IDS.find((k) => CATALOGUE[k].shelf === id) ?? thing);
                      }}
                      className={cn(
                        "text-[13px] transition-colors",
                        shelf === id ? "text-white" : "text-white/60 hover:text-white/80",
                      )}
                    >
                      {SHELVES[id]}
                    </Button>
                  ))}
                </div>
              </li>
              {CATALOGUE_IDS.filter((k) => CATALOGUE[k].shelf === shelf).map((k) => {
                const why = props.game.buildBlock(k);
                return (
                  <li key={k}>
                    <Tile
                      name={CATALOGUE[k].name}
                      caption
                      price={CATALOGUE[k].price}
                      dim={why !== null}
                      portrait={itemPortraits?.get(k) || null}
                      picked={thing === k}
                      chosen={false}
                      chosenLabel=""
                      onPick={() => setThing(k)}
                      onChoose={() => placeThing(k)}
                    />
                  </li>
                );
              })}
            </>
          ) : tab === "skins" ? (
            SKINS.map((s) => (
              <li key={s.id}>
                <Tile
                  name={s.name}
                  portrait={portraits?.get(s.id) ?? null}
                  picked={picked === s.id}
                  chosen={worn === s.id}
                  chosenLabel="wearing"
                  onPick={() => setPicked(s.id)}
                  onChoose={() => wear(s.id)}
                />
              </li>
            ))
          ) : tab === "weapons" ? (
            WEAPON_KINDS.map((k) => (
              <li key={k}>
                <Tile
                  name={WEAPONS[k].name}
                  caption
                  portrait={weaponPortraits?.get(k) ?? null}
                  picked={eyed === k}
                  chosen={held === k}
                  chosenLabel="holding"
                  onPick={() => setEyed(k)}
                  onChoose={() => hold(k)}
                />
              </li>
            ))
          ) : tab === "land" ? (
            (owns ? [owns, ...growTo] : PLOT_SIZE_IDS).map((size) => (
              <Fragment key={size}>
                <li className="col-span-3 flex items-baseline justify-between pt-3 pb-0.5 font-sans text-[11px] font-bold tracking-wide text-white/60 uppercase first:pt-0">
                  <span>
                    {PLOT_SIZES[size].name} · {PLOT_SIZES[size].size} m
                  </span>
                  <span className="tabular-nums">
                    {owns === size
                      ? "yours"
                      : `◎ ${landCost(size, owns ?? undefined).toLocaleString("en-US")}`}
                  </span>
                </li>
                {/* Grown land keeps its shape; bought land comes in any. */}
                {(mine ? [plot.shape] : PLOT_SHAPE_IDS).map((shape) => (
                  <li key={shape}>
                    <Tile
                      name={`${PLOT_SHAPES[shape].name} ${PLOT_SIZES[size].name.toLowerCase()}`}
                      caption
                      portrait={
                        owns === size && minePicture
                          ? minePicture
                          : (lands?.get(landKey(size, shape))?.url ?? null)
                      }
                      picked={plot.size === size && plot.shape === shape}
                      chosen={owns === size}
                      chosenLabel="yours"
                      onPick={() => setPlot({ size, shape })}
                      onChoose={() => {
                        if (!mine && props.game.canBuyLand) props.onPlace(size, shape);
                      }}
                    />
                  </li>
                ))}
              </Fragment>
            ))
          ) : (
            VEHICLE_SECTIONS.map((section) => (
              <Fragment key={section}>
                <li className="col-span-3 pt-3 pb-0.5 font-sans text-[11px] font-bold tracking-wide text-white/60 uppercase first:pt-0">
                  {section}
                </li>
                {VEHICLE_KINDS.filter((k) => VEHICLES[k].section === section).map((k) => (
                  <li key={k}>
                    <Tile
                      name={VEHICLES[k].name}
                      caption
                      portrait={vehiclePortraits?.get(k) || null}
                      picked={ride === k}
                      chosen={false}
                      chosenLabel=""
                      onPick={() => setRide(k)}
                      onChoose={() => spawn(k)}
                    />
                  </li>
                ))}
              </Fragment>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/* ---------- land ---------- */

const landKey = (size: PlotSizeId, shape: PlotShapeId) => `${size}:${shape}`;

/* What a plot costs: its price, or what growing yours to it costs. */
function landCost(size: PlotSizeId, from?: PlotSizeId) {
  return PLOT_SIZES[size].price - (from ? PLOT_SIZES[from].price : 0);
}

/* A chart of every shape at every size (one seed each), and how much dry land it has. */
function chartLands() {
  const out = new Map<string, { url: string; area: number }>();
  const n = 97;
  for (const size of PLOT_SIZE_IDS)
    for (const shape of PLOT_SHAPE_IDS) {
      const side = PLOT_SIZES[size].size;
      const h = islandHeights(shape, 1, n, 1, side);
      let dry = 0;
      for (const v of h) if (v > 0) dry++;
      const cell = side / (n - 1);
      out.set(landKey(size, shape), {
        url: islandImage(h, n, 240).toDataURL(),
        area: dry * cell * cell,
      });
    }
  return out;
}

/* Square metres, as a person would say them. */
function areaText(m2: number) {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(1)} ha` : `${Math.round(m2 / 100) * 100} m²`;
}

function LandStats(props: {
  size: PlotSizeId;
  shape: PlotShapeId;
  area: number | null;
  coins: number;
  /* Your own land: whether it can still grow. */
  owned: "growable" | "full" | null;
  /* Your own land: seconds left on its shield (0: it can be raided). */
  shield: number | null;
}) {
  const def = PLOT_SIZES[props.size];
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[22rem] font-sans text-[13px] leading-snug text-white/80">
        {props.owned === "growable"
          ? "Your land: you wake at its Hearth. Pick a bigger size to grow it where it stands."
          : props.owned === "full"
            ? "Your land, as big as land grows. You wake at its Hearth."
            : `${PLOT_SHAPES[props.shape].note} A sandy shore all round, and a Hearth at its middle where you'll wake.`}
      </p>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label="Across" value={`${def.size} m`} />
        {props.area !== null && <Stat label="Land" value={areaText(props.area)} />}
        <Stat label="Your coins" value={`◎ ${props.coins.toLocaleString("en-US")}`} />
        {props.shield !== null && (
          <Stat
            label="Shield"
            value={props.shield > 0 ? `${span(props.shield)} left` : "Down · can be raided"}
          />
        )}
      </dl>
    </div>
  );
}

/* Buy this plot (and choose where it goes), or grow the one you have. */
function LandAction(props: {
  game: Game;
  mine: IslandInfo | null;
  size: PlotSizeId;
  shape: PlotShapeId;
  onPlace: (size: PlotSizeId, shape: PlotShapeId) => void;
  onClose: (byClick: boolean) => void;
}) {
  const { game, mine, size } = props;
  const from = mine?.plot?.size;
  const cost = landCost(size, from);
  const ashore = game.canBuyLand;
  const short = cost - game.coins;
  if (from === size) return null;
  /* Growing happens where the land stands, so the room round it has to allow it. */
  const room = mine ? game.checkPlot(size, mine.x, mine.z, mine.id) : null;
  const why = !ashore
    ? "Go ashore first"
    : short > 0
      ? `◎ ${short.toLocaleString("en-US")} more needed`
      : room && !room.ok
        ? room.reason
        : null;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button
        disabled={why !== null}
        onClick={() => {
          if (mine) {
            game.growPlot(size);
            props.onClose(true);
          } else props.onPlace(size, props.shape);
        }}
      >
        {mine ? "Grow it" : "Choose a spot"} · ◎ {cost.toLocaleString("en-US")}
      </Button>
      {why && (
        <span className="max-w-[16rem] text-right font-sans text-[12px] text-white/80">{why}</span>
      )}
    </div>
  );
}

/* ---------- crew ---------- */

const ORDER_NOTE = {
  home: "At home, keeping to their posts",
  follow: "Following you",
  hold: "Holding where you told them",
} as const;

/* A man: what he carries and how he is; or, hiring, what a man does and what he costs. */
function CrewStats(props: {
  hand: CrewView | null;
  kit: WeaponKind | null;
  order: keyof typeof ORDER_NOTE;
  men: number;
  cap: number | null;
  coins: number;
}) {
  const h = props.hand;
  if (!h)
    return (
      <div className="flex flex-col gap-1.5">
        <p className="max-w-[24rem] font-sans text-[13px] leading-snug text-white/80">
          He lives on your land and keeps a post there: a round of the Hearth, a tower or a gate,
          the village. He fights off raiders whether you're home or not. G calls your crew to follow
          you, aboard and ashore, and H has them hold where you stand. Never killed: knocked out, he
          wakes at your Hearth.
        </p>
        <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
          <Stat label="Price" value={`◎ ${CREW_PRICE}`} />
          {props.cap !== null && <Stat label="Crew" value={`${props.men} of ${props.cap}`} />}
          <Stat label="Your coins" value={`◎ ${props.coins.toLocaleString("en-US")}`} />
        </dl>
      </div>
    );
  const def = h.weapon ? WEAPONS[h.weapon] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[24rem] font-sans text-[13px] leading-snug text-white/80">
        {h.down
          ? "Knocked out. He'll come to at your Hearth before long."
          : `${ORDER_NOTE[props.order]}. He fights with whatever you give him, as you would with it.`}
      </p>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label="Carries" value={def?.name ?? "Fists"} />
        {def && <Stat label="Reach" value={`${def.reach} m`} />}
        <Stat label="Your coins" value={`◎ ${props.coins.toLocaleString("en-US")}`} />
      </dl>
    </div>
  );
}

/* Hire the next man; or arm the one you're looking at, or let him go (pressed twice). */
function CrewAction(props: {
  game: Game;
  hand: CrewView | null;
  kit: WeaponKind | null;
  men: number;
  cap: number | null;
  ashore: boolean;
}) {
  const { game, hand, kit } = props;
  const [letGo, setLetGo] = useState<number | null>(null);
  if (!hand) {
    const why =
      props.cap === null
        ? "Buy land first: your crew lives on it"
        : !props.ashore
          ? "Go ashore first"
          : props.men >= props.cap
            ? "Your land houses no more: grow it for more men"
            : game.coins < CREW_PRICE
              ? `◎ ${(CREW_PRICE - game.coins).toLocaleString("en-US")} more needed`
              : null;
    return (
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Button disabled={why !== null} onClick={() => game.hireCrew()}>
          Hire · ◎ {CREW_PRICE}
        </Button>
        {why && (
          <span className="max-w-[16rem] text-right font-sans text-[12px] text-white/80">
            {why}
          </span>
        )}
      </div>
    );
  }
  const price = kit ? WEAPONS[kit].price : 0;
  const has = hand.weapon === kit;
  const short = price - game.coins;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button disabled={has || short > 0} onClick={() => game.armCrew(hand.id, kit)}>
        {has
          ? `Carrying the ${kit ? WEAPONS[kit].name.toLowerCase() : "fists"}`
          : kit
            ? `Arm with the ${WEAPONS[kit].name.toLowerCase()} · ◎ ${price}`
            : "Take his weapon"}
        {has && <CheckIcon size={14} weight="bold" />}
      </Button>
      <div className="flex items-center gap-3">
        {hand.weapon && (
          <Button variant="menu" size="inline" onClick={() => game.armCrew(hand.id, null)}>
            Take his weapon
          </Button>
        )}
        <Button
          variant="menu"
          size="inline"
          onClick={() => {
            if (letGo === hand.id) {
              game.dismissCrew(hand.id);
              setLetGo(null);
            } else setLetGo(hand.id);
          }}
        >
          {letGo === hand.id ? "Press again to let him go" : "Dismiss"}
        </Button>
      </div>
      {short > 0 && !has && (
        <span className="max-w-[16rem] text-right font-sans text-[12px] text-white/80">
          ◎ {short.toLocaleString("en-US")} more needed
        </span>
      )}
    </div>
  );
}

/* ---------- build ---------- */

/* What a ready-made thing is: what it's made of, how much it takes, how big it is, and your land's budget. */
function ThingStats(props: { kind: CatalogueId; build: BuildView }) {
  const d = CATALOGUE[props.kind];
  const plot = props.build.plot;
  const wood = d.material === "wood";
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[22rem] font-sans text-[13px] leading-snug text-white/80">{d.note}</p>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label="Price" value={`◎ ${d.price.toLocaleString("en-US")}`} />
        <Stat label="Health" value={d.health.toLocaleString("en-US")} />
        <Stat label="Size" value={`${(d.hx * 2).toFixed(1)} × ${(d.hz * 2).toFixed(1)} m`} />
      </dl>
      <div className="flex flex-wrap items-center gap-2 font-sans text-[12px] font-bold">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
            wood ? "bg-[#f2665e]/20 text-[#ffb3ad]" : "bg-white/10 text-white/80",
          )}
        >
          {wood ? <FireIcon size={12} weight="fill" /> : <MountainsIcon size={12} weight="fill" />}
          {wood ? "Wood · burns" : "Stone · won't burn"}
        </span>
        {d.wall && <span className="text-white/60">Snaps end to end</span>}
        {d.post && <span className="text-white/60">Snaps onto wall ends</span>}
      </div>
      <p className="font-sans text-[12px] text-white/60 tabular-nums">
        {plot
          ? `${plot.name}: ${plot.items} of ${plot.cap} things · ◎ ${props.build.coins.toLocaleString("en-US")}`
          : "Things you build stand on land of your own: buy a plot first."}
      </p>
    </div>
  );
}

/* Buy it and set it down, or why not. */
function ThingAction(props: {
  game: Game;
  kind: CatalogueId;
  build: BuildView;
  onPlace: (kind: CatalogueId) => void;
}) {
  const why = props.game.buildBlock(props.kind);
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Button disabled={why !== null} onClick={() => props.onPlace(props.kind)}>
        Buy & place · ◎ {CATALOGUE[props.kind].price.toLocaleString("en-US")}
      </Button>
      {why && (
        <span className="max-w-[16rem] text-right font-sans text-[12px] text-white/80">{why}</span>
      )}
      {CREATIVE && props.build.ashore && (
        <Button variant="menu" size="inline" onClick={() => props.game.devCoins()}>
          +10,000 coins (dev)
          <CoinsIcon size={13} weight="fill" />
        </Button>
      )}
    </div>
  );
}

function Price(props: { price: number }) {
  return (
    <div className="flex items-baseline gap-2 font-sans text-sm tabular-nums">
      {props.price > 0 && <span className="text-white/80 line-through">◎ {props.price}</span>}
      <span className="text-white/70">Free</span>
    </div>
  );
}

/* How quickly it comes round again, in words. */
function pace(cooldown: number) {
  if (cooldown < 0.3) return "Very fast";
  if (cooldown < 0.5) return "Fast";
  if (cooldown < 0.9) return "Steady";
  if (cooldown < 1.25) return "Slow";
  return "Very slow";
}

/* How it's held, in words. */
const HELD: Record<Grip, string> = {
  unarmed: "Bare hands",
  "1h": "One hand",
  "2h": "Two hands",
  dual: "A pair",
  polearm: "Two hands",
  shield: "Left arm",
  bow: "Left hand",
  crossbow: "Shouldered",
};

/* How well it batters buildings: what a full blow takes off a wooden wall. */
function siegeOf(d: WeaponDef) {
  const blow = (d.charged ?? d.damage) * d.siege;
  return blow >= 20 ? "Heavy" : blow >= 8 ? "Fair" : blow >= 2 ? "Light" : "None";
}

/* What a weapon does: how it's held, damage, reach and pace, then what makes it different. */
function WeaponStats(props: { def: WeaponDef; grip: Grip }) {
  const d = props.def;
  const damage = d.charged ? `${d.damage}–${d.charged}` : `${d.damage}`;
  const special = d.hint.split(" · ").slice(1).join(" · ");
  const thrown = d.throws ? SHOTS[d.throws.shot] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label="Held" value={thrown ? "One hand" : HELD[props.grip]} />
        {thrown ? (
          thrown.blast ? (
            <>
              <Stat label="Blast" value={`${thrown.blast.radius} m`} />
              <Stat label="Fuse" value={`${thrown.fuse ?? 0} s`} />
              <Stat label="Siege" value="Breaks stone" />
            </>
          ) : (
            <Stat label="Cloud" value={`${SMOKE.radius * 2} m · ${SMOKE.time} s`} />
          )
        ) : (
          <>
            {/* A shield's blow is its bash. */}
            <Stat label={d.guard ? "Bash" : "Damage"} value={damage} />
            {d.ranged ? (
              <Stat label="Flies" value={`${d.ranged.speed[1]} m/s`} />
            ) : (
              <Stat label="Reach" value={`${d.reach} m`} />
            )}
            <Stat label="Pace" value={pace(d.cooldown)} />
            <Stat label="Siege" value={siegeOf(d)} />
          </>
        )}
      </dl>
      {special && (
        <p className="max-w-[22rem] font-sans text-[13px] leading-snug text-white/80">
          {special.charAt(0).toUpperCase() + special.slice(1)}
        </p>
      )}
    </div>
  );
}

/* What a vehicle is like: its pace, who it carries, and how you drive it. */
function VehicleStats(props: { kind: VehicleKind }) {
  const d = VEHICLES[props.kind];
  const top = d.hull?.speed ?? d.car?.speed ?? d.mount?.gallop ?? 0;
  const afloat = !!d.hull;
  const pace = afloat ? `${Math.round(top * 1.944)} knots` : `${Math.round(top * 3.6)} km/h`;
  const seats = d.seats.length;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="max-w-[22rem] font-sans text-[13px] leading-snug text-white/80">{d.blurb}</p>
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label={d.class === "sail" ? "Best pace" : "Top speed"} value={pace} />
        <Stat label="Seats" value={seats === 1 ? "1" : `${seats}`} />
        <Stat label="Length" value={`${d.length.toFixed(1)} m`} />
      </dl>
      <p className="max-w-[22rem] font-sans text-[12px] leading-snug text-white/60">
        {controlsOf(props.kind)}
      </p>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-white/80">{props.label}</dt>
      <dd className="font-bold text-white">{props.value}</dd>
    </div>
  );
}

/* One thing on offer: click to look at it, double-click to wear, hold or spawn it. */
function Tile(props: {
  name: string;
  /* Print the name on the tile: weapons look alike at a glance, skins don't. */
  caption?: boolean;
  /* A price under the name, or a word about it. */
  price?: number;
  note?: string;
  /* Greyed: it can't be had right now. */
  dim?: boolean;
  portrait: string | null;
  picked: boolean;
  chosen: boolean;
  chosenLabel: string;
  onPick: () => void;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.picked}
      aria-label={props.chosen ? `${props.name}, ${props.chosenLabel}` : props.name}
      title={props.name}
      onClick={props.onPick}
      onDoubleClick={props.onChoose}
      className={cn(
        "relative block aspect-[4/5] w-full overflow-hidden rounded-lg bg-white/[0.04] transition-colors outline-none hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-white/60",
        props.picked && "bg-white/[0.08] ring-2 ring-white",
      )}
    >
      {props.portrait ? (
        <img
          src={props.portrait}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 h-full w-full object-contain",
            props.dim && "opacity-45 grayscale-[60%]",
          )}
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      )}
      {props.caption && (
        <span className="absolute inset-x-2 bottom-2 flex flex-col text-left font-sans text-[11px] font-bold text-white/70">
          <span className="truncate">{props.name}</span>
          {props.price !== undefined && (
            <span className={cn("tabular-nums", props.dim ? "text-white/45" : "text-white/90")}>
              ◎ {props.price.toLocaleString("en-US")}
            </span>
          )}
          {props.note && <span className="truncate font-normal text-white/60">{props.note}</span>}
        </span>
      )}
      {props.chosen && (
        <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-white text-black">
          <CheckIcon size={11} weight="bold" />
        </span>
      )}
    </button>
  );
}
