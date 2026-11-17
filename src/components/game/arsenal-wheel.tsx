import { HandFistIcon, PlusIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Kbd } from "@/components/ui/kbd";
import { getArsenal, subscribeArsenal } from "../../game/client/arsenal";
import type { Game } from "../../game/client/game";
import { VEHICLES, type VehicleKind } from "../../game/shared/vehicles";
import { gripOf, WEAPONS, type WeaponKind } from "../../game/shared/weapons";
import { HELD, topSpeed } from "./marketplace";

/*
 * The Arsenal wheel: everything you own, a flick away. Hold Q and the mouse
 * comes free; put it on a slice and let go. Weapons ring the middle,
 * vehicles the outside; the + on each ring goes to the marketplace for more.
 *
 * A quick tap of Q leaves it up instead: click a slice (or press Q over one).
 * On a phone it opens from its button and slices are tapped.
 */

export type ArsenalPick =
  | { t: "weapon"; kind: WeaponKind | null }
  | { t: "vehicle"; kind: VehicleKind }
  | { t: "market"; shelf: "weapons" | "vehicles" };

type Slice = { key: string; pick: ArsenalPick; name: string };

/* The wheel's drawing space: a 400-unit square, centred. */
const SIZE = 400;
const C = SIZE / 2;
const HUB = 66;
const INNER: [number, number] = [72, 132];
const OUTER: [number, number] = [138, 198];
/* A tap of Q shorter than this, off every slice, leaves the wheel up. */
const TAP_MS = 220;

const point = (r: number, a: number): [number, number] => [
  C + r * Math.cos(a),
  C + r * Math.sin(a),
];

