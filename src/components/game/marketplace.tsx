import { CheckIcon, CoinsIcon, FireIcon, MountainsIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { getArsenal, getWeapon, subscribeArsenal } from "../../game/client/arsenal";
import type { BuildView, Game } from "../../game/client/game";
import { islandImage, span } from "../../game/client/map";
import { CREATIVE } from "../../game/client/modes";
import {
  CATALOGUE,
  CATALOGUE_IDS,
  type CatalogueId,
  SHELF_IDS,
  SHELVES as BUILD_SHELVES,
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
import { SHOTS, SMOKE } from "../../game/shared/shots";
import { SKINS, type SkinId, skinDef } from "../../game/shared/skins";
import {
  gunsOf,
  hullOf,
  TIER_NAMES,
  VEHICLE_KINDS,
  VEHICLE_TIERS,
  VEHICLES,
  type VehicleKind,
  type VehicleTier,
} from "../../game/shared/vehicles";
import {
  type Grip,
  gripOf,
  isThrown,
  STACK,
  WEAPON_KINDS,
  WEAPONS,
  type WeaponDef,
  type WeaponKind,
} from "../../game/shared/weapons";

export type Shelf = "weapons" | "vehicles" | "skins" | "land" | "build" | "crew";

const SHELVES: readonly [Shelf, string][] = [
  ["weapons", "Weapons"],
  ["vehicles", "Vehicles"],
  ["skins", "Skins"],
  ["land", "Land"],
  ["build", "Build"],
  ["crew", "Crew"],
];

/* How it's held, in words. */
export const HELD: Record<Grip, string> = {
  unarmed: "Bare hands",
  "1h": "One hand",
  "2h": "Two hands",
  dual: "A pair",
  polearm: "Two hands",
  shield: "Left arm",
  bow: "Bow",
  crossbow: "Shouldered",
  magic: "Spell",
};

/* What each tier of vehicles means, under its heading. */
const TIER_NOTES: Record<VehicleTier, string> = {
  free: "Everyone's from the start",
  cheap: "A few contracts from the Guild Board",
  premium: "Worth saving up for",
};

/* Coins, the way the rest of the game writes them. */
const coins = (n: number) => `◎ ${n.toLocaleString("en")}`;

/* A vehicle's best pace, in knots afloat or km/h ashore. */
export function topSpeed(kind: VehicleKind) {
  const d = VEHICLES[kind];
  const top = d.hull?.speed ?? d.car?.speed ?? d.mount?.gallop ?? 0;
  return d.hull ? `${Math.round(top * 1.944)} knots` : `${Math.round(top * 3.6)} km/h`;
}

/* How quickly it comes round again, in words. */
function pace(cooldown: number) {
  if (cooldown < 0.3) return "very fast";
  if (cooldown < 0.5) return "fast";
  if (cooldown < 0.9) return "steady";
  if (cooldown < 1.25) return "slow";
  return "very slow";
}

/* How well it batters buildings: what a full blow (or shot) takes off a wooden wall. */
function siegeOf(d: WeaponDef) {
  const blow = (d.ranged?.damage[1] ?? d.charged ?? d.damage) * d.siege;
  return blow >= 20 ? "heavy" : blow >= 8 ? "fair" : blow >= 2 ? "light" : "no";
}

/* One short line about a weapon: how it's held, what it does, and what makes it different. */
function weaponSummary(kind: WeaponKind) {
  const d = WEAPONS[kind];
  const special = d.hint.split(" · ").slice(1).join(" · ");
  if (d.throws) {
    const s = SHOTS[d.throws.shot];
    const what = s.blast
      ? `Thrown · a ${s.blast.radius} m blast after ${s.fuse ?? 0} s · breaks stone`
      : `Thrown · a ${SMOKE.radius * 2} m cloud for ${SMOKE.time} s`;
    return `${what} · up to ${STACK} on your belt`;
  }
  const r = d.ranged;
  const [lo, hi] = r ? r.damage : [d.damage, d.charged ?? d.damage];
  const damage = lo === hi ? `${lo}` : `${lo}–${hi}`;
  const reach = r ? `about ${d.reach} m range` : `${d.reach} m reach`;
  const parts = [
    HELD[gripOf(kind)],
    `${damage} ${d.guard ? "bash" : "damage"}`,
    reach,
    pace(d.cooldown),
    `${siegeOf(d)} siege`,
  ];
  return `${parts.join(" · ")}${special ? ` · ${special}` : ""}`;
}

/* One short line about a vehicle. */
function vehicleSummary(kind: VehicleKind) {
  const seats = VEHICLES[kind].seats.length;
  const guns = gunsOf(kind);
  return [
    topSpeed(kind),
    `${seats} ${seats === 1 ? "seat" : "seats"}`,
    ...(guns ? [`${guns} guns a side`] : []),
    `${hullOf(kind).toLocaleString("en")} hull`,
    VEHICLES[kind].blurb,
  ].join(" · ");
}

/*
 * The marketplace: where weapons and vehicles are got (once, and kept on your
 * Arsenal wheel, Q), skins are worn, and land, what's built on it and the
 * crew who live there are bought. A pop-up over the island, shelves of
 * pictures; pick one and the bar along the bottom says what it is and what
 * you can do with it.
 *
 * Vehicles cost coins from the Guild Board, by tier: the free ones are
 * everyone's, the rest are bought once and kept (a wreck only sends it back
 * to the yard: spawn it again). Land, the things you build on it, your crew
 * and their weapons, and kegs and smoke bombs (one at a time) are paid for
 * too. The room does the selling (and says what's short); your purse sits in
 * the header. Weapons and skins are still free; their prices show what
 * they'll cost once those take coins too.
 */
export function Marketplace(props: {
  game: Game;
  touch: boolean;
  /* The shelf it opens on. */
  shelf?: Shelf;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
  /* A plot was chosen: go and pick a spot for it on the grand map. */
  onPlace: (size: PlotSizeId, shape: PlotShapeId) => void;
}) {
  const { game, onClose } = props;
  const owned = useSyncExternalStore(subscribeArsenal, getArsenal);
  const [shelf, setShelf] = useState<Shelf>(props.shelf ?? "weapons");
  /* A purchase on its way to the room: its button waits until the room answers. */
  const [buying, setBuying] = useState<VehicleKind | null>(null);
  const [worn, setWorn] = useState<SkinId>(() => game.skin);
  const [held, setHeld] = useState<WeaponKind | null>(() => game.armedWith);
  const [picked, setPicked] = useState<Record<"weapons" | "vehicles" | "skins", string>>(() => ({
    weapons: game.armedWith ?? WEAPON_KINDS[0],
    vehicles: VEHICLE_KINDS[0],
    skins: game.skin,
  }));
  const [art, setArt] = useState<
    Record<"weapons" | "vehicles" | "skins", Map<string, string> | null>
  >({
    weapons: null,
    vehicles: null,
    skins: null,
  });
  const [itemArt, setItemArt] = useState<Map<CatalogueId, string> | null>(null);

  /* The build shelves, and the thing picked on them. */
  const [bench, setBench] = useState<ShelfId>("homes");
  const [thing, setThing] = useState<CatalogueId>("cottage");
  /* Your land as it stands, refreshed every so often (coins come in, things go up). */
  const [build, setBuild] = useState(() => game.buildView());
  /* Your crew, likewise; the man you're looking at ("hire": the next one), and the weapon eyed for him. */
  const [crew, setCrew] = useState(() => game.crew);
  const [man, setMan] = useState<number | "hire">(() => game.crew.men[0]?.id ?? "hire");
  const [kit, setKit] = useState<WeaponKind | null>(() => game.crew.men[0]?.weapon ?? "cutlass");
  /* Your land, if you have some: then the shelf offers to grow it instead. */
  const [mine] = useState(() => game.myPlot);
  const owns = mine?.plot?.size ?? null;
  const growTo = owns ? upgradesOf(owns) : [];
  /* Your own land as the map charts it. */
  const [minePicture] = useState(() =>
    mine
      ? (game
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
  /* Built things wear your land's colours (blue until you have some). */
  const team = mine ? plotTeam(mine.id) : "blue";

  /* Portraits share three.js with the game; each is drawn once and kept. */
  useEffect(() => {
    let gone = false;
    void import("../../game/client/scene/showcase").then((mod) => {
      const keep = (s: "weapons" | "vehicles" | "skins") => (m: Map<string, string>) => {
        if (!gone) setArt((a) => ({ ...a, [s]: m }));
      };
      void mod.weaponPortraitsOf(WEAPON_KINDS).then(keep("weapons"));
      void mod.vehiclePortraitsOf(VEHICLE_KINDS).then(keep("vehicles"));
      void mod.portraitsOf(SKINS.map((s) => s.id)).then(keep("skins"));
      void mod.itemPortraitsOf(CATALOGUE_IDS, team).then((m) => {
        if (!gone) setItemArt(m);
      });
    });
    return () => {
      gone = true;
    };
  }, [team]);

  useEffect(() => {
    const timer = setInterval(() => {
      setBuild(game.buildView());
      setCrew(game.crew);
    }, 500);
    return () => clearInterval(timer);
  }, [game]);

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
  if (shelf === "land" && !landOpened) setLandOpened(true);
  const lands = useMemo(() => (landOpened ? chartLands() : null), [landOpened]);

  /* The room's answer is a new inventory (bought) or a line in the feed (not): stop waiting either way. */
  useEffect(() => {
    if (!buying) return;
    if (owned.vehicles.includes(buying)) {
      setBuying(null);
      return;
    }
    const t = window.setTimeout(() => setBuying(null), 2500);
    return () => window.clearTimeout(t);
  }, [buying, owned]);

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
    game.wear(skin);
    setWorn(skin);
  };
  const hold = (kind: WeaponKind | null) => {
    game.arm(kind);
    setHeld(kind);
  };
  /* Kegs and smoke bombs are bought, one at a time, onto the belt (the room takes the coins). */
  const buyThrown = (kind: WeaponKind) => {
    if (game.canBuy && owned.coins >= WEAPONS[kind].price) game.arm(kind);
  };
  /* Out it goes, and the market closes so you can see it land. */
  const spawn = (kind: VehicleKind) => {
    if (!game.canSpawn) return;
    game.spawnVehicle(kind);
    onClose(true);
  };
  const buy = (kind: VehicleKind) => {
    if (!game.canBuy || buying || owned.coins < VEHICLES[kind].price) return;
    setBuying(kind);
    game.buyVehicle(kind);
  };
  /* Off to set it down: the market closes and the ghost follows your crosshair. */
  const placeThing = (kind: CatalogueId) => {
    if (game.startPlacing(kind)) onClose(true);
  };

  /*
   * Double-click (or the bar's first button): get it, or use it if it's yours.
   * Coins are only spent from the button, never by a double-click.
   */
  const primary = (target: string, byButton = false) => {
    if (shelf === "skins") return wear(target as SkinId);
    if (shelf === "weapons") {
      const kind = target as WeaponKind;
      if (isThrown(kind)) {
        if (byButton) buyThrown(kind);
      } else if (!owned.weapons.includes(kind)) getWeapon(kind);
      else hold(kind);
      return;
    }
    const kind = target as VehicleKind;
    if (owned.vehicles.includes(kind)) spawn(kind);
    else if (byButton) buy(kind);
  };

  const tile = (
    s: "weapons" | "vehicles" | "skins",
    key: string,
    label: string,
    badge: TileBadge,
  ) => (
    <li key={key}>
      <Tile
        name={label}
        portrait={art[s]?.get(key) || null}
        caption={s !== "skins"}
        picked={picked[s] === key}
        badge={badge}
        onPick={() => setPicked((p) => ({ ...p, [s]: key }))}
        onChoose={() => primary(key)}
      />
    </li>
  );

  /* The bar along the bottom: what's picked, a line about it, and what you can do. */
  let footer: { name: string; tag: ReactNode; about: ReactNode; actions: ReactNode };
  if (shelf === "weapons" || shelf === "vehicles" || shelf === "skins") {
    const id = picked[shelf];
    const ownsIt =
      shelf === "weapons"
        ? owned.weapons.includes(id as WeaponKind)
        : shelf === "vehicles"
          ? owned.vehicles.includes(id as VehicleKind)
          : true;
    const thrown = shelf === "weapons" && isThrown(id as WeaponKind);
    footer = {
      name:
        shelf === "weapons"
          ? WEAPONS[id as WeaponKind].name
          : shelf === "vehicles"
            ? VEHICLES[id as VehicleKind].name
            : skinDef(id as SkinId).name,
      tag:
        shelf === "vehicles" ? (
          <VehiclePrice kind={id as VehicleKind} owned={ownsIt} />
        ) : thrown ? (
          <span className="font-sans text-[12px] font-bold text-white/85 tabular-nums">
            {coins(WEAPONS[id as WeaponKind].price)} each
          </span>
        ) : (
          !ownsIt && (
            <Price
              price={
                shelf === "weapons" ? WEAPONS[id as WeaponKind].price : skinDef(id as SkinId).price
              }
            />
          )
        ),
      about:
        shelf === "weapons"
          ? weaponSummary(id as WeaponKind)
          : shelf === "vehicles"
            ? vehicleSummary(id as VehicleKind)
            : "Everyone sees you in it, out on the islands.",
      actions: (
        <Actions
          shelf={shelf}
          id={id}
          owned={ownsIt}
          held={held}
          worn={worn}
          canSpawn={game.canSpawn}
          canBuy={game.canBuy}
          coins={owned.coins}
          buying={buying === id}
          touch={props.touch}
          onPrimary={() => primary(id, true)}
          onPutAway={() => hold(null)}
        />
      ),
    };
  } else if (shelf === "land") {
    const land = PLOT_SIZES[plot.size];
    const area = lands?.get(landKey(plot.size, plot.shape))?.area ?? null;
    const shield = ownsThis && mine ? game.shieldLeft(mine.id) : null;
    footer = {
      name: mine
        ? ownsThis
          ? mine.name
          : `Grow to a ${land.name.toLowerCase()}`
        : `${PLOT_SHAPES[plot.shape].name} ${land.name.toLowerCase()}`,
      tag: (
        <span className="font-sans text-[12px] font-bold text-white/85 tabular-nums">
          {ownsThis ? "Yours" : coins(landCost(plot.size, owns ?? undefined))}
        </span>
      ),
      about: (
        <>
          {ownsThis
            ? growTo.length
              ? "Your land: you wake at its Hearth. Pick a bigger size to grow it where it stands."
              : "Your land, as big as land grows. You wake at its Hearth."
            : `${PLOT_SHAPES[plot.shape].note} A sandy shore all round, and a Hearth at its middle where you'll wake.`}{" "}
          {land.size} m across{area !== null && ` · ${areaText(area)} of land`}
          {shield !== null &&
            ` · ${shield > 0 ? `shielded, ${span(shield)} left` : "unshielded: it can be raided"}`}
        </>
      ),
      actions: (
        <LandAction
          game={game}
          mine={mine}
          size={plot.size}
          shape={plot.shape}
          coins={owned.coins}
          onPlace={props.onPlace}
          onClose={onClose}
        />
      ),
    };
  } else if (shelf === "build") {
    footer = {
      name: CATALOGUE[thing].name,
      tag: (
        <span className="font-sans text-[12px] font-bold text-white/85 tabular-nums">
          {coins(CATALOGUE[thing].price)}
        </span>
      ),
      about: <ThingAbout kind={thing} build={build} />,
      actions: <ThingAction game={game} kind={thing} build={build} onPlace={placeThing} />,
    };
  } else {
    const hand = crew.men.find((c) => c.id === man) ?? null;
    footer = {
      name: hand?.name ?? "Hire a man",
      tag: !hand && (
        <span className="font-sans text-[12px] font-bold text-white/85 tabular-nums">
          {coins(CREW_PRICE)}
        </span>
      ),
      about: <CrewAbout hand={hand} order={crew.order} />,
      actions: (
        <CrewAction
          game={game}
          hand={hand}
          kit={kit}
          men={crew.men.length}
          cap={build.plot?.crew ?? null}
          ashore={build.ashore}
          coins={owned.coins}
        />
      ),
    };
  }

  const heading = (key: string, left: ReactNode, right?: ReactNode) => (
    <li
      key={key}
      className="col-span-full flex items-baseline gap-2.5 pt-3 pb-0.5 first:pt-0 font-sans text-[11px]"
    >
      {left}
      {right && <span className="ml-auto text-white/40 tabular-nums">{right}</span>}
    </li>
  );
  const label = (text: string) => (
    <span className="font-bold tracking-wide text-white/60 uppercase">{text}</span>
  );

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-3 backdrop-blur-[6px] select-none sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(true);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-title"
        className="flex h-[min(40rem,100%)] w-[min(60rem,100%)] flex-col overflow-hidden rounded-2xl border border-[#242424] bg-[#0e0e0e]/95 text-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] duration-200 animate-in fade-in-0 zoom-in-[0.98]"
      >
        <header className="flex items-center gap-5 border-b border-[#242424] px-4 py-3 sm:gap-7 sm:px-5">
          <h2
            id="market-title"
            className="hidden font-sans text-xl leading-none font-extrabold md:block"
          >
            Marketplace
          </h2>
          <div
            role="tablist"
            aria-label="Shelves"
            className="flex min-w-0 items-center gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-5"
          >
            {SHELVES.map(([s, text]) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={shelf === s}
                onClick={() => setShelf(s)}
                className={cn(
                  "shrink-0 border-b-2 py-1 font-sans text-sm font-extrabold transition-colors outline-none focus-visible:text-white",
                  shelf === s
                    ? "border-[#f2665e] text-white"
                    : "border-transparent text-white/45 hover:text-white/75",
                )}
              >
                {text}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <span
            className="flex shrink-0 items-center rounded-md bg-white/[0.06] px-2.5 py-1 font-sans text-[13px] font-bold tabular-nums"
            title="Your coins, from the Guild Board"
          >
            <span className="mr-1.5 text-white/60">◎</span>
            {owned.coins.toLocaleString("en")}
          </span>
          <Button variant="menu" size="inline" onClick={() => onClose(true)}>
            Close
            {!props.touch && <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Esc</Kbd>}
          </Button>
        </header>

        <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] content-start gap-2 overflow-y-auto p-3 [scrollbar-width:none] sm:p-4">
          {shelf === "weapons" &&
            WEAPON_KINDS.map((k) =>
              tile(
                "weapons",
                k,
                WEAPONS[k].name,
                isThrown(k)
                  ? { price: WEAPONS[k].price, short: owned.coins < WEAPONS[k].price }
                  : held === k
                    ? "holding"
                    : owned.weapons.includes(k)
                      ? "owned"
                      : { price: WEAPONS[k].price },
              ),
            )}
          {shelf === "vehicles" &&
            VEHICLE_TIERS.map((tier) => (
              <Fragment key={tier}>
                {heading(
                  tier,
                  <>
                    <span className={cn("font-bold tracking-wide uppercase", TIER_TEXT[tier])}>
                      {TIER_NAMES[tier]}
                    </span>
                    <span className="text-white/40">{TIER_NOTES[tier]}</span>
                  </>,
                )}
                {VEHICLE_KINDS.filter((k) => VEHICLES[k].tier === tier).map((k) =>
                  tile(
                    "vehicles",
                    k,
                    VEHICLES[k].name,
                    owned.vehicles.includes(k)
                      ? "owned"
                      : { price: VEHICLES[k].price, short: owned.coins < VEHICLES[k].price },
                  ),
                )}
              </Fragment>
            ))}
          {shelf === "skins" &&
            SKINS.map((s) => tile("skins", s.id, s.name, worn === s.id ? "wearing" : null))}

          {shelf === "land" &&
            (owns ? [owns, ...growTo] : PLOT_SIZE_IDS).map((size) => (
              <Fragment key={size}>
                {heading(
                  size,
                  <>
                    {label(PLOT_SIZES[size].name)}
                    <span className="text-white/40">{PLOT_SIZES[size].size} m across</span>
                  </>,
                  owns === size ? "yours" : coins(landCost(size, owns ?? undefined)),
                )}
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
                      badge={
                        owns === size
                          ? "owned"
                          : {
                              price: landCost(size, owns ?? undefined),
                              short: owned.coins < landCost(size, owns ?? undefined),
                            }
                      }
                      onPick={() => setPlot({ size, shape })}
                      onChoose={() => {
                        if (!mine && game.canBuyLand) props.onPlace(size, shape);
                      }}
                    />
                  </li>
                ))}
              </Fragment>
            ))}

          {shelf === "build" && (
            <>
              <li className="col-span-full flex flex-wrap items-baseline gap-x-4 gap-y-2 pb-1">
                <div role="tablist" aria-label="Build shelves" className="contents">
                  {SHELF_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={bench === id}
                      onClick={() => {
                        setBench(id);
                        setThing(CATALOGUE_IDS.find((k) => CATALOGUE[k].shelf === id) ?? thing);
                      }}
                      className={cn(
                        "rounded-md px-2 py-0.5 font-sans text-[12px] font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/60",
                        bench === id
                          ? "bg-white/[0.1] text-white"
                          : "text-white/45 hover:text-white/75",
                      )}
                    >
                      {BUILD_SHELVES[id]}
                    </button>
                  ))}
                </div>
                <span className="ml-auto font-sans text-[11px] text-white/40 tabular-nums">
                  {build.plot
                    ? `${build.plot.name}: ${build.plot.items} of ${build.plot.cap} things`
                    : "Buy land first: what you build stands on it"}
                </span>
              </li>
              {CATALOGUE_IDS.filter((k) => CATALOGUE[k].shelf === bench).map((k) => (
                <li key={k}>
                  <Tile
                    name={CATALOGUE[k].name}
                    caption
                    portrait={itemArt?.get(k) || null}
                    picked={thing === k}
                    dim={game.buildBlock(k) !== null}
                    badge={{
                      price: CATALOGUE[k].price,
                      short: owned.coins < CATALOGUE[k].price,
                    }}
                    onPick={() => setThing(k)}
                    onChoose={() => placeThing(k)}
                  />
                </li>
              ))}
            </>
          )}

          {shelf === "crew" && (
            <>
              {heading(
                "men",
                label("Your crew"),
                build.plot ? `${crew.men.length} of ${build.plot.crew}` : "no land yet",
              )}
              {crew.men.map((c) => (
                <li key={c.id}>
                  <Tile
                    name={c.name}
                    caption
                    note={c.down ? "Knocked out" : c.weapon ? WEAPONS[c.weapon].name : "Fists"}
                    portrait={art.skins?.get(c.skin) || null}
                    picked={man === c.id}
                    dim={c.down}
                    badge={null}
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
                  onDoubleClick={() => game.hireCrew()}
                  className={cn(
                    "relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-[#1a1a1a] font-sans text-[11px] font-bold text-white/70 transition-[background-color,transform] outline-none hover:-translate-y-px hover:bg-[#222] focus-visible:ring-2 focus-visible:ring-white/60",
                    man === "hire" && "border-solid bg-[#232323] ring-2 ring-white",
                  )}
                >
                  <PlusIcon size={22} weight="bold" />
                  <span className="tabular-nums">Hire · {coins(CREW_PRICE)}</span>
                </button>
              </li>
              {man !== "hire" &&
                (() => {
                  const hand = crew.men.find((c) => c.id === man);
                  if (!hand) return null;
                  return (
                    <>
                      {heading("arm", label(`Arm ${hand.name}`), "he fights as you would with it")}
                      {WEAPON_KINDS.filter((k) => !isThrown(k)).map((k) => (
                        <li key={k}>
                          <Tile
                            name={WEAPONS[k].name}
                            caption
                            portrait={art.weapons?.get(k) || null}
                            picked={kit === k}
                            badge={
                              hand.weapon === k
                                ? "holding"
                                : { price: WEAPONS[k].price, short: owned.coins < WEAPONS[k].price }
                            }
                            onPick={() => setKit(k)}
                            onChoose={() => game.armCrew(hand.id, k)}
                          />
                        </li>
                      ))}
                    </>
                  );
                })()}
            </>
          )}
        </ul>

        {/* What's picked, and what you can do with it. */}
        <footer className="flex items-center gap-4 border-t border-[#242424] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <h3 className="truncate font-sans text-lg leading-none font-extrabold">
                {footer.name}
              </h3>
              {footer.tag}
            </div>
            <div className="line-clamp-2 font-sans text-[12px] leading-snug text-white/65">
              {footer.about}
            </div>
          </div>
          {footer.actions}
        </footer>
      </div>
    </div>
  );
}

/* The buttons along the bottom, for whatever's picked on the weapons, vehicles or skins shelves. */
function Actions(props: {
  shelf: "weapons" | "vehicles" | "skins";
  id: string;
  owned: boolean;
  held: WeaponKind | null;
  worn: SkinId;
  canSpawn: boolean;
  canBuy: boolean;
  coins: number;
  /* This one's purchase is on its way to the room. */
  buying: boolean;
  touch: boolean;
  onPrimary: () => void;
  onPutAway: () => void;
}) {
  const wheel = !props.touch && (
    <span className="hidden items-center gap-1.5 font-sans text-[12px] text-white/60 sm:flex">
      On your wheel <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Q</Kbd>
    </span>
  );
  if (props.shelf === "skins") {
    const wearing = props.worn === props.id;
    return (
      <Button disabled={wearing} onClick={props.onPrimary}>
        {wearing ? "Wearing" : "Wear"}
        {wearing && <CheckIcon size={14} weight="bold" />}
      </Button>
    );
  }
  if (props.shelf === "weapons" && isThrown(props.id as WeaponKind)) {
    const price = WEAPONS[props.id as WeaponKind].price;
    const short = price - props.coins;
    return (
      <div className="flex shrink-0 items-center gap-3">
        {!props.canBuy ? (
          <span className="font-sans text-[12px] text-white/60">Join the islands to buy</span>
        ) : (
          short > 0 && (
            <span className="hidden font-sans text-[12px] text-white/60 sm:inline">
              {coins(short)} short
            </span>
          )
        )}
        <Button
          disabled={!props.canBuy || short > 0}
          onClick={props.onPrimary}
          className="tabular-nums"
        >
          Buy one · {coins(price)}
        </Button>
      </div>
    );
  }
  if (!props.owned && props.shelf === "vehicles") {
    const price = VEHICLES[props.id as VehicleKind].price;
    const short = price - props.coins;
    return (
      <div className="flex shrink-0 items-center gap-3">
        {!props.canBuy ? (
          <span className="font-sans text-[12px] text-white/60">Join the islands to buy</span>
        ) : (
          short > 0 && (
            <span className="hidden font-sans text-[12px] text-white/60 sm:inline">
              {coins(short)} short · earn more at the Guild Board
            </span>
          )
        )}
        <Button
          disabled={!props.canBuy || short > 0 || props.buying}
          onClick={props.onPrimary}
          className="tabular-nums"
        >
          {props.buying ? "Buying…" : `Buy · ${coins(price)}`}
        </Button>
      </div>
    );
  }
  if (!props.owned) {
    return (
      <Button onClick={props.onPrimary}>
        Get it
        <PlusIcon size={13} weight="bold" />
      </Button>
    );
  }
  if (props.shelf === "weapons") {
    const holding = props.held === props.id;
    return (
      <div className="flex shrink-0 items-center gap-3">
        {wheel}
        {holding ? (
          <>
            <Button variant="secondary" onClick={props.onPutAway}>
              Put away
            </Button>
            <Button disabled>
              Holding
              <CheckIcon size={14} weight="bold" />
            </Button>
          </>
        ) : (
          <Button onClick={props.onPrimary}>Hold</Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-3">
      {props.canSpawn ? (
        wheel
      ) : (
        <span className="font-sans text-[12px] text-white/60">Go ashore first</span>
      )}
      <Button disabled={!props.canSpawn} onClick={props.onPrimary}>
        Spawn
      </Button>
    </div>
  );
}

/* Why a button can't be pressed, beside it. */
function Why(props: { children: ReactNode }) {
  return (
    <span className="hidden max-w-[16rem] text-right font-sans text-[12px] text-white/60 sm:inline">
      {props.children}
    </span>
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

/* Buy this plot (and choose where it goes), or grow the one you have. */
function LandAction(props: {
  game: Game;
  mine: IslandInfo | null;
  size: PlotSizeId;
  shape: PlotShapeId;
  coins: number;
  onPlace: (size: PlotSizeId, shape: PlotShapeId) => void;
  onClose: (byClick: boolean) => void;
}) {
  const { game, mine, size } = props;
  const from = mine?.plot?.size;
  const cost = landCost(size, from);
  const short = cost - props.coins;
  if (from === size) return null;
  /* Growing happens where the land stands, so the room round it has to allow it. */
  const room = mine ? game.checkPlot(size, mine.x, mine.z, mine.id) : null;
  const why = !game.canBuyLand
    ? "Go ashore first"
    : short > 0
      ? `${coins(short)} short`
      : room && !room.ok
        ? room.reason
        : null;
  return (
    <div className="flex shrink-0 items-center gap-3">
      {why && <Why>{why}</Why>}
      <Button
        disabled={why !== null}
        className="tabular-nums"
        onClick={() => {
          if (mine) {
            game.growPlot(size);
            props.onClose(true);
          } else props.onPlace(size, props.shape);
        }}
      >
        {mine ? "Grow it" : "Choose a spot"} · {coins(cost)}
      </Button>
    </div>
  );
}

/* ---------- build ---------- */

/* What a ready-made thing is: what it's made of, how much it takes, and how big it is. */
function ThingAbout(props: { kind: CatalogueId; build: BuildView }) {
  const d = CATALOGUE[props.kind];
  const wood = d.material === "wood";
  return (
    <>
      <span
        className={cn(
          "mr-1.5 inline-flex items-center gap-1 rounded-full px-1.5 align-[-1px] text-[11px] font-bold",
          wood ? "bg-[#f2665e]/20 text-[#ffb3ad]" : "bg-white/10 text-white/80",
        )}
      >
        {wood ? <FireIcon size={11} weight="fill" /> : <MountainsIcon size={11} weight="fill" />}
        {wood ? "Wood · burns" : "Stone · won't burn"}
      </span>
      {d.health.toLocaleString("en")} health · {(d.hx * 2).toFixed(1)} × {(d.hz * 2).toFixed(1)} m
      {d.wall && " · snaps end to end"}
      {d.post && " · snaps onto wall ends"} · {d.note}
    </>
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
    <div className="flex shrink-0 items-center gap-3">
      {CREATIVE && props.build.ashore && (
        <Button variant="menu" size="inline" onClick={() => props.game.devCoins()}>
          +10,000 (dev)
          <CoinsIcon size={13} weight="fill" />
        </Button>
      )}
      {why && <Why>{why}</Why>}
      <Button
        disabled={why !== null}
        className="tabular-nums"
        onClick={() => props.onPlace(props.kind)}
      >
        Buy & place · {coins(CATALOGUE[props.kind].price)}
      </Button>
    </div>
  );
}

/* ---------- crew ---------- */

const ORDER_NOTE = {
  home: "At home, keeping to their posts",
  follow: "Following you",
  hold: "Holding where you told them",
} as const;

/* A man: what he carries and how he is; or, hiring, what a man does. */
function CrewAbout(props: { hand: CrewView | null; order: keyof typeof ORDER_NOTE }) {
  const h = props.hand;
  if (!h)
    return (
      <>
        He lives on your land and keeps a post there, and fights off raiders whether you're home or
        not. G calls your crew to follow you, aboard and ashore; H has them hold where you stand.
        Never killed: knocked out, he wakes at your Hearth.
      </>
    );
  if (h.down) return <>Knocked out. He'll come to at your Hearth before long.</>;
  return (
    <>
      {ORDER_NOTE[props.order]} · carries {h.weapon ? WEAPONS[h.weapon].name : "his fists"}. He
      fights with whatever you give him, as you would with it: a bow, he shoots.
    </>
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
  coins: number;
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
            : props.coins < CREW_PRICE
              ? `${coins(CREW_PRICE - props.coins)} short`
              : null;
    return (
      <div className="flex shrink-0 items-center gap-3">
        {why && <Why>{why}</Why>}
        <Button disabled={why !== null} className="tabular-nums" onClick={() => game.hireCrew()}>
          Hire · {coins(CREW_PRICE)}
        </Button>
      </div>
    );
  }
  const price = kit ? WEAPONS[kit].price : 0;
  const has = hand.weapon === kit;
  const short = price - props.coins;
  return (
    <div className="flex shrink-0 items-center gap-3">
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
        {letGo === hand.id ? "Again to let him go" : "Dismiss"}
      </Button>
      {short > 0 && !has && <Why>{coins(short)} short</Why>}
      <Button
        disabled={has || short > 0}
        className="tabular-nums"
        onClick={() => game.armCrew(hand.id, kit)}
      >
        {has ? "Carrying it" : kit ? `Arm him · ${coins(price)}` : "Take his weapon"}
        {has && <CheckIcon size={14} weight="bold" />}
      </Button>
    </div>
  );
}

/* ---------- shared ---------- */

/* Tier colours: plain for free, warm for cheap, rich for premium. */
const TIER_TEXT: Record<VehicleTier, string> = {
  free: "text-[#7fd6cc]",
  cheap: "text-[#f2b35e]",
  premium: "text-[#c9a0ff]",
};

/* A vehicle's tier, and its price until it's yours. */
function VehiclePrice(props: { kind: VehicleKind; owned: boolean }) {
  const d = VEHICLES[props.kind];
  return (
    <span className="flex shrink-0 items-baseline gap-2 font-sans text-[12px] tabular-nums">
      <span className={cn("font-bold", TIER_TEXT[d.tier])}>{TIER_NAMES[d.tier]}</span>
      {d.tier !== "free" && (
        <span className={props.owned ? "text-white/45" : "font-bold text-white/85"}>
          {props.owned ? "Bought" : coins(d.price)}
        </span>
      )}
    </span>
  );
}

function Price(props: { price: number }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 font-sans text-[12px] tabular-nums">
      {props.price > 0 && <span className="text-white/45 line-through">◎ {props.price}</span>}
      <span className="font-bold text-[#7fd6cc]">Free</span>
    </span>
  );
}

/* `short`: more than you've got. */
type TileBadge = "owned" | "holding" | "wearing" | { price: number; short?: boolean } | null;

/* One thing on the shelf: click to pick it, double-click to get it (or use it). */
function Tile(props: {
  name: string;
  /* Print the name on the tile: weapons look alike at a glance, skins don't. */
  caption: boolean;
  /* A word under the name (a crewman's weapon). */
  note?: string;
  /* Greyed: it can't be had (or used) right now. */
  dim?: boolean;
  portrait: string | null;
  picked: boolean;
  badge: TileBadge;
  onPick: () => void;
  onChoose: () => void;
}) {
  const b = props.badge;
  const forSale = typeof b === "object" && b !== null;
  return (
    <button
      type="button"
      aria-pressed={props.picked}
      aria-label={typeof b === "string" ? `${props.name}, ${b}` : props.name}
      title={props.name}
      onClick={props.onPick}
      onDoubleClick={props.onChoose}
      className={cn(
        "relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-[#1a1a1a] transition-[background-color,transform] outline-none hover:-translate-y-px hover:bg-[#222] focus-visible:ring-2 focus-visible:ring-white/60",
        props.picked && "bg-[#232323] ring-2 ring-white",
      )}
    >
      {props.portrait ? (
        <img
          src={props.portrait}
          alt=""
          draggable={false}
          className={cn(
            "absolute inset-0 h-full w-full object-contain transition-opacity",
            forSale && !props.picked && "opacity-70",
            props.dim && "opacity-45 grayscale-[60%]",
          )}
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      )}
      {props.caption && (
        <span className="absolute inset-x-2 bottom-2 flex flex-col text-left font-sans text-[11px] font-bold text-white/75">
          <span className="truncate">{props.name}</span>
          {props.note && <span className="truncate font-normal text-white/55">{props.note}</span>}
        </span>
      )}
      {forSale && (
        <span
          className={cn(
            "absolute top-2 right-2 rounded-md bg-black/55 px-1.5 py-0.5 font-sans text-[10px] font-bold tabular-nums",
            b.short ? "text-white/45" : "text-white/85",
          )}
        >
          {coins(b.price)}
        </span>
      )}
      {(b === "owned" || b === "holding" || b === "wearing") && (
        <span
          className={cn(
            "absolute top-2 right-2 grid size-5 place-items-center rounded-full",
            b === "owned" ? "bg-white/90 text-black" : "bg-[#f2665e] text-white",
          )}
        >
          <CheckIcon size={11} weight="bold" />
        </span>
      )}
    </button>
  );
}
