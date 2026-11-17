import {
  ArrowBendDownLeftIcon,
  ArrowClockwiseIcon,
  ArrowUpIcon,
  EnvelopeSimpleIcon,
  DeviceRotateIcon,
  HourglassMediumIcon,
  MapTrifoldIcon,
  PlayIcon,
  SignOutIcon,
  SpeakerHighIcon,
  SpeakerSlashIcon,
  StorefrontIcon,
  SwordIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { CURTAIN_FADE, Curtain, GOING_ASHORE, SETTING_SAIL } from "@/components/curtain";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type AuthStatus, dismissNotice, useAuth } from "@/lib/auth";
import { enterLandscape, exitLandscape, usePortrait } from "@/lib/landscape";
import type { Game, HudState, Mode } from "../../game/client/game";
import { CREATIVE } from "../../game/client/modes";
import type { PlotShapeId } from "../../game/shared/islands";
import type { PlotSizeId } from "../../game/shared/plots";
import { type ArsenalPick, ArsenalWheel } from "./arsenal-wheel";
import { GrandMap } from "./grand-map";
import { Hud } from "./hud";
import { Marketplace, type Shelf } from "./marketplace";
import { AccessCard, ControlsCard, MenuPointer, PendingCard, PlayerCard } from "./menu-cards";
import { NameDialog } from "./name-dialog";
import { GuildBoardPanel, InventoryPanel } from "./panels";
import { PlotPlacer } from "./plot-placer";
import { TouchControls } from "./touch-controls";

type Status = "loading" | "ready" | "failed";

/*
 * Going ashore, the curtain comes all the way down before the island is
 * built behind it (that's the heavy part, and it would stall the fade). Once
 * it's down it stays at least ASHORE_HOLD ms, so the words can be read even
 * when the sea answers at once, and ASHORE_SETTLE ms after you're standing,
 * so the first frames out there are drawn before it lifts.
 */
const ASHORE_HOLD = 1000;
const ASHORE_SETTLE = 250;

/*
 * Where a menu card hangs: under its button, right edges lined up, then
 * pushed 12px past the button so the card's pointer sits under the icon.
 */
/* The key badge after a title-bar link. */
const menuKbd = "h-5 min-w-5 px-1.5 text-[10px]";
/* Plain text in the title bar, set like its links. */
const menuText =
  "font-sans text-[15px] leading-none font-bold whitespace-nowrap text-white select-none";

