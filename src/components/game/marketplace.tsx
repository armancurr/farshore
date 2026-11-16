import { CheckIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import type { Game } from "../../game/client/game";
import type { Showcase } from "../../game/client/scene/showcase";
import { SKINS, type SkinDef, type SkinId, skinDef } from "../../game/shared/skins";

/*
 * The marketplace: the skin you're trying on stands large on the left; the
 * right is everything on offer, one row per character. Everything is free
 * for now; prices show what each will cost once the market takes coins.
 */
export function Marketplace(props: {
  game: Game;
  touch: boolean;
  /* `byClick` when a button closed it, so the island can take the mouse back. */
  onClose: (byClick: boolean) => void;
}) {
  const [worn, setWorn] = useState<SkinId>(() => props.game.skin);
  const [picked, setPicked] = useState<SkinId>(worn);
  const [portraits, setPortraits] = useState<Map<SkinId, string> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const showcase = useRef<Showcase | null>(null);
  const drag = useRef<number | null>(null);
  const latestPick = useRef(picked);
  latestPick.current = picked;
  const { onClose } = props;

  /* The preview and the grid's portraits share three.js with the game. */
  useEffect(() => {
    let disposed = false;
    void import("../../game/client/scene/showcase").then((mod) => {
      if (disposed || !canvas.current) return;
      showcase.current = new mod.Showcase(canvas.current);
      showcase.current.show(latestPick.current);
      setPortraits(mod.portraitsOf(SKINS.map((s) => s.id)));
    });
    return () => {
      disposed = true;
      showcase.current?.dispose();
      showcase.current = null;
    };
  }, []);

  useEffect(() => {
    showcase.current?.show(picked);
  }, [picked]);

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

  const def = skinDef(picked);
  const wearing = picked === worn;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-title"
      className="@container absolute inset-0 z-40 flex flex-col bg-black/85 text-white backdrop-blur-md select-none"
    >
      <header className="flex items-center justify-between gap-6 px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 id="market-title" className="font-sans text-2xl leading-none font-extrabold">
          Marketplace
        </h2>
        <Button variant="menu" size="inline" onClick={() => onClose(true)}>
          Close
          {!props.touch && <Kbd className="h-5 min-w-5 px-1.5 text-[10px]">Esc</Kbd>}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @3xl:flex-row @3xl:overflow-hidden">
        {/* The preview: no frame, the skin stands over the dimmed island. */}
        <section className="relative flex h-[min(26rem,60vh)] shrink-0 flex-col @3xl:h-auto @3xl:min-w-0 @3xl:flex-1">
          <canvas
            ref={canvas}
            aria-label={`${def.name}, drag to turn`}
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
              <h3 className="truncate font-sans text-3xl leading-none font-extrabold">
                {def.name}
              </h3>
              <Price def={def} />
            </div>
            <Button disabled={wearing} onClick={() => wear(picked)}>
              {wearing ? "Wearing" : "Wear"}
              {wearing && <CheckIcon size={14} weight="bold" />}
            </Button>
          </div>
        </section>

        {/* Everything on offer: one row per character, its three skins across. */}
        <ul className="grid shrink-0 grid-cols-3 content-start gap-2 px-5 pb-5 sm:px-6 sm:pb-6 @3xl:w-[min(30rem,44%)] @3xl:overflow-y-auto @3xl:pt-1 @3xl:pl-1">
          {SKINS.map((s) => (
            <li key={s.id}>
              <Tile
                def={s}
                portrait={portraits?.get(s.id) ?? null}
                picked={picked === s.id}
                worn={worn === s.id}
                onPick={() => setPicked(s.id)}
                onWear={() => wear(s.id)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Price(props: { def: SkinDef }) {
  return (
    <div className="flex items-baseline gap-2 font-sans text-sm tabular-nums">
      {props.def.price > 0 && (
        <span className="text-white/35 line-through">◎ {props.def.price}</span>
      )}
      <span className="text-white/70">Free</span>
    </div>
  );
}

/* One thing on offer: click to try it on, double-click to wear it. */
function Tile(props: {
  def: SkinDef;
  portrait: string | null;
  picked: boolean;
  worn: boolean;
  onPick: () => void;
  onWear: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.picked}
      aria-label={props.worn ? `${props.def.name}, wearing` : props.def.name}
      title={props.def.name}
      onClick={props.onPick}
      onDoubleClick={props.onWear}
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
      {props.worn && (
        <span className="absolute top-2 right-2 grid size-5 place-items-center rounded-full bg-white text-black">
          <CheckIcon size={11} weight="bold" />
        </span>
      )}
    </button>
  );
}
