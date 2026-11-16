import {
  ArrowBendDownLeftIcon,
  ArrowClockwiseIcon,
  ArrowUpIcon,
  EnvelopeSimpleIcon,
  PlayIcon,
  SignOutIcon,
  StorefrontIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Game, HudState, Mode } from "../../game/client/game";
import { GrandMap } from "./grand-map";
import { Hud } from "./hud";
import { Marketplace } from "./marketplace";
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
  /* The marketplace (K), from the title screen or out on the island. */
  const [marketOpen, setMarketOpen] = useState(false);
  /*
   * Both menu cards open on hover. Keyboard focus opens Controls; the waitlist
   * opens on Enter or a tap, and stays up while focus is inside it (typing, or
   * the note after joining). The Controls card steps aside while it's up.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  /*
   * A reload key (⌘R, Ctrl+R, F5) caught while on the island: the island menu
   * asks first, naming the key so a second press goes through.
   */
  const [reloadKey, setReloadKey] = useState<string | null>(null);
  /* Set just before we reload on purpose, so the browser's own prompt stays quiet. */
  const unloading = useRef(false);

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
      /*
       * On the island, a reload key opens the island menu instead. Pressing it
       * again while the menu asks lets the reload through.
       */
      const reload = e.code === "F5" || ((e.metaKey || e.ctrlKey) && e.code === "KeyR");
      if (reload && latest.current.playing && !latest.current.touch) {
        if (latest.current.reloadKey) {
          unloading.current = true;
          return;
        }
        e.preventDefault();
        setMapOpen(false);
        setReloadKey(e.code === "F5" ? "F5" : e.metaKey ? "⌘R" : "Ctrl+R");
        gameRef.current?.input.unlock();
        return;
      }
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
      /* K opens or closes the marketplace, but not over another panel or the settle screen. */
      const blocked = !!latest.current.hud?.panel || !!latest.current.hud?.settling;
      if (e.code === "KeyK" && !e.repeat && !typing && latest.current.ready && !blocked) {
        e.preventDefault();
        if (latest.current.marketOpen) latest.current.closeMarket(true);
        else latest.current.openMarket();
      }
      /* On the title screen: Enter goes ashore, J opens the waitlist (and its field). */
      const onTitle =
        latest.current.ready &&
        !latest.current.playing &&
        !latest.current.marketOpen &&
        !typing &&
        !e.repeat;
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

    /*
     * The reload button, closing the tab, a back swipe: a page can't show its
     * own dialog for those, so on the island the browser asks instead.
     */
    const onUnload = (e: BeforeUnloadEvent) => {
      if (!latest.current.playing || unloading.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      disposed = true;
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
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

  const openMarket = () => {
    setMapOpen(false);
    setWaitlistOpen(false);
    setControlsOpen(false);
    setMarketOpen(true);
    gameRef.current?.input.unlock();
  };

  /* Closed by a click, the island takes the mouse back; Escape leaves the island menu up. */
  const closeMarket = useCallback((byClick: boolean) => {
    setMarketOpen(false);
    if (byClick && latest.current.playing) gameRef.current?.lock();
  }, []);

  /* The keyboard handler and the status poll live outside renders; give them the latest. */
  const latest = useRef({
    hud,
    playing,
    mode,
    muted,
    touch,
    reloadKey,
    ready: false,
    play,
    marketOpen,
    openMarket,
    closeMarket,
  });
  latest.current = {
    hud,
    playing,
    mode,
    muted,
    touch,
    reloadKey,
    ready: status === "ready",
    play,
    marketOpen,
    openMarket,
    closeMarket,
  };

  const leave = () => {
    setMapOpen(false);
    setMarketOpen(false);
    setReloadKey(null);
    game?.input.unlock();
    game?.start("attract");
  };

  /* Back in the game (or off it): the reload question is settled. */
  const locked = !!hud?.locked;
  useEffect(() => {
    if (locked || !playing) setReloadKey(null);
  }, [locked, playing]);

  /*
   * The mouse is free but you're still out there: the island doesn't pause,
   * so this is a menu over a live world. Give the pointer lock a moment to
   * engage before showing it.
   */
  const menuOpen =
    !!hud &&
    playing &&
    !touch &&
    !hud.locked &&
    !hud.panel &&
    !hud.settling &&
    !marketOpen &&
    (!!reloadKey || performance.now() - startedAt.current > 500);

  return (
    <div
      ref={root}
      className={cn("bg-black", playing ? "fixed inset-0 z-50" : "relative h-full w-full")}
    >
      <div
        ref={host}
        className={cn("absolute inset-0", playing && !menuOpen && "cursor-none")}
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
              <MarketLink touch={touch} onClick={openMarket} />
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

      {menuOpen && (
        <IslandMenu
          reloadKey={reloadKey}
          onBack={() => {
            setReloadKey(null);
            game?.lock();
          }}
          onLeave={leave}
          onReload={() => {
            unloading.current = true;
            window.location.reload();
          }}
        />
      )}
      {/*
        Above the island menu, so the card can be read there. Sound lives
        on M, which the card lists.
      */}
      {playing && (
        <div className="absolute top-5 right-5 z-30 flex items-center gap-4 sm:top-6 sm:right-6 sm:gap-6">
          {/* Online: how many are out here. */}
          {mode === "online" && hud?.name && (
            <span className={cn(menuText, "text-white/45")}>{hud.humans} online</span>
          )}
          {hud?.settling ? (
            <Button variant="menu" size="inline" onClick={leave}>
              Back
              {!touch && <Kbd className={menuKbd}>Esc</Kbd>}
            </Button>
          ) : touch ? (
            <>
              {hud?.player && <MarketLink touch onClick={openMarket} />}
              <Button variant="menu" size="inline" onClick={leave}>
                Leave
              </Button>
            </>
          ) : (
            <>
              {hud?.player && (
                <span className={cn(menuText, "inline-flex items-center gap-1.5")}>
                  {hud.creative ? "Creative" : "Survival"}
                  <Kbd className={menuKbd} aria-label="Shift+C">
                    <ArrowUpIcon weight="bold" />C
                  </Kbd>
                </span>
              )}
              {mode === "online" && hud?.player && (
                <Button variant="menu" size="inline" onClick={() => setMapOpen((open) => !open)}>
                  Open map
                  <Kbd className={menuKbd}>N</Kbd>
                </Button>
              )}
              {hud?.player && <MarketLink touch={false} onClick={openMarket} />}
              <ControlsMenu open={controlsOpen} onOpenChange={setControlsOpen} />
            </>
          )}
        </div>
      )}

      {marketOpen && game && <Marketplace game={game} touch={touch} onClose={closeMarket} />}
    </div>
  );
}

/*
 * Over the island whenever the mouse is free. Online there's no pausing, so it
 * says so. After a reload key it asks about that instead. Its buttons are the
 * same bare links as the title bar.
 */
function IslandMenu(props: {
  reloadKey: string | null;
  onBack: () => void;
  onLeave: () => void;
  onReload: () => void;
}) {
  const reload = props.reloadKey;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-4 backdrop-blur-[6px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="island-menu-title"
        className="flex w-full max-w-sm flex-col items-start gap-6 text-left text-white select-none"
      >
        <div className="flex flex-col gap-2">
          <h2 id="island-menu-title" className="font-sans text-2xl leading-none font-extrabold">
            {reload ? "Reload the page?" : "Still on the island"}
          </h2>
          <p className="font-sans text-sm leading-snug text-white/60">
            {reload
              ? "You'll wake up right where you are, with everything you carry. A boat seat or a line in the water won't come with you."
              : "Farshore doesn't pause. The tide and everyone else keep going while you're here."}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <Button variant="menu" size="inline" autoFocus onClick={props.onBack}>
            {reload ? "Stay" : "Back to the island"}
            <PlayIcon size={13} weight="fill" />
          </Button>
          {reload ? (
            <Button variant="menu" size="inline" onClick={props.onReload}>
              Reload
              <ArrowClockwiseIcon size={14} weight="bold" />
            </Button>
          ) : (
            <Button variant="menu" size="inline" onClick={props.onLeave}>
              Leave island
              <SignOutIcon size={14} weight="bold" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* The title-bar link to the marketplace. */
function MarketLink(props: { touch: boolean; onClick: () => void }) {
  return (
    <Button variant="menu" size="inline" onClick={props.onClick}>
      Marketplace
      {props.touch ? <StorefrontIcon size={14} weight="fill" /> : <Kbd className={menuKbd}>K</Kbd>}
    </Button>
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