/* Why Go ashore is greyed out, by who's looking at it. */
const LOCKED_REASON: Record<AuthStatus, string | null> = {
  loading: null,
  guest: "Invite only for now. Join the waitlist, or sign in if you've been invited.",
  unapproved: "You haven't been let in yet. You'll get an email when you are.",
  naming: "Pick your name first.",
  ready: null,
};

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
  const accountCard = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const startedAt = useRef(0);

  const [status, setStatus] = useState<Status>("loading");
  /* The island has drawn its first frames: the opening curtain can lift. */
  const [revealed, setRevealed] = useState(false);
  /* Going ashore: the curtain comes down, then stays until you're standing there (or turned back). */
  const [ashore, setAshore] = useState<"idle" | "dimming" | "going">("idle");
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  /* The grand map, over the game (N). */
  const [mapOpen, setMapOpen] = useState(false);
  const portrait = usePortrait();
  /* The marketplace (K), from the title screen or out on the island. */
  const [marketOpen, setMarketOpen] = useState(false);
  /* Choosing a spot on the grand map for land bought in the marketplace. */
  const [placing, setPlacing] = useState<{ size: PlotSizeId; shape: PlotShapeId } | null>(null);
  const [marketShelf, setMarketShelf] = useState<Shelf>("weapons");
  /* The Arsenal wheel (hold Q, or its button on a phone): what you own, to hold or spawn. */
  const [wheelOpen, setWheelOpen] = useState(false);
  /*
   * Both menu cards open on hover. Keyboard focus opens Controls; the account
   * card (the waitlist, for guests) opens on Enter or a tap, and stays up while
   * focus is inside it (typing, or the note after joining). The Controls card
   * steps aside while it's up.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  /* Only approved, named players get past the title screen. */
  const auth = useAuth();
  const canPlay = auth.status === "ready";
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
      const placingLand = !!latest.current.placing;
      if (e.code === "KeyN" && !e.repeat && latest.current.playing && !placingLand)
        setMapOpen((open) => !open);
      if (e.code === "Escape") setAccountOpen(false);
      /* C toggles the Controls card, anywhere but a text field. */
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === "KeyC" && !e.shiftKey && !e.repeat && !typing && !latest.current.touch) {
        setAccountOpen(false);
        setControlsOpen((open) => !open);
      }
      /*
       * Q brings up the Arsenal wheel while you're out there with the mouse
       * locked; the wheel itself watches for Q coming back up.
       */
      const now = latest.current;
      if (
        e.code === "KeyQ" &&
        !e.repeat &&
        !typing &&
        !now.touch &&
        !now.wheelOpen &&
        !now.marketOpen &&
        now.hud?.player &&
        now.hud.locked &&
        !now.hud.panel &&
        !now.hud.placing &&
        !now.placing
      ) {
        setMapOpen(false);
        setWheelOpen(true);
      }
      /* K opens or closes the marketplace, but not over another panel. */
      const blocked =
        !!latest.current.hud?.panel || placingLand || latest.current.ashore !== "idle";
      if (e.code === "KeyK" && !e.repeat && !typing && latest.current.ready && !blocked) {
        e.preventDefault();
        if (latest.current.marketOpen) latest.current.closeMarket(true);
        else latest.current.openMarket();
      }
      /*
       * On the title screen: Enter goes ashore, or else takes you to whatever
       * stands in the way (the waitlist, or the name picker). J opens the
       * account card, and its email field for guests.
       */
      const onTitle =
        latest.current.ready &&
        !latest.current.playing &&
        !latest.current.marketOpen &&
        !typing &&
        !e.repeat;
      const status = latest.current.authStatus;
      if (onTitle && e.code === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (status === "ready") latest.current.play("online");
        else if (status === "naming") setNameOpen(true);
        else if (status === "guest" || status === "unapproved") latest.current.openAccount();
      }
      if (onTitle && e.code === "KeyJ") {
        e.preventDefault();
        latest.current.openAccount();
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
    if (!canPlay) return;
    props.onPress?.();
    setAccountOpen(false);
    if (!game || latest.current.ashore !== "idle") return;
    /* Fullscreen and the pointer need this very key or tap, so they come before the fade. */
    /* Phones play sideways: fullscreen and locked to landscape, where the browser lets us. */
    if (touch) void enterLandscape();
    game.lock();
    setAshore("dimming");
    const name = auth.username;
    setTimeout(() => {
      const g = gameRef.current;
      if (!g) return;
      startedAt.current = performance.now();
      g.start(next, name);
      setAshore("going");
    }, CURTAIN_FADE);
  };

  const openAccount = () => {
    setControlsOpen(false);
    setAccountOpen(true);
    setTimeout(() => document.getElementById("waitlist-email")?.focus(), 30);
  };

  const openMarket = (shelf: Shelf = "weapons") => {
    setMapOpen(false);
    setAccountOpen(false);
    setControlsOpen(false);
    setWheelOpen(false);
    setMarketShelf(shelf);
    setMarketOpen(true);
    gameRef.current?.input.unlock();
  };

  /* Closed by a click, the island takes the mouse back; Escape leaves the island menu up. */
  const closeMarket = useCallback((byClick: boolean) => {
    setMarketOpen(false);
    if (byClick && latest.current.playing) gameRef.current?.lock();
  }, []);

  /* From the land shelf to the grand map, to choose where it goes. */
  const placeLand = useCallback((size: PlotSizeId, shape: PlotShapeId) => {
    setMarketOpen(false);
    setPlacing({ size, shape });
  }, []);

  const closePlacer = useCallback((byClick: boolean) => {
    setPlacing(null);
    if (byClick && latest.current.playing) gameRef.current?.lock();
  }, []);

  /* A slice of the Arsenal wheel taken: hold it, spawn it, or go and get more. */
  /* The wheel freed the mouse; once it's put away (unless for the market), the island takes it back. */
  const pickFromWheel = (pick: ArsenalPick) => {
    setWheelOpen(false);
    if (pick.t === "market") return openMarket(pick.shelf);
    if (pick.t === "weapon") game?.arm(pick.kind);
    else game?.spawnVehicle(pick.kind);
    if (!touch) game?.lock();
  };
  const closeWheel = useCallback(() => {
    setWheelOpen(false);
    if (!latest.current.touch) gameRef.current?.lock();
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
    openAccount,
    authStatus: auth.status,
    marketOpen,
    openMarket,
    closeMarket,
    placing,
    ashore,
    wheelOpen,
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
    openAccount,
    authStatus: auth.status,
    marketOpen,
    openMarket,
    closeMarket,
    placing,
    ashore,
    wheelOpen,
  };

  /* Approved without a name: ask for one as soon as the island is up. */
  const askedForName = useRef(false);
  useEffect(() => {
    if (status !== "ready" || auth.status !== "naming" || askedForName.current) return;
    askedForName.current = true;
    setAccountOpen(false);
    setNameOpen(true);
  }, [status, auth.status]);
  useEffect(() => {
    if (auth.status !== "naming") setNameOpen(false);
  }, [auth.status]);

  /* A dead invite link (or a shut-out account): put the right card in front of them. */
  const shownFor = useRef<number | null>(null);
  useEffect(() => {
    const notice = auth.notice;
    if (status !== "ready" || !notice?.openAccess || auth.status === "loading") return;
    if (shownFor.current === notice.id) return;
    shownFor.current = notice.id;
    latest.current.openAccount();
  }, [status, auth.status, auth.notice]);

  /* Title-screen notices (welcomes, dead links) clear themselves. */
  useEffect(() => {
    if (!auth.notice || auth.notice.sticky) return;
    const timer = setTimeout(dismissNotice, auth.notice.tone === "error" ? 7000 : 4000);
    return () => clearTimeout(timer);
  }, [auth.notice]);

  /* Give the island a couple of frames to draw itself before lifting the opening curtain. */
  useEffect(() => {
    if (status !== "ready") return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setRevealed(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [status]);

  /*
   * Ashore once you're standing on the island; back on the title screen if
   * the sea turned you away. Either way the curtain lifts, but not before
   * it's been down a moment.
   */
  const standing = !!hud?.player;
  useEffect(() => {
    if (ashore !== "going" || (!standing && mode !== "attract")) return;
    const wait = Math.max(ASHORE_SETTLE, startedAt.current + ASHORE_HOLD - performance.now());
    const timer = setTimeout(() => setAshore("idle"), wait);
    return () => clearTimeout(timer);
  }, [ashore, standing, mode]);

  const lockedReason = LOCKED_REASON[auth.status];

  const leave = () => {
    setMapOpen(false);
    setMarketOpen(false);
    setPlacing(null);
    setWheelOpen(false);
    setReloadKey(null);
    game?.input.unlock();
    game?.start("attract");
    if (touch) exitLandscape();
  };

  /* Down, gone, or into a panel: the wheel goes away. */
  const wheelAllowed = !!hud?.player && !hud.panel && !placing;
  useEffect(() => {
    if (!wheelAllowed) setWheelOpen(false);
  }, [wheelAllowed]);

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
    !marketOpen &&
    !placing &&
    !wheelOpen &&
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

      {playing && hud && <Hud hud={hud} touch={touch} onSelect={(i) => game?.selectSlot(i)} />}

      {playing && mapOpen && hud?.player && game && (
        <div className="pointer-events-none absolute inset-0 z-10">
          <GrandMap game={game} inset={{ top: 64, bottom: 24, side: 16 }} />
        </div>
      )}

      {playing && hud && game && (
        <>
          {hud.panel === "inventory" && <InventoryPanel hud={hud} game={game} />}
          {hud.panel === "board" && <GuildBoardPanel hud={hud} game={game} />}
        </>
      )}

      {status === "ready" && !playing && (
        <>
          <div className="absolute inset-x-5 top-5 flex items-center justify-between gap-6 sm:inset-x-6 sm:top-6">
            <div className="font-display text-2xl leading-none text-white select-none">
              farshore
            </div>
            <div className="flex items-center gap-4 sm:gap-6">
              <PlayButton
                touch={touch}
                lockedReason={canPlay ? null : (lockedReason ?? "")}
                onClick={() => play("online")}
              />
              <MarketLink touch={touch} onClick={() => openMarket()} />
              {!touch && (
                <ControlsMenu open={controlsOpen && !accountOpen} onOpenChange={setControlsOpen} />
              )}
              {auth.status === "naming" ? (
                <Button variant="menu" size="inline" onClick={() => setNameOpen(true)}>
                  Pick a name
                  <UserPlusIcon size={14} weight="fill" />
                </Button>
              ) : (
                auth.status !== "loading" && (
                  <Popover
                    open={accountOpen}
                    onOpenChange={(open, details) => {
                      /* Wandering off with the pointer doesn't close it mid-typing. */
                      const typing = accountCard.current?.contains(document.activeElement);
                      if (!open && details.reason === "trigger-hover" && typing) return;
                      setAccountOpen(open);
                    }}
                  >
                    <PopoverTrigger
                      openOnHover={!touch}
                      delay={0}
                      render={<Button variant="menu" size="inline" />}
                    >
                      <AccountLabel status={auth.status} username={auth.username} touch={touch} />
                    </PopoverTrigger>
                    <PopoverContent
                      ref={accountCard}
                      initialFocus={false}
                      {...menuCardPlacement}
                      className="w-[min(20rem,calc(100vw-1.5rem))]"
                    >
                      <MenuPointer />
                      {auth.status === "guest" && <AccessCard />}
                      {auth.status === "unapproved" && <PendingCard email={auth.email} />}
                      {auth.status === "ready" && auth.username && (
                        <PlayerCard username={auth.username} email={auth.email} />
                      )}
                    </PopoverContent>
                  </Popover>
                )
              )}
            </div>
          </div>
          {hud?.notice && (
            <div className="absolute top-5 left-1/2 -translate-x-1/2 border border-white/30 bg-black/80 px-4 py-2 text-sm text-white">
              {hud.notice}
            </div>
          )}
          {auth.notice && (
            <div
              key={auth.notice.id}
              role="status"
              className="absolute bottom-6 left-1/2 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[10px] border border-[#242424] bg-[#121212]/95 px-4 py-2.5 text-center font-sans text-[13px] font-bold text-white shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] duration-300 animate-in fade-in-0 slide-in-from-bottom-2"
            >
              {auth.notice.text}
            </div>
          )}
        </>
      )}

      {auth.status === "naming" && (
        <NameDialog open={nameOpen && !playing} onOpenChange={setNameOpen} email={auth.email} />
      )}

      {playing && touch && portrait && <TurnPhone />}

      {playing && touch && game && hud?.player && !hud.down && !hud.panel && !wheelOpen && (
        <TouchControls
          input={game.input}
          creative={hud.creative}
          flying={hud.flying}
          view={hud.view}
          placing={!!hud.placing}
          ownItem={hud.ownItem}
          repair={hud.repair}
          crew={hud.crew?.order ?? null}
        />
      )}

      {menuOpen && (
        <IslandMenu
          reloadKey={reloadKey}
          sheltered={hud.sheltered}
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
        <div
          className={cn(
            "absolute z-30 flex items-center",
            touch ? "top-3 right-4 gap-4" : "top-5 right-5 gap-4 sm:top-6 sm:right-6 sm:gap-6",
          )}
        >
          {/* Online, on a phone: how many are out here, where it fits beside the belt. */}
          {touch && mode === "online" && hud?.name && (
            <span className={cn(menuText, "hidden text-white/80 min-[760px]:inline")}>
              {hud.humans} online
            </span>
          )}
          {touch ? (
            <>
              {mode === "online" && hud?.player && (
                <Button
                  variant="menu"
                  size="inline"
                  aria-label={mapOpen ? "Close map" : "Open map"}
                  onClick={() => setMapOpen((open) => !open)}
                >
                  <MapTrifoldIcon size={18} weight={mapOpen ? "fill" : "regular"} />
                </Button>
              )}
              <Button
                variant="menu"
                size="inline"
                aria-label={muted ? "Sound on" : "Sound off"}
                onClick={toggleMute}
              >
                {muted ? (
                  <SpeakerSlashIcon size={18} weight="fill" />
                ) : (
                  <SpeakerHighIcon size={18} weight="fill" />
                )}
              </Button>
              {hud?.player && (
                <Button
                  variant="menu"
                  size="inline"
                  aria-label={wheelOpen ? "Close arsenal" : "Arsenal"}
                  onClick={() => setWheelOpen((open) => !open)}
                >
                  <SwordIcon size={18} weight={wheelOpen ? "fill" : "bold"} />
                </Button>
              )}
              {hud?.player && (
                <Button
                  variant="menu"
                  size="inline"
                  aria-label="Marketplace"
                  onClick={() => openMarket()}
                >
                  <StorefrontIcon size={18} weight="fill" />
                </Button>
              )}
              <Button variant="menu" size="inline" aria-label="Leave" onClick={leave}>
                <SignOutIcon size={18} weight="bold" />
              </Button>
            </>
          ) : (
            <>
              {hud?.player && CREATIVE && (
                <span className={cn(menuText, "inline-flex items-center gap-1.5")}>
                  {hud.creative ? "Creative" : "Survival"}
                  <Kbd className={menuKbd} aria-label="Shift+C">
                    <ArrowUpIcon weight="bold" />C
                  </Kbd>
                </span>
              )}
              {hud?.player && <MarketLink touch={false} onClick={() => openMarket()} />}
              <ControlsMenu open={controlsOpen} onOpenChange={setControlsOpen} />
            </>
          )}
        </div>
      )}

      {/* Online, at a desk: how many are out here, tucked in the corner. */}
      {playing && !touch && mode === "online" && hud?.name && (
        <span className="pointer-events-none absolute right-5 bottom-5 z-10 font-sans text-[13px] leading-none font-bold text-white/75 select-none [text-shadow:0_1px_3px_rgba(0,0,0,0.6)] sm:right-6 sm:bottom-6">
          {hud.humans} online
        </span>
      )}

      {wheelOpen && game && wheelAllowed && (
        <ArsenalWheel game={game} touch={touch} onPick={pickFromWheel} onClose={closeWheel} />
      )}

      {marketOpen && game && (
        <Marketplace
          game={game}
          touch={touch}
          shelf={marketShelf}
          onClose={closeMarket}
          onPlace={placeLand}
        />
      )}
      {placing && playing && game && (
        <PlotPlacer
          game={game}
          touch={touch}
          size={placing.size}
          shape={placing.shape}
          onClose={closePlacer}
        />
      )}

      {/* Over everything: the island being drawn, then going ashore. */}
      <Curtain
        show={!revealed}
        instant
        backdrop="sky"
        lines={SETTING_SAIL}
        message={
          status === "failed" ? "This browser can't draw the island (WebGL is off)" : undefined
        }
      />
      <Curtain show={ashore !== "idle"} backdrop="night" lines={GOING_ASHORE} />
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
  sheltered: boolean;
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
          <p className="font-sans text-sm leading-snug text-white/80">
            {reload
              ? "You'll wake up right where you are, with everything you carry. A boat seat won't come with you."
              : "Farshore doesn't pause. The tide and everyone else keep going while you're here."}
          </p>
        </div>
        {!reload && (
          <p className="font-sans text-xs leading-snug text-white/80">
            {props.sheltered
              ? "The Harbor is common ground: nobody can be hurt here. Row out to the hunting islands; the Guild Board is atop the lighthouse."
              : "Out here, weapons and animals hurt. The Harbor is safe ground: row back to it."}
          </p>
        )}
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

/* Phones play sideways; held upright, the game waits behind this. */
function TurnPhone() {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-black px-8 text-center text-white select-none">
      <DeviceRotateIcon size={56} weight="light" className="animate-pulse" />
      <div className="text-lg font-bold">Turn your phone sideways</div>
      <div className="max-w-64 text-[13px] leading-normal text-white/80">
        farshore plays in landscape. Unlock rotation if it doesn't turn.
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

/*
 * Go ashore. Locked (with a card saying why) until the player is approved and
 * named; focusable while locked, so the reason can be read from the keyboard.
 */
function PlayButton(props: { touch: boolean; lockedReason: string | null; onClick: () => void }) {
  const locked = props.lockedReason !== null;
  const button = (
    <Button
      variant="menu"
      size="inline"
      disabled={locked}
      focusableWhenDisabled
      onClick={props.onClick}
    >
      Go ashore
      {props.touch ? (
        <PlayIcon size={13} weight="fill" />
      ) : (
        <Kbd className={menuKbd} aria-label="Enter">
          <ArrowBendDownLeftIcon weight="bold" />
        </Kbd>
      )}
    </Button>
  );
  if (!props.lockedReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent
        {...menuCardPlacement}
        className="w-[16rem] px-4 py-3 text-[13px] leading-normal text-white/90"
      >
        <MenuPointer />
        {props.lockedReason}
      </TooltipContent>
    </Tooltip>
  );
}

/* What the right-most title-bar link says: the waitlist, or who you are. */
function AccountLabel(props: { status: AuthStatus; username: string | null; touch: boolean }) {
  if (props.status === "ready" && props.username) {
    return (
      <span className="flex items-center gap-1.5 duration-300 animate-in fade-in-0 slide-in-from-right-1">
        <UserCircleIcon size={17} weight="fill" />
        {props.username}
      </span>
    );
  }
  if (props.status === "unapproved") {
    return (
      <>
        Not in yet
        <HourglassMediumIcon size={14} weight="fill" />
      </>
    );
  }
  return (
    <>
      Join waitlist
      {props.touch ? (
        <EnvelopeSimpleIcon size={14} weight="fill" />
      ) : (
        <Kbd className={menuKbd}>J</Kbd>
      )}
    </>
  );
}
