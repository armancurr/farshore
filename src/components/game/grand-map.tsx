import { cn } from "cn";
import { useEffect, useRef } from "react";
import type { Game } from "../../game/client/game";
import { drawMap, fitFrame } from "../../game/client/map";

/*
 * The grand map, drawn live from the game every frame: the Harbor, the
 * hunting islands round it, and everyone out there as they move.
 */
export function GrandMap(props: {
  game: Game;
  /* Room to leave clear for the HUD at the top, bottom and sides, in CSS pixels. */
  inset?: { top: number; bottom: number; side: number };
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
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
      const { game, inset } = latest.current;
      const frame = fitFrame(w, h, inset ?? { top: 0, bottom: 0, side: 0 });
      drawMap(ctx, frame, game.mapView(), dpr);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvas} className={cn("block h-full w-full", props.className)} />;
}
