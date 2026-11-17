import { CheckIcon, MapPinIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Game } from "../../game/client/game";
import { drawGhost, drawMap, fitFrame, type MapFrame, toWorld } from "../../game/client/map";
import { PLOT_SHAPES, type PlotShapeId, plotReach } from "../../game/shared/islands";
import { PLOT_GAP, PLOT_SIZES, type PlotSizeId, type SpotCheck } from "../../game/shared/plots";

/* Room left clear round the map for the bars above and below it. */
const INSET = { top: 72, bottom: 104, side: 16 };

/*
 * Choosing where a plot goes: the grand map, with the plot's outline under
 * the pointer, green where it fits and red (and why) where it doesn't. A
 * click buys it there; on a phone a tap moves it and the button buys it.
 * Escape, or Cancel, puts it back on the shelf.
 */
export function PlotPlacer(props: {
  game: Game;
  touch: boolean;
  size: PlotSizeId;
  shape: PlotShapeId;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
}) {
  const { game, size, shape, onClose } = props;
  const def = PLOT_SIZES[size];
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<MapFrame>({ ox: 0, oy: 0, size: 1 });
  const [spot, setSpot] = useState<{ x: number; z: number } | null>(null);
  const [check, setCheck] = useState<SpotCheck | null>(null);
  /* The draw loop reads the latest without restarting. */
  const latest = useRef({ spot, check });
  latest.current = { spot, check };

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      frame.current = fitFrame(w, h, INSET);
      drawMap(ctx, frame.current, game.mapView(), dpr);
      const { spot: at, check: ok } = latest.current;
      if (at)
        drawGhost(ctx, frame.current, {
          ...at,
          size: def.size,
          reach: plotReach(def.size),
          gap: PLOT_GAP,
          ok: !!ok?.ok,
        });
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [game, def.size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Escape") return;
      e.preventDefault();
      onClose(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Move the outline to a point on the canvas, and ask whether it fits there. */
  const aim = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = toWorld(frame.current, e.clientX - r.left, e.clientY - r.top);
    const at = { x: Math.round(w.x), z: Math.round(w.z) };
    setSpot(at);
    const next = game.checkPlot(size, at.x, at.z);
    setCheck(next);
    return { at, next };
  };

  const buy = (at: { x: number; z: number } | null, ok: SpotCheck | null) => {
    if (!at || !ok?.ok) return;
    game.buyPlot(size, shape, at.x, at.z);
    onClose(true);
  };

  const ready = !!spot && !!check?.ok;
  const status = !spot
    ? props.touch
      ? "Tap open sea to set it down"
      : "Point at open sea to set it down"
    : check?.ok
      ? props.touch
        ? "Clear water here"
        : "Clear water here · click to buy"
      : (check?.reason ?? "");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="placer-title"
      className="absolute inset-0 z-40 bg-black text-white select-none"
    >
      <canvas
        ref={canvas}
        aria-label="The grand map: choose where your land goes"
        className={cn(
          "block h-full w-full touch-none",
          ready ? "cursor-pointer" : "cursor-crosshair",
        )}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || e.buttons) aim(e);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") aim(e);
        }}
        onClick={(e) => {
          /* A click buys at once; a tap only moves the outline, and the button buys. */
          if (props.touch) return;
          const { at, next } = aim(e);
          buy(at, next);
        }}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-6 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id="placer-title" className="font-sans text-2xl leading-none font-extrabold">
            Where should your {def.name.toLowerCase()} go?
          </h2>
          <p className="font-sans text-[13px] leading-snug text-white/80">
            {PLOT_SHAPES[shape].name}, {def.size} m across. It needs {PLOT_GAP} m of open sea to
            every other island.
          </p>
        </div>
        <Button
          variant="menu"
          size="inline"
          className="pointer-events-auto"
          onClick={() => onClose(true)}
        >
          Cancel
          {!props.touch && <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Esc</Kbd>}
        </Button>
      </header>

      <footer className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex min-w-0 items-center gap-2 font-sans text-sm font-bold">
          <MapPinIcon
            size={16}
            weight="fill"
            className={cn(!spot ? "text-white/70" : ready ? "text-[#7ee2a1]" : "text-[#ff7a6e]")}
          />
          <span className={cn("truncate", !spot ? "text-white/80" : "text-white")}>{status}</span>
        </div>
        <Button disabled={!ready} onClick={() => buy(spot, check)}>
          Buy here · ◎ {def.price.toLocaleString("en-US")}
          {ready && <CheckIcon size={14} weight="bold" />}
        </Button>
      </footer>
    </div>
  );
}
