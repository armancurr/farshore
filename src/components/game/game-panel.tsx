import { EnvelopeSimple, GameController, Play } from "phosphor-solid";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import type { Game, HudState, Mode } from "../../game/client/game";
import { Hud } from "./hud";
import { ControlsCard, WaitlistCard } from "./menu-cards";
import { BoardPanel, ChestPanel, InventoryPanel, ShopPanel } from "./panels";
import { TouchControls } from "./touch-controls";

type Status = "loading" | "ready" | "failed";

const ONLINE_ENABLED = false;
/* The game stays closed to the public unless a build opts in with VITE_PLAY_ENABLED=true. */
const PLAY_ENABLED = import.meta.env.VITE_PLAY_ENABLED === "true";

/* Menu buttons: written like the card titles (bold sans, sentence case), growing a little under the pointer. */
const menuButton =
  "flex cursor-pointer items-center gap-1.5 font-sans text-[15px] leading-none font-bold text-white transition-transform duration-150 ease-out hover:scale-110 focus-visible:scale-110 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100";

/* A card hanging under a menu button, scaling in from the button's corner. */
const menuPop =
  "absolute top-full -right-3 z-10 origin-top-right pt-3 transition-[opacity,scale,visibility] duration-150 ease-out";
const menuPopShut = "invisible scale-[0.96] opacity-0";
const menuPopOpen = "visible scale-100 opacity-100";

/*
 * The left two thirds of the site. While nobody is playing, the island idles
 * under a slow orbiting camera; pressing play wakes you up on it and the panel
 * takes over the screen.
 */
