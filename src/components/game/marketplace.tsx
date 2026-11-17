import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { getArsenal, getWeapon, subscribeArsenal } from "../../game/client/arsenal";
import type { Game } from "../../game/client/game";
import { SKINS, type SkinId, skinDef } from "../../game/shared/skins";
import {
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
  WEAPON_KINDS,
  WEAPONS,
  type WeaponKind,
} from "../../game/shared/weapons";

export type Shelf = "weapons" | "vehicles" | "skins";

const SHELVES: readonly [Shelf, string][] = [
  ["weapons", "Weapons"],
  ["vehicles", "Vehicles"],
  ["skins", "Skins"],
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

/* One short line about a thing on the shelf. */
function summary(shelf: Shelf, id: string) {
  if (shelf === "weapons") {
    const kind = id as WeaponKind;
    const d = WEAPONS[kind];
    const damage = d.charged ? `${d.damage}–${d.charged}` : `${d.damage}`;
    return `${HELD[gripOf(kind)]} · ${damage} ${d.guard ? "bash" : "damage"} · ${d.reach} m reach · ${pace(d.cooldown)}`;
  }
  if (shelf === "vehicles") {
    const kind = id as VehicleKind;
    const seats = VEHICLES[kind].seats.length;
    return `${topSpeed(kind)} · ${seats} ${seats === 1 ? "seat" : "seats"} · ${VEHICLES[kind].blurb}`;
  }
  return "Everyone sees you in it, out on the islands.";
}

/*
 * The marketplace: where weapons and vehicles are got (once, and kept on your
 * Arsenal wheel, Q) and skins are worn. A pop-up over the island, three
 * shelves of pictures; pick one and the bar along the bottom says what it is
 * and what you can do with it.
 *
 * Vehicles cost coins from the Guild Board, by tier: the free ones are
 * everyone's, the rest are bought once and kept. The room does the selling
 * (and says what's short); your purse sits in the header. Weapons and skins
 * are still free; their prices show what they'll cost once those take coins too.
 */
export function Marketplace(props: {
  game: Game;
  touch: boolean;
  /* The shelf it opens on. */
  shelf?: Shelf;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
}) {
  const { game, onClose } = props;
  const owned = useSyncExternalStore(subscribeArsenal, getArsenal);
  const [shelf, setShelf] = useState<Shelf>(props.shelf ?? "weapons");
  /* A purchase on its way to the room: its button waits until the room answers. */
  const [buying, setBuying] = useState<VehicleKind | null>(null);
  const [worn, setWorn] = useState<SkinId>(() => game.skin);
  const [held, setHeld] = useState<WeaponKind | null>(() => game.armedWith);
  const [picked, setPicked] = useState<Record<Shelf, string>>(() => ({
    weapons: game.armedWith ?? WEAPON_KINDS[0],
    vehicles: VEHICLE_KINDS[0],
    skins: game.skin,
  }));
  const [art, setArt] = useState<Record<Shelf, Map<string, string> | null>>({
    weapons: null,
    vehicles: null,
    skins: null,
  });

  /* Portraits share three.js with the game; each is drawn once and kept. */
  useEffect(() => {
    let gone = false;
    void import("../../game/client/scene/showcase").then((mod) => {
      const keep = (s: Shelf) => (m: Map<string, string>) => {
        if (!gone) setArt((a) => ({ ...a, [s]: m }));
      };
      void mod.weaponPortraitsOf(WEAPON_KINDS).then(keep("weapons"));
      void mod.vehiclePortraitsOf(VEHICLE_KINDS).then(keep("vehicles"));
      void mod.portraitsOf(SKINS.map((s) => s.id)).then(keep("skins"));
    });
    return () => {
      gone = true;
    };
  }, []);

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

  const id = picked[shelf];
  const pick = (next: string) => setPicked((p) => ({ ...p, [shelf]: next }));
  const ownsIt =
    shelf === "weapons"
      ? owned.weapons.includes(id as WeaponKind)
      : shelf === "vehicles"
        ? owned.vehicles.includes(id as VehicleKind)
        : true;
  const name =
    shelf === "weapons"
      ? WEAPONS[id as WeaponKind].name
      : shelf === "vehicles"
        ? VEHICLES[id as VehicleKind].name
        : skinDef(id as SkinId).name;
  const price =
    shelf === "weapons"
      ? WEAPONS[id as WeaponKind].price
      : shelf === "vehicles"
        ? VEHICLES[id as VehicleKind].price
        : skinDef(id as SkinId).price;

  /*
   * Double-click (or the bar's first button): get it, or use it if it's yours.
   * Coins are only spent from the button, never by a double-click.
   */
  const primary = (target: string, byButton = false) => {
    if (shelf === "skins") return wear(target as SkinId);
    if (shelf === "weapons") {
      const kind = target as WeaponKind;
      if (!owned.weapons.includes(kind)) getWeapon(kind);
      else hold(kind);
      return;
    }
    const kind = target as VehicleKind;
    if (owned.vehicles.includes(kind)) spawn(kind);
    else if (byButton) buy(kind);
  };

  const tile = (key: string, label: string, badge: TileBadge) => (
    <li key={key}>
      <Tile
        name={label}
        portrait={art[shelf]?.get(key) || null}
        caption={shelf !== "skins"}
        picked={id === key}
        badge={badge}
        onPick={() => pick(key)}
        onChoose={() => primary(key)}
      />
    </li>
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
          <h2 id="market-title" className="font-sans text-xl leading-none font-extrabold">
            Marketplace
          </h2>
          <div role="tablist" aria-label="Shelves" className="flex items-center gap-4 sm:gap-5">
            {SHELVES.map(([s, label]) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={shelf === s}
                onClick={() => setShelf(s)}
                className={cn(
                  "border-b-2 py-1 font-sans text-sm font-extrabold transition-colors outline-none focus-visible:text-white",
                  shelf === s
                    ? "border-[#f2665e] text-white"
                    : "border-transparent text-white/45 hover:text-white/75",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <span
            className="flex items-center rounded-md bg-white/[0.06] px-2.5 py-1 font-sans text-[13px] font-bold tabular-nums"
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
                k,
                WEAPONS[k].name,
                held === k
                  ? "holding"
                  : owned.weapons.includes(k)
                    ? "owned"
                    : { price: WEAPONS[k].price },
              ),
            )}
          {shelf === "vehicles" &&
            VEHICLE_TIERS.map((tier) => (
              <Fragment key={tier}>
                <li className="col-span-full flex items-baseline gap-2.5 pt-3 pb-0.5 first:pt-0">
                  <span
                    className={cn(
                      "font-sans text-[11px] font-bold tracking-wide uppercase",
                      TIER_TEXT[tier],
                    )}
                  >
                    {TIER_NAMES[tier]}
                  </span>
                  <span className="font-sans text-[11px] text-white/40">{TIER_NOTES[tier]}</span>
                </li>
                {VEHICLE_KINDS.filter((k) => VEHICLES[k].tier === tier).map((k) =>
                  tile(
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
            SKINS.map((s) => tile(s.id, s.name, worn === s.id ? "wearing" : null))}
        </ul>

        {/* What's picked, and what you can do with it. */}
        <footer className="flex items-center gap-4 border-t border-[#242424] px-4 py-3 sm:px-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <h3 className="truncate font-sans text-lg leading-none font-extrabold">{name}</h3>
              {shelf === "vehicles" ? (
                <VehiclePrice kind={id as VehicleKind} owned={ownsIt} />
              ) : (
                !ownsIt && <Price price={price} />
              )}
            </div>
            <p className="truncate font-sans text-[12px] leading-snug text-white/65">
              {summary(shelf, id)}
            </p>
          </div>
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
        </footer>
      </div>
    </div>
  );
}

/* The buttons along the bottom, for whatever's picked. */
function Actions(props: {
  shelf: Shelf;
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
          )}
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      )}
      {props.caption && (
        <span className="absolute inset-x-2 bottom-2 truncate text-left font-sans text-[11px] font-bold text-white/75">
          {props.name}
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
