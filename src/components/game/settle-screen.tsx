import { ShuffleIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Game, HudState } from "../../game/client/game";
import { previewImage } from "../../game/client/map";
import { placementProblem, SHAPE_IDS, SHAPES, type ShapeId } from "../../game/shared/islands";
import { GrandMap } from "./grand-map";

const randomSeed = () => (Math.random() * 2 ** 32) >>> 0;

/* The same dark card as the belt. */
const card =
  "rounded-[14px] border border-[#242424] bg-[#121212]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]";

/*
 * Arriving online: the grand map fills the screen, the land you'd bring sits
 * in a bar along the bottom, and your island follows the pointer until you
 * click a stretch of open sea. Other players' islands appear as they settle.
 */
export function SettleScreen(props: {
  game: Game;
  settling: NonNullable<HudState["settling"]>;
  touch: boolean;
  onLeave: () => void;
}) {
  const { game, settling } = props;
  const [shape, setShape] = useState<ShapeId>("headland");
  const [seeds, setSeeds] = useState(
    () => Object.fromEntries(SHAPE_IDS.map((id) => [id, randomSeed()])) as Record<ShapeId, number>,
  );
  const [picked, setPicked] = useState<{ x: number; z: number } | null>(null);
  const seed = seeds[shape];
  const image = previewImage(shape, seed);

  /* Thumbnails as images, made once per shape and variant. */
  const thumbs = useMemo(
    () =>
      Object.fromEntries(
        SHAPE_IDS.map((id) => [id, previewImage(id, seeds[id]).toDataURL()]),
      ) as Record<ShapeId, string>,
    [seeds],
  );

  /* Re-checked every render (the HUD ticks often), so a spot someone else just took turns red. */
  const islands = game.mapView().islands.map((o) => o.info);
  const problem = picked ? placementProblem(islands, picked.x, picked.z) : null;
  const ready = !!picked && !problem && !settling.pending;

  const reroll = () => setSeeds((s) => ({ ...s, [shape]: randomSeed() }));
  const settle = () => {
    if (!ready || !picked) return;
    game.settle(shape, seed, picked.x, picked.z);
    game.lock();
  };

  const latest = useRef({ reroll, settle, leave: props.onLeave });
  latest.current = { reroll, settle, leave: props.onLeave };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.target instanceof HTMLInputElement) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) setShape(SHAPE_IDS[Number(digit[1]) - 1] ?? "headland");
      if (e.code === "KeyR") latest.current.reroll();
      if (e.code === "Escape") latest.current.leave();
      if (e.code === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        latest.current.settle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const error = settling.error ?? problem;
  const status = settling.pending ? "Raising your island…" : (error ?? SHAPES[shape].name);

  return (
    <div className="absolute inset-0 z-20 bg-[#0a0a0a]">
      <GrandMap
        game={game}
        inset={{ top: 64, bottom: props.touch ? 150 : 170, side: 16 }}
        placing={{ image, picked, onPick: (x, z) => setPicked({ x, z }) }}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-3">
        <div
          className={cn("font-sans text-xs font-bold", error ? "text-[#ff8080]" : "text-white/70")}
          aria-live="polite"
        >
          {status}
        </div>
        <div className={cn(card, "pointer-events-auto flex max-w-full items-center gap-2 p-2")}>
          <div className="flex gap-1 overflow-x-auto sm:gap-1.5">
            {SHAPE_IDS.map((id, i) => (
              <button
                key={id}
                type="button"
                title={SHAPES[id].name}
                aria-label={SHAPES[id].name}
                aria-pressed={id === shape}
                data-selected={id === shape}
                onClick={() => setShape(id)}
                className={cn(
                  buttonVariants({ variant: "slot", size: "bare" }),
                  "size-11 shrink-0 p-1 sm:size-16 sm:p-1.5",
                )}
              >
                <span className="absolute top-0.5 left-1 font-key text-[9px] leading-none text-[#5c5c5c] group-data-[selected=true]/button:text-black/45">
                  {i + 1}
                </span>
                <img
                  src={thumbs[id]}
                  alt=""
                  draggable={false}
                  className={cn("size-full", id === shape && "invert")}
                />
              </button>
            ))}
          </div>
          <div className="mx-0.5 w-px self-stretch bg-[#262626]" />
          <div className="flex shrink-0 flex-col gap-1.5">
            <Button variant="secondary" size="sm" onClick={reroll}>
              <ShuffleIcon size={13} weight="bold" />
              Variant
            </Button>
            <Button size="sm" disabled={!ready} onClick={settle}>
              Settle
            </Button>
          </div>
        </div>
        {!props.touch && (
          <div className="font-sans text-[11px] text-white/45">
            1–9 to choose · R for another · click the sea to place it · Enter to settle
          </div>
        )}
      </div>
    </div>
  );
}
