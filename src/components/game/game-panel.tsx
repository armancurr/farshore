import { EnvelopeSimpleIcon, ArrowBendDownLeftIcon, PlayIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Game, HudState, Mode } from "../../game/client/game";
import { GrandMap } from "./grand-map";
import { Hud } from "./hud";
import { ControlsCard, MenuPointer, WaitlistCard } from "./menu-cards";
import { BoardPanel, ChestPanel, InventoryPanel, ShopPanel } from "./panels";
import { SettleScreen } from "./settle-screen";
import { TouchControls } from "./touch-controls";

type Status = "loading" | "ready" | "failed";

/*
 * Where a menu card hangs: under its button, right edges lined up, then
 * pushed 12px past the button so the card's pointer sits under the icon.
 */
/* The key badge after a title-bar link. */
const menuKbd = "h-5 min-w-5 px-1.5 text-[10px]";
/* Plain text in the title bar, set like its links. */
const menuText =
  "font-sans text-[15px] leading-none font-bold whitespace-nowrap text-white select-none";

const menuCardPlacement = {
  side: "bottom",
  align: "end",
  sideOffset: 12,
  alignOffset: -12,
} as const;

/*
 * The left two thirds of the site. While nobody is playing, the island idles
 * under a slow orbiting camera; pressing play wakes you up on it and the panel
 * takes over the screen.
 */