/* One slice of a ring, from angle a0 to a1, with a little gap either side. */
function slicePath(r0: number, r1: number, a0: number, a1: number) {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    /* The whole ring: two half circles, with the hole cut out. */
    return `M${C - r1} ${C}A${r1} ${r1} 0 1 1 ${C + r1} ${C}A${r1} ${r1} 0 1 1 ${C - r1} ${C}Z
      M${C - r0} ${C}A${r0} ${r0} 0 1 0 ${C + r0} ${C}A${r0} ${r0} 0 1 0 ${C - r0} ${C}Z`;
  }
  const gap = 0.018;
  const b0 = a0 + gap;
  const b1 = a1 - gap;
  const large = b1 - b0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(r1, b0);
  const [x1, y1] = point(r1, b1);
  const [x2, y2] = point(r0, b1);
  const [x3, y3] = point(r0, b0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/* Slices start at the top and go clockwise; the first is centred on twelve o'clock. */
function angles(i: number, n: number) {
  const step = (Math.PI * 2) / n;
  const a0 = -Math.PI / 2 - step / 2 + i * step;
  return [a0, a0 + step] as const;
}

export function ArsenalWheel(props: {
  game: Game;
  touch: boolean;
  /* Weapons, then vehicles; the marketplace link closes it and opens the market. */
  onPick: (pick: ArsenalPick) => void;
  /* Put away without picking anything. */
  onClose: () => void;
}) {
  const { game, touch, onPick, onClose } = props;
  const owned = useSyncExternalStore(subscribeArsenal, getArsenal);
  const [held] = useState<WeaponKind | null>(() => game.armedWith);
  const canSpawn = game.canSpawn;
  const [hovered, setHovered] = useState<string | null>(null);
  const [art, setArt] = useState<Map<string, string>>(() => new Map());

  const inner: Slice[] = [
    { key: "w:", pick: { t: "weapon", kind: null }, name: "Fists" },
    ...owned.weapons.map((k) => ({
      key: `w:${k}`,
      pick: { t: "weapon", kind: k } as ArsenalPick,
      name: WEAPONS[k].name,
    })),
    { key: "+w", pick: { t: "market", shelf: "weapons" }, name: "More weapons" },
  ];
  const outer: Slice[] = [
    ...owned.vehicles.map((k) => ({
      key: `v:${k}`,
      pick: { t: "vehicle", kind: k } as ArsenalPick,
      name: VEHICLES[k].name,
    })),
    { key: "+v", pick: { t: "market", shelf: "vehicles" }, name: "More vehicles" },
  ];

  const current = hovered;

  const latest = useRef({ current, inner, outer, onPick, onClose });
  latest.current = { current, inner, outer, onPick, onClose };

  const choose = (key: string | null) => {
    const { inner, outer, onPick, onClose } = latest.current;
    const slice = [...inner, ...outer].find((s) => s.key === key);
    if (!slice) return onClose();
    if (slice.pick.t === "vehicle" && !game.canSpawn) return;
    onPick(slice.pick);
  };

  /* The pictures: drawn once for the marketplace and kept, so usually already there. */
  const weaponKey = owned.weapons.join();
  const vehicleKey = owned.vehicles.join();
  useEffect(() => {
    let gone = false;
    void import("../../game/client/scene/showcase").then(async (mod) => {
      const [w, v] = await Promise.all([
        mod.weaponPortraitsOf(getArsenal().weapons),
        mod.vehiclePortraitsOf(getArsenal().vehicles),
      ]);
      if (gone) return;
      const next = new Map<string, string>();
      for (const [k, url] of w) next.set(`w:${k}`, url);
      for (const [k, url] of v) if (url) next.set(`v:${k}`, url);
      setArt(next);
    });
    return () => {
      gone = true;
    };
  }, [weaponKey, vehicleKey]);

  /*
   * Desktop: the mouse comes free while the wheel is up (the game takes it
   * back once it's put away). Q let go over a slice picks it; a quick tap off
   * every slice leaves the wheel up, for a click or Q again; Escape cancels.
   */
  useEffect(() => {
    if (touch) return;
    game.input.unlock();
    const opened = performance.now();
    let sticky = false;
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ" || sticky) return;
      const over = latest.current.current;
      if (!over && performance.now() - opened < TAP_MS) {
        sticky = true;
        return;
      }
      choose(over);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        latest.current.onClose();
      }
      if (e.code === "KeyQ" && sticky && !e.repeat) choose(latest.current.current);
    };
    window.addEventListener("keyup", onUp);
    window.addEventListener("keydown", onDown);
    return () => {
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("keydown", onDown);
    };
  }, [game, touch]);

  const shown = [...inner, ...outer].find((s) => s.key === current);

  const ring = (slices: Slice[], [r0, r1]: [number, number], vehicles: boolean) =>
    slices.map((s, i) => {
      const [a0, a1] = angles(i, slices.length);
      const mid = slices.length === 1 ? -Math.PI / 2 : (a0 + a1) / 2;
      const [cx, cy] = point((r0 + r1) / 2, mid);
      const add = s.pick.t === "market";
      const isHeld = s.pick.t === "weapon" && s.pick.kind === held;
      const off = s.pick.t === "vehicle" && !canSpawn;
      const lit = s.key === current;
      const pic = art.get(s.key);
      const box = vehicles ? 64 : 58;
      return (
        <g
          key={s.key}
          role="button"
          tabIndex={-1}
          aria-label={s.name}
          className={cn("cursor-pointer outline-none", off && "opacity-40")}
          onPointerEnter={() => setHovered(s.key)}
          onPointerLeave={() => setHovered((h) => (h === s.key ? null : h))}
          onClick={() => choose(s.key)}
        >
          <path
            d={slicePath(r0, r1, a0, a1)}
            fillRule="evenodd"
            className={cn(
              "transition-[fill,stroke] duration-150",
              add
                ? "fill-white/[0.04] stroke-white/30 [stroke-dasharray:4_5]"
                : vehicles
                  ? lit
                    ? "fill-[#24423f]"
                    : "fill-[#132120]/90"
                  : lit
                    ? "fill-[#383838]"
                    : "fill-[#191919]/90",
              lit && add && "fill-white/10 stroke-white/60",
              isHeld && "stroke-[#f2665e] [stroke-width:2.5]",
            )}
          />
          {add ? (
            <PlusIcon
              x={cx - 11}
              y={cy - 11}
              size={22}
              weight="bold"
              className={lit ? "text-white" : "text-white/40"}
            />
          ) : s.key === "w:" ? (
            <HandFistIcon
              x={cx - 15}
              y={cy - 15}
              size={30}
              weight="fill"
              className={lit ? "text-white" : "text-white/75"}
            />
          ) : pic ? (
            <image
              href={pic}
              x={cx - box / 2}
              y={cy - box / 2 - (vehicles ? 0 : 3)}
              width={box}
              height={box * 1.25}
              preserveAspectRatio="xMidYMin meet"
              className={cn("transition-transform duration-150", lit && "scale-110")}
              style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}
            />
          ) : (
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              className="fill-white/70 font-sans text-[10px] font-bold"
            >
              {s.name}
            </text>
          )}
        </g>
      );
    });

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Arsenal"
        className="relative size-[min(26rem,78vmin)] duration-200 animate-in fade-in-0 zoom-in-95"
      >
        {/* A frosted disc behind the rings, so the island doesn't show through the words. */}
        <div className="pointer-events-none absolute inset-[0.5%] rounded-full border border-white/10 bg-black/70 backdrop-blur-md" />
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="relative size-full overflow-visible">
          <title>Arsenal</title>
          {ring(inner, INNER, false)}
          {ring(outer, OUTER, true)}
        </svg>
        <div className="pointer-events-none absolute top-1/2 left-1/2 flex w-[30%] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
          <Hub slice={shown} held={held} canSpawn={canSpawn} />
        </div>
        <div className="pointer-events-none absolute inset-x-0 -bottom-9 flex items-center justify-center gap-1.5 font-sans text-xs text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
          {touch ? (
            "Tap one to take it"
          ) : (
            <>
              Hover one, then let go of <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Q</Kbd>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* The middle of the wheel: what's pointed at, or what's in hand. */
function Hub(props: { slice: Slice | undefined; held: WeaponKind | null; canSpawn: boolean }) {
  const pick = props.slice?.pick;
  const title = (text: string) => (
    <div className="font-sans text-[15px] leading-tight font-extrabold">{text}</div>
  );
  const line = (text: string) => (
    <div className="font-sans text-[11px] leading-snug text-white/70">{text}</div>
  );
  if (!pick) {
    const held = props.held;
    return (
      <>
        <div className="font-sans text-[10px] font-bold tracking-[0.12em] text-white/50 uppercase">
          In hand
        </div>
        {title(held ? WEAPONS[held].name : "Fists")}
      </>
    );
  }
  if (pick.t === "market") {
    return (
      <>
        {title(props.slice?.name ?? "")}
        {line("In the Marketplace")}
      </>
    );
  }
  if (pick.t === "weapon") {
    const d = pick.kind ? WEAPONS[pick.kind] : null;
    return (
      <>
        {title(d ? d.name : "Fists")}
        {line(
          d
            ? `${HELD[gripOf(pick.kind)]} · ${d.charged ? `${d.damage}–${d.charged}` : d.damage} dmg`
            : "Bare hands",
        )}
        {pick.kind === props.held && line("In hand")}
      </>
    );
  }
  const v = VEHICLES[pick.kind];
  return (
    <>
      {title(v.name)}
      {line(props.canSpawn ? topSpeed(pick.kind) : "Go ashore to spawn it")}
    </>
  );
}
