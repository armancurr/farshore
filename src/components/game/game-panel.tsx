import {
  ArrowBendDownLeftIcon,
  EnvelopeSimpleIcon,
  HourglassMediumIcon,
  PlayIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type AuthStatus, dismissNotice, useAuth } from "@/lib/auth";
import { useIslandSynced } from "@/lib/island";
import type { Game, HudState, Mode } from "../../game/client/game";
import { Hud } from "./hud";
import {
  AccessCard,
  ControlsCard,
  MenuPointer,
  PendingCard,
  PlayerCard,
  Spinner,
} from "./menu-cards";
import { NameDialog } from "./name-dialog";
import { BoardPanel, ChestPanel, InventoryPanel, ShopPanel } from "./panels";
import { TouchControls } from "./touch-controls";

type Status = "loading" | "ready" | "failed";

const ONLINE_ENABLED = false;

/*
 * Where a menu card hangs: under its button, right edges lined up, then
 * pushed 12px past the button so the card's pointer sits under the icon.
 */
/* The key badge after a title-bar link. */
const menuKbd = "h-5 min-w-5 px-1.5 text-[10px]";

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
  const [game, setGame] = useState<Game | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [online, setOnline] = useState<number | null>(null);
  const [onlineAvailable, setOnlineAvailable] = useState(false);
  const [muted, setMuted] = useState(false);
  const [touch, setTouch] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  /*
   * Both menu cards open on hover. Keyboard focus opens Controls; the account
   * card (the waitlist, for guests) opens on Enter or a tap, and stays up while
   * focus is inside it (typing, or the note after joining). The Controls card
   * steps aside while it's up.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  /* Only approved, named players get past the title screen, once their island is in. */
  const auth = useAuth();
  const islandSynced = useIslandSynced();
  const canPlay = auth.status === "ready" && islandSynced;

  const mode: Mode = hud?.mode ?? "attract";
  const playing = mode !== "attract";

  const toggleMute = useCallback(() => {
    const next = !latest.current.muted;
    setMuted(next);
    gameRef.current?.setMuted(next);
  }, []);

  useEffect(() => {
    let disposed = false;
    let statusTimer: ReturnType<typeof setInterval> | undefined;

    const load = async () => {
      try {
        const mod = await import("../../game/client/game");
        const net = await import("../../game/client/net");
        if (disposed || !host.current) return;
        const g = new mod.Game(host.current, setHud);
        gameRef.current = g;
        setGame(g);
        setTouch(g.touch);
        if (import.meta.env.DEV) (window as unknown as { __tide: Game }).__tide = g;
        setStatus("ready");
        setOnlineAvailable(net.serverBase() !== null);
        const poll = async () => {
          const s = await net.fetchStatus();
          if (!disposed) setOnline(s ? s.humans : null);
        };
        void poll();
        statusTimer = setInterval(() => {
          if (latest.current.mode === "attract") void poll();
        }, 15000);
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
      if (e.code === "Escape") setAccountOpen(false);
      /* C toggles the Controls card, anywhere but a text field. */
      const typing =
        e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.code === "KeyC" && !e.repeat && !typing && !latest.current.touch) {
        setAccountOpen(false);
        setControlsOpen((open) => !open);
      }
      /*
       * On the title screen: Enter goes ashore, or else takes you to whatever
       * stands in the way (the waitlist, or the name picker). J opens the
       * account card, and its email field for guests.
       */
      const onTitle = latest.current.ready && !latest.current.playing && !typing && !e.repeat;
      const status = latest.current.authStatus;
      if (onTitle && e.code === "Enter" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (status === "ready") latest.current.play("solo");
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

    return () => {
      disposed = true;
      io.disconnect();
      window.removeEventListener("keydown", onKey);
      clearInterval(statusTimer);
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [toggleMute]);

  const play = (next: Mode) => {
    if (!canPlay) return;
    props.onPress?.();
    setAccountOpen(false);
    if (!game) return;
    startedAt.current = performance.now();
    game.start(next);
    game.lock();
  };

  const openAccount = () => {
    setControlsOpen(false);
    setAccountOpen(true);
    setTimeout(() => document.getElementById("waitlist-email")?.focus(), 30);
  };

  /* The keyboard handler and the status poll live outside renders; give them the latest. */
  const latest = useRef({
    hud,
    playing,
    mode,
    muted,
    touch,
    ready: false,
    play,
    openAccount,
    authStatus: auth.status,
  });
  latest.current = {
    hud,
    playing,
    mode,
    muted,
    touch,
    ready: status === "ready",
    play,
    openAccount,
    authStatus: auth.status,
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

  const lockedReason = LOCKED_REASON[auth.status];

  const leave = () => {
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

      {playing && hud && <Hud hud={hud} touch={touch} onSelect={(i) => game?.selectSlot(i)} />}

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
              <PlayButton
                touch={touch}
                lockedReason={canPlay ? null : (lockedReason ?? "")}
                busy={auth.status === "ready" && !islandSynced}
                onClick={() => play("solo")}
              />
              {/* Multiplayer is parked for now; the online path still builds. */}
              {ONLINE_ENABLED && onlineAvailable && canPlay && (
                <Button variant="menu" size="inline" onClick={() => play("online")}>
                  Online
                  {!!online && <span className="opacity-50">{online}</span>}
                </Button>
              )}
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

      {playing && touch && game && <TouchControls input={game.input} />}

      {paused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/45 backdrop-blur-[6px]">
          <div className="flex gap-2">
            <Button onClick={() => game?.lock()}>Resume</Button>
            <Button variant="secondary" onClick={leave}>
              Leave island
            </Button>
          </div>
          {mode === "solo" && (
            <Button
              variant="link"
              size="bare"
              onClick={() => {
                if (!confirmNew) {
                  setConfirmNew(true);
                  return;
                }
                setConfirmNew(false);
                startedAt.current = performance.now();
                game?.newIsland();
              }}
            >
              {confirmNew ? "Sure? Everything here is lost" : "Start a new island"}
            </Button>
          )}
        </div>
      )}
      {/*
        Above the pause screen, so the card can be read there. Sound and music
        live on M and N, which the card lists.
      */}
      {playing && (
        <div className="absolute top-5 right-5 z-10 sm:top-6 sm:right-6">
          {touch ? (
            <Button variant="menu" size="inline" onClick={leave}>
              Leave
            </Button>
          ) : (
            <ControlsMenu open={controlsOpen} onOpenChange={setControlsOpen} />
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

/*
 * Go ashore. Locked (with a card saying why) until the player is approved and
 * named; focusable while locked, so the reason can be read from the keyboard.
 */
function PlayButton(props: {
  touch: boolean;
  lockedReason: string | null;
  /* Fetching the island: a moment, not a lock. */
  busy?: boolean;
  onClick: () => void;
}) {
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
      {props.busy ? (
        <Spinner />
      ) : props.touch ? (
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
        className="w-[16rem] px-4 py-3 text-[13px] leading-normal text-[#d6d6d6]"
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
