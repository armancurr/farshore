import { For, Index, onCleanup, onMount, Show } from "solid-js";
import type { HudState } from "../../game/client/game";
import { needleAt, type Strike } from "../../game/shared/fishing";

const DOWN_TEXT: Record<string, string> = {
  drowned: "The sea took your breath",
  fall: "You fell too far",
  boar: "The boar got the better of you",
  hit: "You were struck down",
};

function Clock(props: { hud: HudState }) {
  const c = () => props.hud.clock;
  return (
    <div class="space-y-1 font-mono text-[11px] tracking-[0.2em] uppercase">
      <div class="flex items-baseline gap-2">
        <span class="text-[15px] font-medium tracking-[0.12em] tabular-nums">{c().time}</span>
        <span class="text-white/55">{c().part}</span>
      </div>
      <div class="text-white/40">
        Day {c().day}
        {props.hud.mode === "online" ? ` · ${props.hud.humans} on the island` : ""}
      </div>
    </div>
  );
}

/* The bounty you've taken, and how far along it is. */
function ActiveBounty(props: { hud: HudState }) {
  return (
    <div class="flex flex-col items-center gap-1 font-mono text-[11px] tracking-[0.2em] uppercase">
      <Show
        when={props.hud.bounty}
        fallback={<div class="text-white/40">No bounty · the board is at the lighthouse</div>}
      >
        {(b) => (
          <>
            <div class="flex items-baseline gap-3">
              <span class="text-white/45">Bounty</span>
              <span>{b().title}</span>
              <span class="tabular-nums">
                {b().have}/{b().need}
              </span>
            </div>
            <div class="h-px w-56 bg-white/20">
              <div class="h-px bg-white" style={{ width: `${(b().have / b().need) * 100}%` }} />
            </div>
            <Show when={b().have >= b().need}>
              <div class="text-[10px] text-white/70">Done · hand it in at the board</div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function Health(props: { hud: HudState }) {
  const pct = () => Math.max(0, Math.min(100, props.hud.health));
  return (
    <div class="w-48">
      <div class="flex items-baseline justify-between font-mono text-[10px] tracking-[0.25em] text-white/50 uppercase">
        <span>Health</span>
        <span class="text-[13px] tracking-[0.1em] text-white tabular-nums">{Math.ceil(pct())}</span>
      </div>
      <div class="mt-1.5 h-1.5 w-full border border-white/40 p-px">
        <div
          class="h-full bg-white transition-[width] duration-200"
          classList={{ "animate-pulse": pct() < 25 }}
          style={{ width: `${pct()}%` }}
        />
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
            {t().name}
            {t().health !== null ? ` · ${t().health}%` : ""}
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

/* The strike: a needle sweeps the bar; click while it's inside the mark. */
function StrikeBar(props: { strike: Strike; at: number }) {
  let needle!: HTMLDivElement;
  onMount(() => {
    let raf = 0;
    const frame = () => {
      const t = performance.now() / 1000 - props.at;
      needle.style.left = `${needleAt(t, props.strike.speed) * 100}%`;
      raf = requestAnimationFrame(frame);
    };
    frame();
    onCleanup(() => cancelAnimationFrame(raf));
  });
  return (
    <div class="relative h-5 w-64 border border-white/50 bg-black/50">
      <div
        class="absolute inset-y-0 bg-white/30"
        style={{
          left: `${(props.strike.c - props.strike.w / 2) * 100}%`,
          width: `${props.strike.w * 100}%`,
        }}
      />
      <div ref={needle} class="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-white" />
    </div>
  );
}

function Fishing(props: { hud: HudState }) {
  return (
    <>
      <Show when={props.hud.fishing}>
        {(f) => (
          <div class="absolute top-[58%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-2.5">
            <Show when={f().strike}>{(strike) => <StrikeBar strike={strike()} at={f().at} />}</Show>
            <div
              class="font-mono text-[10px] tracking-[0.2em] whitespace-nowrap uppercase"
              classList={{ "text-white/55": !f().strike, "text-white": !!f().strike }}
            >
              {f().text}
            </div>
          </div>
        )}
      </Show>
      <Show when={props.hud.banner}>
        {(c) => (
          <div class="absolute top-[30%] left-1/2 flex -translate-x-1/2 flex-col items-center gap-1 text-center">
            <div class="text-2xl font-semibold tracking-tight">{c().title}</div>
            <Show when={c().sub}>
              <div class="font-mono text-[10px] tracking-[0.3em] text-white/55 uppercase">
                {c().sub}
              </div>
            </Show>
          </div>
        )}
      </Show>
    </>
  );
}

function Hotbar(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  return (
    <div class="flex flex-col items-center gap-2">
      <Show when={props.hud.hint && !props.touch}>
        <div class="font-mono text-[10px] tracking-[0.12em] text-white/50">{props.hud.hint}</div>
      </Show>
      <div class="pointer-events-auto flex gap-1.5">
        <Index each={props.hud.inv.hotbar}>
          {(tool, i) => (
            <button
              type="button"
              class="relative flex h-14 w-16 flex-col justify-between border p-1.5 text-left font-mono"
              classList={{
                "border-white bg-white/10": props.hud.inv.slot === i,
                "border-white/25 bg-black/40": props.hud.inv.slot !== i,
              }}
              onClick={() => props.onSelect(i)}
            >
              <span class="text-[9px] text-white/45">{i + 1}</span>
              <span
                class="truncate text-[9px] leading-tight tracking-[0.08em] uppercase"
                classList={{ "text-white/40": !tool() && i !== 0 }}
              >
                {i === 0 ? "Fists" : (tool()?.name ?? "—")}
              </span>
              <Show when={tool()?.wear != null}>
                <span class="absolute right-1.5 bottom-1 left-1.5 h-px bg-white/20">
                  <span
                    class="block h-px bg-white"
                    style={{ width: `${(tool()?.wear ?? 0) * 100}%` }}
                  />
                </span>
              </Show>
            </button>
          )}
        </Index>
      </div>
    </div>
  );
}

export function Hud(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  const h = () => props.hud;
  return (
    <div class="pointer-events-none absolute inset-0 select-none text-white">
      <div class="absolute top-5 left-5 space-y-3">
        <Clock hud={h()} />
        <Show when={h().player}>
          <div class="font-mono text-[13px] tracking-[0.12em] tabular-nums">
            <span class="mr-1.5 text-white/45">◎</span>
            {h().inv.coins}
          </div>
        </Show>
      </div>
      <Show when={h().player}>
        <div class="absolute top-5 left-1/2 -translate-x-1/2" classList={{ "top-24": props.touch }}>
          <ActiveBounty hud={h()} />
        </div>
      </Show>

      <div class="absolute top-40 right-5 flex flex-col items-end gap-1 font-mono text-[11px] sm:top-16">
        <For each={h().feed}>
          {(item) => <div class="bg-black/50 px-2 py-0.5 text-white/80">{item.text}</div>}
        </For>
      </div>

      <Show when={h().player}>
        <Markers hud={h()} />
        <Crosshair hud={h()} />
        <Fishing hud={h()} />
        <Show when={h().prompt}>
          <div class="absolute bottom-36 left-1/2 -translate-x-1/2 border border-white/40 bg-black/60 px-3 py-1 font-mono text-[11px] tracking-[0.2em] uppercase">
            {props.touch ? h().prompt?.replace("E · ", "") : h().prompt}
          </div>
        </Show>
        <div class={props.touch ? "absolute top-24 left-5" : "absolute bottom-6 left-6"}>
          <Health hud={h()} />
        </div>
        <Show when={h().hurt > 0}>
          <div
            class="absolute inset-0 shadow-[inset_0_0_120px_40px_rgba(255,255,255,0.35)]"
            style={{ opacity: h().hurt }}
          />
        </Show>
        <Show when={h().stamina < 0.99}>
          <div class="absolute bottom-[6.5rem] left-1/2 h-px w-40 -translate-x-1/2 bg-white/15">
            <div class="h-px bg-white/80" style={{ width: `${h().stamina * 100}%` }} />
          </div>
        </Show>
        <div
          class="absolute bottom-6 left-1/2 -translate-x-1/2"
          classList={{ "bottom-auto top-5": props.touch }}
        >
          <Hotbar hud={h()} touch={props.touch} onSelect={props.onSelect} />
        </div>
      </Show>

      <Show when={h().down}>
        {(cause) => (
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <div class="text-2xl font-semibold tracking-tight">You blacked out.</div>
            <div class="font-mono text-[11px] tracking-[0.2em] text-white/55 uppercase">
              {DOWN_TEXT[cause()] ?? ""}
            </div>
          </div>
        )}
      </Show>

      <Show when={h().notice}>
        <div class="absolute bottom-24 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm">
          {h().notice}
        </div>
      </Show>
    </div>
  );
}