export function GamePanel(props: { onPress?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const waitlistCard = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const startedAt = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  /* The grand map, over the game (N). */
  const [mapOpen, setMapOpen] = useState(false);
  /*
   * Both menu cards open on hover. Keyboard focus opens Controls; the waitlist
   * opens on Enter or a tap, and stays up while focus is inside it (typing, or
   * the note after joining). The Controls card steps aside while it's up.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);

  const mode: Mode = hud?.mode ?? "attract";
  const playing = mode !== "attract";

  const toggleMute = useCallback(() => {
    const next = !latest.current.muted;
    setMuted(next);
    gameRef.current?.setMuted(next);
  }, []);

  useEffect(() => {
    let disposed = false;

    const load = async () => {
      try {
        const mod = await import("../../game/client/game");
        if (disposed || !host.current) return;
        const g = new mod.Game(host.current, setHud);
        gameRef.current = g;
        setGame(g);
        setTouch(g.touch);
        if (import.meta.env.DEV) (window as unknown as { __tide: Game }).__tide = g;
        setStatus("ready");
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
    };

    /* Don't pull three.js in until the panel is actually on screen. */
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      void load();
    });
    if (root.current) io.observe(root.current);

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && latest.current.playing) toggleMute();
      if (e.code === "KeyN" && !e.repeat && latest.current.playing && !latest.current.hud?.settling)
        setMapOpen((open) => !open);
      if (e.code === "Escape") setWaitlistOpen(false);
      /* C toggles the Controls card, anywhere but a text field. */
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === "KeyC" && !e.shiftKey && !e.repeat && !typing && !latest.current.touch) {
        setWaitlistOpen(false);
        setControlsOpen((open) => !open);
      }
      /* On the title screen: Enter goes ashore, J opens the waitlist (and its field). */
      const onTitle = latest.current.ready && !latest.current.playing && !typing && !e.repeat;
      if (onTitle && e.code === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        latest.current.play("online");
      }
      if (onTitle && e.code === "KeyJ") {
        e.preventDefault();
        setControlsOpen(false);
        setWaitlistOpen(true);
        setTimeout(() => document.getElementById("waitlist-email")?.focus(), 30);
      }
      /* Panels have the mouse; these keys put it away again. */
      const panel = latest.current.hud?.panel;
      if (panel && ["Escape", "Tab", "KeyI", "KeyE"].includes(e.code)) {
        e.preventDefault();
        gameRef.current?.closePanel();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      disposed = true;
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [toggleMute]);

  const play = (next: Mode) => {
    props.onPress?.();
    setWaitlistOpen(false);
    if (!game) return;
    startedAt.current = performance.now();
    game.start(next);
    game.lock();
  };

  /* The keyboard handler and the status poll live outside renders; give them the latest. */
  const latest = useRef({ hud, playing, mode, muted, touch, ready: false, play });
  latest.current = { hud, playing, mode, muted, touch, ready: status === "ready", play };

  const leave = () => {
    setMapOpen(false);
    game?.input.unlock();
    game?.start("attract");
  };

  /* Give the pointer lock a moment to engage before calling it a pause. */
  const paused =
    !!hud &&
    playing &&
    !touch &&
    !hud.locked &&
    !hud.panel &&
    !hud.settling &&
    performance.now() - startedAt.current > 500;

  return (
    <div
      ref={root}
      className={cn("bg-black", playing ? "fixed inset-0 z-50" : "relative h-full w-full")}
    >
      <div
        ref={host}
        className={cn("absolute inset-0", playing && !paused && "cursor-none")}
        onClick={() => playing && game?.lock()}
      />

      {status !== "ready" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-mono text-[11px] tracking-[0.3em] text-white/50 uppercase">
            {status === "failed"
              ? "This browser can't draw the island (WebGL is off)"
              : "Charting the island…"}
          </div>
        </div>
      )}

      {playing && hud && !hud.settling && (
        <Hud hud={hud} touch={touch} onSelect={(i) => game?.selectSlot(i)} />
      )}

      {playing && hud?.connecting && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="font-sans text-xs font-bold text-white/60">Reaching the grand map…</div>
        </div>
      )}

      {playing && hud?.settling && game && (
        <SettleScreen game={game} settling={hud.settling} touch={touch} onLeave={leave} />
      )}

      {playing && mapOpen && hud?.player && game && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <GrandMap game={game} inset={{ top: 64, bottom: 24, side: 16 }} />
        </div>
      )}

      {playing && hud && game && (
        <>
          {hud.panel === "inventory" && <InventoryPanel hud={hud} game={game} />}
          {hud.panel === "board" && <BoardPanel hud={hud} game={game} />}
          {hud.panel === "shop" && <ShopPanel hud={hud} game={game} />}
          {hud.panel === "chest" && <ChestPanel hud={hud} game={game} />}
        </>
      )}

      {status === "ready" && !playing && (
        <>
          <div className="absolute inset-x-5 top-5 flex items-center justify-between gap-6 sm:inset-x-6 sm:top-6">
            <div className="font-display text-2xl leading-none text-white select-none">
              farshore
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              <Button variant="menu" size="inline" onClick={() => play("online")}>
                Go ashore
                {touch ? (
                  <PlayIcon size={13} weight="fill" />
                ) : (
                  <Kbd className={menuKbd} aria-label="Enter">
                    <ArrowBendDownLeftIcon weight="bold" />
                  </Kbd>
                )}
              </Button>
              {!touch && (
                <ControlsMenu open={controlsOpen && !waitlistOpen} onOpenChange={setControlsOpen} />
              )}
              <Popover
                open={waitlistOpen}
                onOpenChange={(open, details) => {
                  /* Wandering off with the pointer doesn't close it mid-typing. */
                  const typing = waitlistCard.current?.contains(document.activeElement);
                  if (!open && details.reason === "trigger-hover" && typing) return;
                  setWaitlistOpen(open);
                }}
              >
                <PopoverTrigger
                  openOnHover={!touch}
                  delay={0}
                  render={<Button variant="menu" size="inline" />}
                >
                  Join waitlist
                  {touch ? (
                    <EnvelopeSimpleIcon size={14} weight="fill" />
                  ) : (
                    <Kbd className={menuKbd}>J</Kbd>
                  )}
                </PopoverTrigger>
                <PopoverContent
                  ref={waitlistCard}
                  initialFocus={false}
                  {...menuCardPlacement}
                  className="w-[min(20rem,calc(100vw-1.5rem))]"
                >
                  <MenuPointer />
                  <WaitlistCard />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {hud?.notice && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm text-white">
              {hud.notice}
            </div>
          )}
        </>
      )}

      {playing && touch && game && <TouchControls input={game.input} />}

      {paused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/45 backdrop-blur-[6px]">
          <div className="flex gap-2">
            <Button onClick={() => game?.lock()}>Resume</Button>
            <Button variant="secondary" onClick={leave}>
              Leave island
            </Button>
          </div>
        </div>
      )}
      {/*
        Above the pause screen, so the card can be read there. Sound lives
        on M, which the card lists.
      */}
      {playing && (
        <div className="absolute top-5 right-5 z-30 flex items-center gap-4 sm:top-6 sm:right-6 sm:gap-6">
          {/* Online: who you are, and how many are out here. */}
          {mode === "online" && hud?.name && (
            <span className={menuText}>
              {hud.name}
              <span className="ml-2 text-white/45">{hud.humans} online</span>
              {hud.creative && <span className="ml-2 text-white/45">· Creative</span>}
            </span>
          )}
          {hud?.settling ? (
            <Button variant="menu" size="inline" onClick={leave}>
              Back
              {!touch && <Kbd className={menuKbd}>Esc</Kbd>}
            </Button>
          ) : touch ? (
            <Button variant="menu" size="inline" onClick={leave}>
              Leave
            </Button>
          ) : (
            <>
              {mode === "online" && hud?.player && (
                <Button variant="menu" size="inline" onClick={() => setMapOpen((open) => !open)}>
                  Map
                  <Kbd className={menuKbd}>N</Kbd>
                </Button>
              )}
              <ControlsMenu open={controlsOpen} onOpenChange={setControlsOpen} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* The Controls link and the card of keys hanging under it. */
function ControlsMenu(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Tooltip open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <TooltipTrigger closeOnClick={false} render={<Button variant="menu" size="inline" />}>
        Controls
        <Kbd className={menuKbd}>C</Kbd>
      </TooltipTrigger>
      <TooltipContent {...menuCardPlacement} className="w-[21rem] px-[18px] pt-[18px] pb-4">
        <MenuPointer />
        <ControlsCard />
      </TooltipContent>
    </Tooltip>
  );
}
