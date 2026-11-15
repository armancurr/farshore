import { For, Index, Show } from "solid-js";
import type { HudState } from "../../game/client/game";

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function SurgeBanner(props: { hud: HudState }) {
  const label = () => {
    const s = props.hud.surge;
    if (s.hurry) return "The sea hurries";
    if (s.surging && !s.grace) return "The sea rises";
    if (s.grace) return `First surge in ${Math.ceil(s.nextIn)}`;
    return `Next surge in ${Math.ceil(s.nextIn)}`;
  };
  const urgent = () =>
    props.hud.surge.warning || (props.hud.surge.surging && !props.hud.surge.grace);
  return (
    <div class="pointer-events-none absolute top-24 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5 sm:top-5">
      <div
        class="border px-3 py-1 font-mono text-[11px] tracking-[0.25em] uppercase"
        classList={{
          "border-white bg-white text-black animate-pulse": urgent(),
          "border-white/30 bg-black/50 text-white/80": !urgent(),
        }}
      >
        {label()}
      </div>
      <div class="font-mono text-[10px] tracking-[0.2em] text-white/50 uppercase">
        Sea level {props.hud.tide.toFixed(1)} m
      </div>
    </div>
  );
}

function BreathRing(props: { breath: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg
      class="absolute top-1/2 left-1/2 size-16 -translate-1/2"
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="white"
        stroke-width="2"
        stroke-dasharray={`${(c * props.breath) / 100} ${c}`}
        transform="rotate(-90 32 32)"
      />
    </svg>
  );
}

function Crosshair(props: { hud: HudState }) {
  return (
    <div class="pointer-events-none absolute top-1/2 left-1/2 size-16 -translate-1/2">
      <Show when={props.hud.breath < 99.5}>
        <BreathRing breath={props.hud.breath} />
        <div class="absolute top-full left-1/2 mt-1 -translate-x-1/2 font-mono text-[9px] tracking-[0.3em] text-white/70">
          AIR
        </div>
      </Show>
      <span class="absolute top-1/2 left-1/2 h-px w-3 -translate-1/2 bg-white/80 mix-blend-difference" />
      <span class="absolute top-1/2 left-1/2 h-3 w-px -translate-1/2 bg-white/80 mix-blend-difference" />
      <Show when={props.hud.hitMarker > 0}>
        {/* Hit marker: four ticks round the centre, and what the blow did. */}
        <div class="absolute inset-0" style={{ opacity: Math.min(1, props.hud.hitMarker * 1.6) }}>
          <For each={[45, 135, 225, 315]}>
            {(deg) => (
              <span
                class="absolute top-1/2 left-1/2 h-px w-2.5 bg-white"
                style={{ transform: `translate(-50%, -50%) rotate(${deg}deg) translateX(9px)` }}
              />
            )}
          </For>
          <div
            class="absolute bottom-full left-1/2 -translate-x-1/2 font-mono text-[11px] font-medium tracking-[0.15em] whitespace-nowrap"
            style={{ transform: `translate(-50%, ${-(1 - props.hud.hitMarker) * 14}px)` }}
          >
            {props.hud.hitText}
          </div>
        </div>
      </Show>
      <Show when={props.hud.charge !== null}>
        <div class="absolute top-full left-1/2 mt-4 h-[3px] w-14 -translate-x-1/2 bg-white/20">
          <div class="h-full bg-white" style={{ width: `${(props.hud.charge ?? 0) * 100}%` }} />
        </div>
      </Show>
      <Show when={props.hud.blocking}>
        <div class="absolute top-full left-1/2 mt-4 -translate-x-1/2 font-mono text-[9px] tracking-[0.3em] text-white/80">
          BLOCK
        </div>
      </Show>
      <Show when={props.hud.shove > 0 && props.hud.charge === null}>
        <span
          class="absolute top-1/2 left-1/2 h-px -translate-1/2 bg-white/60"
          style={{ width: `${props.hud.shove * 40}px`, "margin-top": "10px" }}
        />
      </Show>
      <Show when={props.hud.target}>
        {(t) => (
          <div class="absolute top-full left-1/2 mt-8 -translate-x-1/2 font-mono text-[10px] tracking-[0.2em] whitespace-nowrap text-white/80 uppercase">
            {t().name} · {t().stagger}%
          </div>
        )}
      </Show>
    </div>
  );
}

