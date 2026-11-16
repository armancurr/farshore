import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Game } from "../../game/client/game";
import type { Showcase } from "../../game/client/scene/showcase";
import { SKINS, type SkinId, skinDef } from "../../game/shared/skins";
import { WEAPON_KINDS, WEAPONS, type WeaponDef, type WeaponKind } from "../../game/shared/weapons";

type Tab = "skins" | "weapons";

/*
 * The marketplace: whatever you're looking at stands large on the left; the
 * right is everything on offer. Two shelves: skins (one row per character)
 * and weapons (you carry one at a time). Everything is free for now; prices
 * show what each will cost once the market takes coins.
 */
export function Marketplace(props: {
  game: Game;
  touch: boolean;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>("skins");
  const [worn, setWorn] = useState<SkinId>(() => props.game.skin);
  const [picked, setPicked] = useState<SkinId>(worn);
  const [held, setHeld] = useState<WeaponKind | null>(() => props.game.armedWith);
  const [eyed, setEyed] = useState<WeaponKind>(() => held ?? WEAPON_KINDS[0]);
  const [portraits, setPortraits] = useState<Map<SkinId, string> | null>(null);
  const [weaponPortraits, setWeaponPortraits] = useState<Map<WeaponKind, string> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const showcase = useRef<Showcase | null>(null);
  const drag = useRef<number | null>(null);
  const latest = useRef({ tab, picked, eyed });
  latest.current = { tab, picked, eyed };
  const { onClose } = props;

  /* The preview and the grid's portraits share three.js with the game. */
  useEffect(() => {
    let disposed = false;
    void import("../../game/client/scene/showcase").then((mod) => {
      if (disposed || !canvas.current) return;
      showcase.current = new mod.Showcase(canvas.current);
      const now = latest.current;
      if (now.tab === "skins") showcase.current.show(now.picked);
      else showcase.current.showWeapon(now.eyed);
      setPortraits(mod.portraitsOf(SKINS.map((s) => s.id)));
      setWeaponPortraits(mod.weaponPortraitsOf(WEAPON_KINDS));
    });
    return () => {
      disposed = true;
      showcase.current?.dispose();
      showcase.current = null;
    };
  }, []);

  useEffect(() => {
    if (tab === "skins") showcase.current?.show(picked);
    else showcase.current?.showWeapon(eyed);
  }, [tab, picked, eyed]);

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

  const skin = skinDef(picked);
  const weapon = WEAPONS[eyed];
  const wearing = picked === worn;
  const holding = eyed === held;
  const name = tab === "skins" ? skin.name : weapon.name;

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
            {(["skins", "weapons"] as const).map((t) => (
              <Button
                key={t}
                role="tab"
                aria-selected={tab === t}
                variant="menu"
                size="inline"
                onClick={() => setTab(t)}
                className={cn(
                  "transition-colors",
                  tab === t ? "text-white" : "text-white/40 hover:text-white/70",
                )}
              >
                {t === "skins" ? "Skins" : "Weapons"}
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
            className="block min-h-0 w-full flex-1 cursor-grab touch-pan-y active:cursor-grabbing"
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
          <div className="flex items-end justify-between gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="truncate font-sans text-3xl leading-none font-extrabold">{name}</h3>
              {tab === "weapons" && <WeaponStats def={weapon} />}
              <Price price={tab === "skins" ? skin.price : weapon.price} />
            </div>
            {tab === "skins" ? (
              <Button disabled={wearing} onClick={() => wear(picked)}>
                {wearing ? "Wearing" : "Wear"}
                {wearing && <CheckIcon size={14} weight="bold" />}
              </Button>
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

        {/* Everything on the shelf: skins one row per character, weapons light to heavy. */}
        <ul className="grid shrink-0 grid-cols-3 content-start gap-2 px-5 pb-5 sm:px-6 sm:pb-6 @3xl:w-[min(30rem,44%)] @3xl:overflow-y-auto @3xl:pt-1 @3xl:pl-1">
          {tab === "skins"
            ? SKINS.map((s) => (
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
            : WEAPON_KINDS.map((k) => (
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
              ))}
        </ul>
      </div>
    </div>
  );
}

function Price(props: { price: number }) {
  return (
    <div className="flex items-baseline gap-2 font-sans text-sm tabular-nums">
      {props.price > 0 && <span className="text-white/35 line-through">◎ {props.price}</span>}
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

/* What a weapon does: damage, reach and pace, then what makes it different. */
function WeaponStats(props: { def: WeaponDef }) {
  const d = props.def;
  const damage = d.charged ? `${d.damage}–${d.charged}` : `${d.damage}`;
  const special = d.hint.split(" · ").slice(1).join(" · ");
  return (
    <div className="flex flex-col gap-1.5">
      <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-sans text-sm tabular-nums">
        <Stat label="Damage" value={damage} />
        <Stat label="Reach" value={`${d.reach} m`} />
        <Stat label="Pace" value={pace(d.cooldown)} />
      </dl>
      {special && (
        <p className="max-w-[22rem] font-sans text-[13px] leading-snug text-white/55">
          {special.charAt(0).toUpperCase() + special.slice(1)}
        </p>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-white/40">{props.label}</dt>
      <dd className="font-bold text-white">{props.value}</dd>
    </div>
  );
}

/* One thing on offer: click to look at it, double-click to wear or hold it. */
function Tile(props: {
  name: string;
  /* Print the name on the tile: weapons look alike at a glance, skins don't. */
  caption?: boolean;
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
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <span className="absolute inset-0 animate-pulse bg-white/[0.03]" />
      )}
      {props.caption && (
        <span className="absolute inset-x-2 bottom-2 truncate text-left font-sans text-[11px] font-bold text-white/70">
          {props.name}
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