export function GamePanel(props: { onPress?: () => void }) {
  let host!: HTMLDivElement;
  let root!: HTMLDivElement;
  let waitlistRoot: HTMLDivElement | undefined;
  let waitlistCard: HTMLDivElement | undefined;
  let game: Game | null = null;
  let statusTimer: ReturnType<typeof setInterval> | undefined;

  const [status, setStatus] = createSignal<Status>("loading");
  const [hud, setHud] = createSignal<HudState | null>(null, { equals: false });
  const [online, setOnline] = createSignal<number | null>(null);
  const [onlineAvailable, setOnlineAvailable] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [touch, setTouch] = createSignal(false);
  /*
   * Both menu cards open on hover. Keyboard focus opens them too, and the
   * waitlist stays up while focus is inside it (typing, or the note after
   * joining). A tap pins it on touch screens, where nothing hovers.
   */
  const [hovered, setHovered] = createSignal<"controls" | "waitlist" | null>(null);
  const [controlsKeyed, setControlsKeyed] = createSignal(false);
  const [waitlistKeyed, setWaitlistKeyed] = createSignal(false);
  const [waitlistFocused, setWaitlistFocused] = createSignal(false);
  const [waitlistPinned, setWaitlistPinned] = createSignal(false);
  const controlsShown = () => (hovered() === "controls" || controlsKeyed()) && !waitlistFocused();
  const waitlistShown = () =>
    waitlistFocused() ||
    (!controlsShown() && (hovered() === "waitlist" || waitlistKeyed() || waitlistPinned()));
  const hoverOn = (which: "controls" | "waitlist") => (e: PointerEvent) => {
    if (e.pointerType === "mouse") setHovered(which);
  };
  const hoverOff = (which: "controls" | "waitlist") => () => {
    if (hovered() === which) setHovered(null);
  };
  const closeWaitlist = () => {
    setWaitlistPinned(false);
    const active = document.activeElement;
    if (active instanceof HTMLElement && waitlistRoot?.contains(active)) active.blur();
  };
  const [confirmNew, setConfirmNew] = createSignal(false);

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
      if (e.code === "Escape") closeWaitlist();
      /* Panels have the mouse; these keys put it away again. */
      const panel = hud()?.panel;
      if (panel && ["Escape", "Tab", "KeyI", "KeyE"].includes(e.code)) {
        e.preventDefault();
        game?.closePanel();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (waitlistRoot && !waitlistRoot.contains(e.target as Node)) setWaitlistPinned(false);
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
    if (!PLAY_ENABLED) return;
    props.onPress?.();
    closeWaitlist();
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
      <Show when={playing() && hud()?.panel === "board" && game}>
        <BoardPanel hud={hud()!} game={game!} />
      </Show>
      <Show when={playing() && hud()?.panel === "shop" && game}>
        <ShopPanel hud={hud()!} game={game!} />
      </Show>
      <Show when={playing() && hud()?.panel === "chest" && game}>
        <ChestPanel hud={hud()!} game={game!} />
      </Show>

      <Show when={status() === "ready" && !playing()}>
        <div class="absolute inset-x-5 top-5 flex items-center justify-between gap-6 sm:inset-x-6 sm:top-6">
          <div class="font-display text-2xl leading-none text-white select-none">farshore</div>
          <div class="flex items-center gap-4 sm:gap-6">
            <button
              type="button"
              class={menuButton}
              disabled={!PLAY_ENABLED}
              title={PLAY_ENABLED ? undefined : "Not open yet. Join the waitlist"}
              onClick={() => play("solo")}
            >
              Go ashore
              <Play size={13} weight="fill" />
            </button>
            {/* Multiplayer is parked for now; the online path still builds. */}
            <Show when={ONLINE_ENABLED && onlineAvailable()}>
              <button type="button" class={menuButton} onClick={() => play("online")}>
                Online
                <Show when={online()}>
                  <span class="opacity-50">{online()}</span>
                </Show>
              </button>
            </Show>
            <Show when={!touch()}>
              <div
                class="relative flex flex-col items-end"
                onPointerEnter={hoverOn("controls")}
                onPointerLeave={hoverOff("controls")}
                onFocusIn={(e) => setControlsKeyed(e.target.matches(":focus-visible"))}
                onFocusOut={() => setControlsKeyed(false)}
              >
                <button type="button" class={menuButton} aria-describedby="controls-card">
                  Controls
                  <GameController size={14} weight="fill" />
                </button>
                <div class={`${menuPop} ${controlsShown() ? menuPopOpen : menuPopShut}`}>
                  <ControlsCard id="controls-card" />
                </div>
              </div>
            </Show>
            <div
              ref={waitlistRoot}
              class="relative flex flex-col items-end"
              onPointerEnter={hoverOn("waitlist")}
              onPointerLeave={hoverOff("waitlist")}
              onFocusIn={(e) => {
                setWaitlistKeyed(e.target.matches(":focus-visible"));
                setWaitlistFocused(!!waitlistCard?.contains(e.target));
              }}
              onFocusOut={(e) => {
                if (waitlistRoot?.contains(e.relatedTarget as Node | null)) return;
                setWaitlistKeyed(false);
                setWaitlistFocused(false);
              }}
            >
              <button
                type="button"
                class={menuButton}
                aria-expanded={waitlistShown()}
                aria-controls="waitlist-card"
                onClick={(e) => {
                  if (!touch()) return;
                  e.currentTarget.blur();
                  setWaitlistPinned(!waitlistPinned());
                }}
              >
                Join waitlist
                <EnvelopeSimple size={14} weight="fill" />
              </button>
              <div
                ref={waitlistCard}
                class={`${menuPop} ${waitlistShown() ? menuPopOpen : menuPopShut}`}
              >
                <WaitlistCard id="waitlist-card" />
              </div>
            </div>
          </div>
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
            <Show when={mode() === "solo"}>
              <button
                type="button"
                class="border border-white/20 px-5 py-2 font-mono text-[10px] tracking-[0.2em] text-white/60 uppercase hover:border-white/60 hover:text-white"
                onClick={() => {
                  if (!confirmNew()) {
                    setConfirmNew(true);
                    return;
                  }
                  setConfirmNew(false);
                  startedAt = performance.now();
                  game?.newIsland();
                }}
              >
                {confirmNew() ? "Sure? Everything here is lost" : "Start a new island"}
              </button>
            </Show>
            <div class="font-mono text-[10px] tracking-[0.12em] text-white/35 uppercase">
              Your island saves itself in this browser
            </div>
            <div class="mt-2 font-mono text-[10px] leading-5 tracking-[0.12em] text-white/40 uppercase">
              WASD move · Space jump · Shift sprint
              <br />
              Click / F punch, cast and strike
              <br />E interact · 1–5 hotbar · Tab pack · B build · N music · M mute
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