/* Weapons on the ground: a diamond where they are, or an arrow at the edge. */
function Markers(props: { hud: HudState }) {
  return (
    <For each={props.hud.markers}>
      {(m) => (
        <div
          class="absolute -translate-1/2"
          style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
        >
          <Show
            when={!m.off}
            fallback={
              <svg
                viewBox="0 0 16 16"
                class="size-4 opacity-70"
                style={{ transform: `rotate(${m.angle}rad)` }}
                aria-hidden="true"
              >
                <polygon points="15,8 3,2 6,8 3,14" fill="white" />
              </svg>
            }
          >
            <div class="flex flex-col items-center gap-0.5">
              <div class="size-2.5 rotate-45 border border-white" />
              <div class="font-mono text-[9px] tracking-[0.15em] text-white/70">
                {Math.round(m.d)}m
              </div>
            </div>
          </Show>
        </div>
      )}
    </For>
  );
}

function Weapon(props: { hud: HudState; touch: boolean }) {
  return (
    <Show
      when={props.hud.weapon}
      fallback={
        <div class="font-mono text-[10px] tracking-[0.2em] text-white/45 uppercase">
          Fists · find a weapon ◇
        </div>
      }
    >
      {(w) => (
        <div class="flex flex-col items-end gap-1.5">
          <div class="font-mono text-[12px] tracking-[0.25em] uppercase">{w().name}</div>
          <div class="flex max-w-40 flex-wrap justify-end gap-[3px]">
            <Index each={Array.from({ length: w().max })}>
              {(_, i) => (
                <span
                  class="h-1.5 w-1"
                  classList={{ "bg-white": i < w().uses, "bg-white/20": i >= w().uses }}
                />
              )}
            </Index>
          </div>
          <Show when={!props.touch}>
            <div class="max-w-56 text-right font-mono text-[10px] leading-relaxed tracking-[0.1em] text-white/50">
              {w().hint}
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

function Stones(props: { count: number; touch: boolean }) {
  return (
    <div class="flex flex-col items-end gap-2">
      <div class="flex gap-1.5">
        <Index each={[0, 1, 2, 3, 4]}>
          {(i) => (
            <svg viewBox="0 0 20 22" class="h-[22px] w-5" aria-hidden="true">
              <polygon
                points="10,1 19,6 19,16 10,21 1,16 1,6"
                fill={i() < props.count ? "white" : "none"}
                stroke="white"
                stroke-opacity={i() < props.count ? 1 : 0.3}
                stroke-width="1.2"
              />
            </svg>
          )}
        </Index>
      </div>
      <div class="font-mono text-[10px] tracking-[0.2em] text-white/50 uppercase">
        {props.touch ? "Stone" : "E"} · raise basalt
      </div>
    </div>
  );
}

function Results(props: { hud: HudState }) {
  return (
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60">
      <div class="w-[min(92%,360px)] border border-white/25 bg-black/85 p-6">
        <div class="font-mono text-[11px] tracking-[0.3em] text-white/50 uppercase">
          Round over · {clock(props.hud.time)}
        </div>
        <Show when={props.hud.place !== null}>
          <div class="mt-3 text-3xl font-semibold tracking-tight text-white">
            {props.hud.place === 1
              ? "Last one standing."
              : `You placed ${ordinal(props.hud.place!)}.`}
          </div>
        </Show>
        <ol class="mt-5 space-y-1.5 font-mono text-[12px]">
          <For each={props.hud.results}>
            {(r) => (
              <li
                class="flex justify-between gap-4"
                classList={{
                  "text-white": r.id === props.hud.me,
                  "text-white/60": r.id !== props.hud.me,
                }}
              >
                <span>
                  {String(r.place).padStart(2, "0")}&nbsp;&nbsp;{r.name}
                  {r.id === props.hud.me ? " (you)" : ""}
                </span>
                <span class="text-white/35">{r.by ? `by ${r.by}` : ""}</span>
              </li>
            )}
          </For>
        </ol>
        <div class="mt-5 font-mono text-[11px] tracking-[0.2em] text-white/50 uppercase">
          Next tide in {Math.ceil(props.hud.resultsIn)}
        </div>
      </div>
    </div>
  );
}

export function Hud(props: { hud: HudState; touch: boolean }) {
  const h = () => props.hud;
  return (
    <div class="pointer-events-none absolute inset-0 select-none text-white">
      <Show when={h().phase === "playing" || h().phase === "countdown"}>
        <div class="absolute top-5 left-5 space-y-1 font-mono text-[11px] tracking-[0.2em] uppercase">
          <div>
            {h().alive}/{h().total} above water
          </div>
          <div class="text-white/45">
            {h().mode === "online"
              ? `Online · ${h().humans} human${h().humans === 1 ? "" : "s"}`
              : "Solo"}{" "}
            · {clock(h().time)}
          </div>
        </div>
      </Show>

      <Show when={h().phase === "playing"}>
        <SurgeBanner hud={h()} />
      </Show>

      <div class="absolute top-40 right-5 flex flex-col items-end gap-1 font-mono text-[11px] sm:top-16">
        <For each={h().feed}>
          {(item) => <div class="bg-black/50 px-2 py-0.5 text-white/80">{item.text}</div>}
        </For>
      </div>

      <Show when={h().phase === "playing" && h().player && !h().dead}>
        <Markers hud={h()} />
        <Crosshair hud={h()} />
        {/* Stagger: the more you've been hit, the further the next hit throws you. */}
        <div
          class="absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center"
          classList={{ "bottom-[13rem]": props.touch }}
        >
          <div
            class="font-mono font-medium tabular-nums"
            classList={{
              "text-3xl": h().stagger >= 100,
              "text-2xl": h().stagger < 100,
              "text-white/40": h().stagger === 0,
              "animate-pulse": h().stagger >= 120,
            }}
          >
            {h().stagger}%
          </div>
          <div class="font-mono text-[9px] tracking-[0.3em] text-white/45 uppercase">Stagger</div>
        </div>
        <Show when={h().prompt}>
          <div class="absolute bottom-28 left-1/2 -translate-x-1/2 border border-white/40 bg-black/60 px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
            {props.touch ? h().prompt?.replace("R · ", "Swap · ") : h().prompt}
          </div>
        </Show>
        <div class={props.touch ? "absolute top-40 left-5" : "absolute bottom-6 left-6"}>
          <div class="font-mono text-[10px] tracking-[0.25em] text-white/50 uppercase">
            Above the sea
          </div>
          <div
            class="mt-1 font-mono font-medium tabular-nums"
            classList={{ "text-4xl": !props.touch, "text-2xl": props.touch }}
          >
            {h().above >= 0 ? "+" : "−"}
            {Math.abs(h().above).toFixed(1)}
            <span class="ml-1 text-base text-white/50">m</span>
          </div>
        </div>
        <Show when={h().stamina < 0.99}>
          <div class="absolute bottom-6 left-1/2 h-px w-40 -translate-x-1/2 bg-white/15">
            <div class="h-px bg-white/80" style={{ width: `${h().stamina * 100}%` }} />
          </div>
        </Show>
        <div
          class="absolute right-6 bottom-6 flex flex-col items-end gap-5"
          classList={{ "bottom-auto top-56": props.touch }}
        >
          <Weapon hud={h()} touch={props.touch} />
          <Stones count={h().stones} touch={props.touch} />
        </div>
      </Show>

      <Show when={h().phase === "countdown" && h().player}>
        <div class="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div class="font-mono text-[11px] tracking-[0.3em] text-white/60 uppercase">
            The tide turns in
          </div>
          <div class="font-mono text-7xl font-medium tabular-nums">{Math.ceil(h().countdown)}</div>
          <div class="max-w-xs text-center text-sm text-white/60">
            Get high. Grab a weapon. Knock them into the sea.
          </div>
        </div>
      </Show>

      <Show when={h().phase === "playing" && h().dead}>
        <div class="absolute inset-x-0 top-24 flex flex-col items-center gap-2 text-center">
          <div class="text-2xl font-semibold tracking-tight">
            Drowned{h().place ? `, ${ordinal(h().place!)}` : ""}.
          </div>
          <div class="font-mono text-[11px] tracking-[0.2em] text-white/50 uppercase">
            {props.touch ? "Drag to look · stick to drift" : "Drift with WASD · Space up · C down"}
          </div>
        </div>
      </Show>

      <Show when={h().phase === "playing" && !h().player && h().mode === "online"}>
        <div class="absolute inset-x-0 top-24 text-center font-mono text-[11px] tracking-[0.2em] text-white/60 uppercase">
          Round in progress · you'll wash ashore next tide
        </div>
      </Show>

      <Show when={h().phase === "results"}>
        <Results hud={h()} />
      </Show>

      <Show when={h().notice}>
        <div class="absolute bottom-24 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm">
          {h().notice}
        </div>
      </Show>
    </div>
  );
}
