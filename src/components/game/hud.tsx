import { cn } from "cn";
import { useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import type { HudState } from "../../game/client/game";
import { Belt, controlHint } from "./belt";
import { needleAt, type Strike } from "../../game/shared/fishing";

const DOWN_TEXT: Record<string, string> = {
  fall: "You fell too far",
  boar: "The boar got the better of you",
  hit: "You were struck down",
};

/* The bounty you've taken, and how far along it is. */
function ActiveBounty(props: { hud: HudState }) {
  const b = props.hud.bounty;
  return (
    <div className="flex flex-col items-center gap-1 font-mono text-[11px] tracking-[0.2em] uppercase">
      {b ? (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-white/45">Bounty</span>
            <span>{b.title}</span>
            <span className="tabular-nums">
              {b.have}/{b.need}
            </span>
          </div>
          <Progress
            aria-label="Bounty progress"
            value={Math.min(100, (b.have / b.need) * 100)}
            className="w-56"
          />
          {b.have >= b.need && (
            <div className="text-[10px] text-white/70">Done · hand it in at the board</div>
          )}
        </>
      ) : (
        <div className="text-white/40">No bounty · the board is at the lighthouse</div>
      )}
    </div>
  );
}

function Crosshair(props: { hud: HudState }) {
  const h = props.hud;
  return (
    <div className="pointer-events-none absolute top-1/2 left-1/2 size-16 -translate-1/2">
      <span className="absolute top-1/2 left-1/2 h-px w-3 -translate-1/2 bg-white/80 mix-blend-difference" />
      <span className="absolute top-1/2 left-1/2 h-3 w-px -translate-1/2 bg-white/80 mix-blend-difference" />
      {h.hitMarker > 0 && (
        /* Hit marker: four ticks round the centre, and what the blow did. */
        <div className="absolute inset-0" style={{ opacity: Math.min(1, h.hitMarker * 1.6) }}>
          {[45, 135, 225, 315].map((deg) => (
            <span
              key={deg}
              className="absolute top-1/2 left-1/2 h-px w-2.5 bg-white"
              style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateX(9px)` }}
            />
          ))}
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 font-mono text-[11px] font-medium tracking-[0.15em] whitespace-nowrap"
            style={{ transform: `translate(-50%, ${-(1 - h.hitMarker) * 14}px)` }}
          >
            {h.hitText}
          </div>
        </div>
      )}
      {h.charge !== null && (
        <Progress
          aria-label="Wind-up"
          value={h.charge * 100}
          className="absolute top-full left-1/2 mt-4 w-14 -translate-x-1/2"
          trackClassName="h-[3px]"
        />
      )}
      {h.blocking && (
        <div className="absolute top-full left-1/2 mt-4 -translate-x-1/2 font-mono text-[9px] tracking-[0.3em] text-white/80">
          BLOCK
        </div>
      )}
      {h.shove > 0 && h.charge === null && (
        <span
          className="absolute top-1/2 left-1/2 h-px -translate-1/2 bg-white/60"
          style={{ width: `${h.shove * 40}px`, marginTop: "10px" }}
        />
      )}
      {h.target && (
        <div className="absolute top-full left-1/2 mt-8 -translate-x-1/2 font-mono text-[10px] tracking-[0.2em] whitespace-nowrap text-white/80 uppercase">
          {h.target.name}
          {h.target.health !== null ? ` · ${h.target.health}%` : ""}
        </div>
      )}
    </div>
  );
}

/* The strike: a needle sweeps the bar; click while it's inside the mark. */
function StrikeBar(props: { strike: Strike; at: number }) {
  const needle = useRef<HTMLDivElement>(null);
  const { strike, at } = props;
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const t = performance.now() / 1000 - at;
      if (needle.current) needle.current.style.left = `${needleAt(t, strike.speed) * 100}%`;
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [strike.speed, at]);
  return (
    <div className="relative h-5 w-64 border border-white/50 bg-black/50">
      <div
        className="absolute inset-y-0 bg-white/30"
        style={{
          left: `${(strike.c - strike.w / 2) * 100}%`,
          width: `${strike.w * 100}%`,
        }}
      />
      <div ref={needle} className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-white" />
    </div>
  );
}

function Fishing(props: { hud: HudState }) {
  const f = props.hud.fishing;
  const c = props.hud.banner;
  return (
    <>
      {f && (
        <div className="absolute top-[58%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2.5">
          {f.strike && <StrikeBar strike={f.strike} at={f.at} />}
          <div
            className={cn(
              "font-mono text-[10px] tracking-[0.2em] whitespace-nowrap uppercase",
              f.strike ? "text-white" : "text-white/55",
            )}
          >
            {f.text}
          </div>
        </div>
      )}
      {c && (
        <div className="absolute top-[30%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-center">
          <div className="text-2xl font-semibold tracking-tight">{c.title}</div>
          {c.sub && (
            <div className="font-mono text-[10px] tracking-[0.3em] text-white/55 uppercase">
              {c.sub}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/* "Space up · Shift down · …" as a short list, one control to a line. */
function ControlHints(props: { text: string | null }) {
  if (!props.text) return null;
  const lines = props.text.split(" · ").map((line) => line.charAt(0).toUpperCase() + line.slice(1));
  return (
    <ul className="flex flex-col items-start gap-1.5 text-white/55">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

export function Hud(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  const h = props.hud;
  return (
    <div className="pointer-events-none absolute inset-0 text-white select-none">
      {/*
        Top left, in one column: coins, what the controls do right now (one
        per line), then the feed of what just happened (mode changes, pickups).
      */}
      <div
        className={cn(
          "absolute flex flex-col items-start gap-4 font-sans text-xs font-bold [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]",
          /* Phones: a narrow column, clear of the belt in the middle of the top edge. */
          props.touch
            ? "top-3 left-4 max-w-[calc(50%-13rem)] gap-2 text-[11px]"
            : "top-5 left-5 max-w-[min(18rem,calc(100%-2.5rem))] sm:top-6 sm:left-6",
        )}
      >
        {h.player && h.economy && (
          <div className="font-mono text-[13px] font-normal tracking-[0.12em] tabular-nums">
            <span className="mr-1.5 text-white/45">◎</span>
            {h.inv.coins}
          </div>
        )}
        {!props.touch && h.player && <ControlHints text={controlHint(h, props.touch)} />}
        {h.feed.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 text-white/70">
            {h.feed.map((item, i) => (
              <div key={i}>{item.text}</div>
            ))}
          </div>
        )}
      </div>
      {h.player && h.economy && (
        <div className={cn("absolute left-1/2 -translate-x-1/2", props.touch ? "top-28" : "top-5")}>
          <ActiveBounty hud={h} />
        </div>
      )}
      {/* The Harbor is common ground: nobody can be hurt here. */}
      {h.player && h.sheltered && !h.economy && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.2em] whitespace-nowrap text-white/60 uppercase [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]",
            props.touch ? "top-24" : "top-6",
          )}
        >
          The Harbor · safe from harm
        </div>
      )}

      {h.player && (
        <>
          <Crosshair hud={h} />
          <Fishing hud={h} />
          {h.prompt && (
            <div className="absolute bottom-36 left-1/2 -translate-x-1/2 border border-white/40 bg-black/60 px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
              {props.touch ? h.prompt.replace("E · ", "") : h.prompt}
            </div>
          )}
          {h.hurt > 0 && (
            <div
              className="absolute inset-0 shadow-[inset_0_0_120px_40px_rgba(255,255,255,0.35)]"
              style={{ opacity: h.hurt }}
            />
          )}
          <div
            className={cn(
              "absolute left-1/2 -translate-x-1/2",
              props.touch ? "top-3 bottom-auto" : "bottom-6",
            )}
          >
            <Belt hud={h} touch={props.touch} onSelect={props.onSelect} />
          </div>
        </>
      )}

      {h.down && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
          <div className="text-2xl font-semibold tracking-tight">You blacked out.</div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-white/55 uppercase">
            {DOWN_TEXT[h.down] ?? ""}
          </div>
        </div>
      )}

      {h.notice && (
        <div className="absolute bottom-48 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm">
          {h.notice}
        </div>
      )}
    </div>
  );
}
