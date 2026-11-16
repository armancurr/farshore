import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Game, HudState, Mode } from "../../game/client/game";
import { Hud } from "./hud";
import { InventoryPanel } from "./panels";
import { TouchControls } from "./touch-controls";

type Status = "loading" | "ready" | "failed";

const ONLINE_ENABLED = false;

const pill = "px-3.5 py-2 font-mono text-[11px] tracking-[0.2em] uppercase transition-colors";

const CONTROLS = [
  ["WASD", "Move"],
  ["Space", "Jump"],
  ["Shift", "Sprint"],
  ["Click / F", "Attack · hold to charge"],
  ["Right-click", "Block (shield)"],
  ["E", "Interact"],
  ["1–5 / Wheel", "Hotbar"],
  ["Tab / I", "Pack"],
  ["N", "Music"],
  ["M", "Mute"],
  ["Esc", "Pause"],
] as const;

/*
 * The left two thirds of the site. While nobody is playing, the island idles
 * under a slow orbiting camera; pressing play wakes you up on it and the panel
 * takes over the screen.
 */
export function GamePanel(props: { onPress?: () => void }) {
  let host!: HTMLDivElement;
  let root!: HTMLDivElement;
  let controlsRoot: HTMLDivElement | undefined;
  let game: Game | null = null;
  let statusTimer: ReturnType<typeof setInterval> | undefined;

  const [status, setStatus] = createSignal<Status>("loading");
  const [hud, setHud] = createSignal<HudState | null>(null, { equals: false });
  const [online, setOnline] = createSignal<number | null>(null);
  const [onlineAvailable, setOnlineAvailable] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [touch, setTouch] = createSignal(false);
  const [controlsOpen, setControlsOpen] = createSignal(false);

  const mode = (): Mode => hud()?.mode ?? "attract";
  const playing = () => mode() !== "attract";

  const load = async () => {
    try {
      const mod = await import("../../game/client/game");
      const net = await import("../../game/client/net");
      game = new mod.Game(host, setHud);
      setTouch(game.touch);
      if (import.meta.env.DEV) (window as unknown as { __tide: Game }).__tide = game;
      setStatus("ready");
      setOnlineAvailable(net.serverBase() !== null);
      const poll = async () => {
        const s = await net.fetchStatus();
        setOnline(s ? s.humans : null);
      };
      void poll();
      statusTimer = setInterval(() => {
        if (mode() === "attract") void poll();
      }, 15000);
    } catch (error) {
      console.error(error);
      setStatus("failed");
    }
  };

  onMount(() => {
    /* Don't pull three.js in until the panel is actually on screen. */
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      void load();
    });
    io.observe(root);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && playing()) toggleMute();
      if (e.code === "Escape") setControlsOpen(false);
      /* Panels have the mouse; these keys put it away again. */
      const panel = hud()?.panel;
      if (panel && ["Escape", "Tab", "KeyI", "KeyE"].includes(e.code)) {
        e.preventDefault();
        game?.closePanel();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (controlsRoot && !controlsRoot.contains(e.target as Node)) setControlsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
      clearInterval(statusTimer);
      game?.dispose();
    });
  });

  let startedAt = 0;
  const play = (next: Mode) => {
    props.onPress?.();
    setControlsOpen(false);
    if (!game) return;
    startedAt = performance.now();
    game.start(next);
    game.lock();
  };

  const leave = () => {
    game?.input.unlock();
    game?.start("attract");
  };

  const toggleMute = () => {
    const next = !muted();
    setMuted(next);
    game?.setMuted(next);
  };

  const paused = () => {
    const h = hud();
    /* Give the pointer lock a moment to engage before calling it a pause. */
    return (
      !!h && playing() && !touch() && !h.locked && !h.panel && performance.now() - startedAt > 500
    );
  };

  return (
    <div
      ref={root}
      class="bg-black"
      classList={{
        "fixed inset-0 z-50": playing(),
        "relative h-full w-full": !playing(),
      }}
    >
      <div
        ref={host}
        class="absolute inset-0"
        classList={{ "cursor-none": playing() && !paused() }}
        onClick={() => playing() && game?.lock()}
      />

      <Show when={status() !== "ready"}>
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="font-mono text-[11px] tracking-[0.3em] text-white/50 uppercase">
            {status() === "failed"
              ? "This browser can't draw the island (WebGL is off)"
              : "Charting the island…"}
          </div>
        </div>
      </Show>

      <Show when={playing() && hud()}>
        {(h) => <Hud hud={h()} touch={touch()} onSelect={(i) => game?.selectSlot(i)} />}
      </Show>

      <Show when={playing() && hud()?.panel === "inventory" && game}>
        <InventoryPanel hud={hud()!} game={game!} />
      </Show>

      <Show when={status() === "ready" && !playing()}>
        <div class="absolute bottom-6 left-6 flex items-center gap-2 sm:bottom-8 sm:left-8">
          <button
            type="button"
            class={`bg-white text-black hover:opacity-85 ${pill}`}
            onClick={() => play("solo")}
          >
            Play
          </button>
          {/* Multiplayer is parked for now; the online path still builds. */}
          <Show when={ONLINE_ENABLED && onlineAvailable()}>
            <button
              type="button"
              class={`border border-white/40 bg-black/60 text-white hover:bg-white hover:text-black ${pill}`}
              onClick={() => play("online")}
            >
              Online
              <Show when={online()}>
                <span class="ml-1.5 opacity-50">{online()}</span>
              </Show>
            </button>
          </Show>
          <Show when={!touch()}>
            <div ref={controlsRoot} class="relative">
              <button
                type="button"
                aria-expanded={controlsOpen()}
                class={`border border-white/40 bg-black/60 text-white/70 hover:text-white ${pill}`}
                onClick={() => setControlsOpen(!controlsOpen())}
              >
                Controls
              </button>
              <Show when={controlsOpen()}>
                <dl class="absolute bottom-full left-0 mb-2 grid w-max grid-cols-[auto_auto] gap-x-6 gap-y-1.5 border border-white/20 bg-black/90 p-4 font-mono text-[10px] tracking-[0.15em] uppercase">
                  {CONTROLS.map(([key, action]) => (
                    <>
                      <dt class="text-white">{key}</dt>
                      <dd class="text-white/50">{action}</dd>
                    </>
                  ))}
                </dl>
              </Show>
            </div>
          </Show>
        </div>
        <Show when={hud()?.notice}>
          <div class="absolute top-5 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm text-white">
            {hud()?.notice}
          </div>
        </Show>
      </Show>

      <Show when={playing() && touch() && game}>
        <TouchControls input={game!.input} />
      </Show>

      <Show when={playing()}>
        <div class="absolute top-4 right-4 flex gap-2">
          <button
            type="button"
            class="border border-white/30 bg-black/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-white/80 uppercase hover:bg-white hover:text-black"
            onClick={toggleMute}
          >
            {muted() ? "Sound off" : "Sound on"}
          </button>
          <button
            type="button"
            class="border border-white/30 bg-black/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-white/80 uppercase hover:bg-white hover:text-black"
            onClick={() => game?.toggleMusic()}
          >
            {hud()?.music === false ? "Music off" : "Music on"}
          </button>
          <Show when={touch()}>
            <button
              type="button"
              class="border border-white/30 bg-black/60 px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] text-white/80 uppercase"
              onClick={leave}
            >
              Leave
            </button>
          </Show>
        </div>
      </Show>

      <Show when={paused()}>
        <div class="absolute inset-0 flex items-center justify-center bg-black/70">
          <div class="flex w-[min(90%,320px)] flex-col gap-3">
            <div class="font-mono text-[11px] tracking-[0.3em] text-white/50 uppercase">
              {mode() === "solo" ? "Paused" : "The island carries on without you"}
            </div>
            <button
              type="button"
              class="bg-white px-5 py-3 font-mono text-[12px] tracking-[0.2em] text-black uppercase"
              onClick={() => game?.lock()}
            >
              Resume
            </button>
            <button
              type="button"
              class="border border-white/50 px-5 py-3 font-mono text-[12px] tracking-[0.2em] text-white uppercase hover:bg-white hover:text-black"
              onClick={leave}
            >
              Leave island
            </button>
            <div class="mt-2 font-mono text-[10px] leading-5 tracking-[0.12em] text-white/40 uppercase">
              WASD move · Space jump · Shift sprint
              <br />
              Click / F attack, hold to charge · right-click block
              <br />E interact · 1–5 hotbar · Tab pack · N music · M mute
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
