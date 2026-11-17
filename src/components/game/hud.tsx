import { cn } from "cn";
import { Progress } from "@/components/ui/progress";
import type { HudState } from "../../game/client/game";
import { Belt, controlHint } from "./belt";
import { clock } from "./panels";

const DOWN_TEXT: Record<string, string> = {
  fall: "You fell too far",
  animal: "The wilds got the better of you",
  hit: "You were struck down",
  drown: "You went down with your car",
};

/*
 * What the guild has you doing: only what's yours. The contract you've taken,
 * a cull you're hunting in, and coins owed. What else is afoot (the alpha,
 * a cull you're not in) shows only at the Guild Board, where you'd take it up.
 */
function Missions(props: { hud: HudState }) {
  const h = props.hud;
  const g = h.guild;
  const c = g.mission;
  const alpha = g.near && g.alpha && !g.alpha.slainBy ? g.alpha : null;
  const live = g.cull?.state === "active" ? g.cull : null;
  const hunting = !!live && !!h.name && live.hunters.some((x) => x.name === h.name);
  const cull = live && (g.near || hunting) ? live : null;
  if (!c && !alpha && !cull && g.owed <= 0) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] uppercase [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">
      {c && (
        <>
          <div className="flex items-baseline gap-3">
            <span className="text-white/75">Contract</span>
            <span>{c.title}</span>
            <span className="tabular-nums">
              {c.have}/{c.need}
            </span>
          </div>
          <Progress
            aria-label="Contract progress"
            value={Math.min(100, (c.have / c.need) * 100)}
            className="w-56"
          />
          {c.have >= c.need && (
            <div className="text-[10px]">Done · hand it in at the Guild Board</div>
          )}
        </>
      )}
      {alpha && (
        <div className="text-[10px]">
          Alpha · {alpha.name} on {alpha.island} · {clock(alpha.left)}
        </div>
      )}
      {cull && (
        <div className="text-[10px]">
          Cull · {cull.island} · {cull.done}/{cull.need} {cull.kind}
        </div>
      )}
      {g.owed > 0 && <div className="text-[10px]">{g.owed} ◎ waiting at the Guild Board</div>}
    </div>
  );
}

/* Big news for a moment: a payout, an alpha sighted, an island overrun. */
function Banner(props: { hud: HudState }) {
  const c = props.hud.banner;
  if (!c) return null;
  return (
    <div className="absolute top-[30%] left-1/2 flex w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 flex-col items-center gap-1 text-center [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
      <div className="text-2xl font-semibold tracking-tight">{c.title}</div>
      {c.sub && <div className="font-mono text-[10px] tracking-[0.3em] uppercase">{c.sub}</div>}
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

/* "Space up · Shift down · …" as a short list, one control to a line. */
/*
 * What the controls do right now, one per line. What E would do here (get in
 * the rowboat, open the chest) leads, brighter, unless a line already says it.
 */
function ControlHints(props: { text: string | null; prompt: string | null }) {
  const cap = (line: string) => line.charAt(0).toUpperCase() + line.slice(1);
  const lines = props.text ? props.text.split(" · ").map(cap) : [];
  /* "E · Get in the rowboat" reads as a hint line: "E get in the rowboat". */
  const action = props.prompt?.replace(/^E · (.)/, (_, c: string) => `E ${c.toLowerCase()}`);
  const lead =
    action && !lines.some((l) => l.toLowerCase() === action.toLowerCase()) ? action : null;
  if (!lead && !lines.length) return null;
  return (
    <ul className="flex flex-col items-start gap-1.5 text-white/80">
      {lead && <li className="text-white">{cap(lead)}</li>}
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
            <span className="mr-1.5 text-white/75">◎</span>
            {h.inv.coins}
          </div>
        )}
        {h.player && h.place && (
          <div className="font-mono text-[11px] font-normal tracking-[0.12em] uppercase">
            {h.place}
            {h.sheltered ? " · safe ground" : ""}
          </div>
        )}
        {!props.touch && h.player && (
          <ControlHints text={controlHint(h, props.touch)} prompt={h.prompt} />
        )}
        {h.feed.length > 0 && (
          <div className="flex flex-col items-start gap-1.5 text-white/90">
            {h.feed.map((item, i) => (
              <div key={i}>{item.text}</div>
            ))}
          </div>
        )}
      </div>
      {h.player && h.economy && (
        <div
          className={cn("absolute left-1/2 -translate-x-1/2", props.touch ? "top-28" : "top-20")}
        >
          <Missions hud={h} />
        </div>
      )}
      {/* The Harbor is common ground: nobody can be hurt here. */}
      {h.player && h.sheltered && !h.economy && (
        <div
          className={cn(
            "absolute left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.2em] whitespace-nowrap uppercase [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]",
            props.touch ? "top-24" : "top-6",
          )}
        >
          The Harbor · safe from harm
        </div>
      )}

      {h.player && (
        <>
          <Crosshair hud={h} />
          <Banner hud={h} />
          {/* Phones have no hints column: what the action button does sits over the belt. */}
          {props.touch && h.prompt && (
            <div className="absolute bottom-36 left-1/2 -translate-x-1/2 border border-white/40 bg-black/60 px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
              {h.prompt.replace("E · ", "")}
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
          <div className="font-mono text-[11px] tracking-[0.2em] text-white/85 uppercase">
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
