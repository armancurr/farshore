import { cn } from "cn";
import { useEffect, useRef } from "react";
import type { Game } from "../../game/client/game";
import { drawMap, fitFrame, type Ghost, type MapFrame, toWorld } from "../../game/client/map";
import { PLACE_LIMIT, placementProblem } from "../../game/shared/islands";

export type Placing = {
  image: HTMLCanvasElement;
  /* Where you've chosen so far, if anywhere. */
  picked: { x: number; z: number } | null;
  onPick: (x: number, z: number) => void;
};

const clampToMap = (v: number) => Math.max(-PLACE_LIMIT, Math.min(PLACE_LIMIT, v));

/*
 * The grand map, drawn live from the game every frame: islands appear the
 * moment someone settles, and everyone's position moves as they do. With
 * `placing`, the island you're about to settle follows the pointer and a
 * click picks its spot.
 */
export function GrandMap(props: {
  game: Game;
  placing?: Placing;
  /* Room to leave clear for the HUD at the top, bottom and sides, in CSS pixels. */
  inset?: { top: number; bottom: number; side: number };
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hover = useRef<{ x: number; z: number } | null>(null);
  const frame = useRef<MapFrame>({ ox: 0, oy: 0, size: 1 });
  /* The render loop reads the latest props without restarting. */
  const latest = useRef(props);
  latest.current = props;

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
      const { game, placing, inset } = latest.current;
      frame.current = fitFrame(w, h, inset ?? { top: 0, bottom: 0, side: 0 });
      const view = game.mapView();
      const ghosts: Ghost[] = [];
      if (placing) {
        const taken = view.islands.map((o) => o.info);
        const ghost = (at: { x: number; z: number }, faint: boolean) =>
          ghosts.push({
            ...at,
            image: placing.image,
            ok: !placementProblem(taken, at.x, at.z),
            faint,
          });
        if (placing.picked) ghost(placing.picked, false);
        const under = hover.current;
        const p = placing.picked;
        if (under && (!p || under.x !== p.x || under.z !== p.z)) ghost(under, !!p);
      }
      drawMap(ctx, frame.current, view, ghosts, dpr);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const pointAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = toWorld(frame.current, e.clientX - rect.left, e.clientY - rect.top);
    return { x: Math.round(clampToMap(p.x)), z: Math.round(clampToMap(p.z)) };
  };

  return (
    <canvas
      ref={canvas}
      className={cn("block h-full w-full", props.className)}
      onPointerMove={(e) => {
        if (latest.current.placing && e.pointerType === "mouse") hover.current = pointAt(e);
      }}
      onPointerLeave={() => {
        hover.current = null;
      }}
      onPointerDown={(e) => {
        const placing = latest.current.placing;
        if (!placing) return;
        const p = pointAt(e);
        placing.onPick(p.x, p.z);
        if (e.pointerType !== "mouse") hover.current = null;
      }}
    />
  );
}
