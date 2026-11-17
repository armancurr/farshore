import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Game, HudState, ToolView } from "../../game/client/game";
import { TOOLS } from "../../game/shared/items";

const heading = "font-mono text-[10px] tracking-[0.3em] text-white/70 uppercase";

/*
 * The frame every panel shares: a title, a close button, and its body. The
 * game decides when a panel is open; the dialog only asks it to close (Escape,
 * or the Close button). Clicking the dark backdrop does nothing, as before.
 */
export function PanelFrame(props: {
  title: string;
  aside?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          <div className="flex items-center gap-4">
            {props.aside}
            <DialogClose render={<Button variant="outline" size="hud-xs" />}>Close</DialogClose>
          </div>
        </DialogHeader>
        <div className="space-y-6 overflow-y-auto px-5 py-5">{props.children}</div>
      </DialogContent>
    </Dialog>
  );
}

export function Coins(props: { coins: number }) {
  return (
    <div className="font-mono text-[12px] tracking-[0.15em] tabular-nums">
      <span className="mr-1.5 text-white/80">◎</span>
      {props.coins}
    </div>
  );
}

function ToolRow(props: { tool: ToolView; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13px]">{props.tool.name}</div>
        <div className="font-mono text-[10px] tracking-[0.12em] text-white/80 uppercase">
          {TOOLS[props.tool.kind].weapon ? "Weapon · swap it in the marketplace" : "Tool"}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">{props.children}</div>
    </li>
  );
}

export function InventoryPanel(props: { hud: HudState; game: Game }) {
  const inv = props.hud.inv;
  /* Equip into the selected slot, or the first free one. */
  const target = (() => {
    if (inv.slot > 0) return inv.slot;
    const free = inv.hotbar.findIndex((t, k) => k > 0 && !t);
    return free > 0 ? free : 1;
  })();
  return (
    <PanelFrame
      title="Pack"
      aside={<Coins coins={inv.coins} />}
      onClose={() => props.game.closePanel()}
    >
      <section>
        <h3 className={heading}>Hotbar</h3>
        <ul className="mt-2">
          {inv.hotbar.map(
            (t, k) =>
              t && (
                <ToolRow key={t.id} tool={t}>
                  <span className="self-center font-mono text-[10px] text-white/80">{k + 1}</span>
                  <Button
                    variant="outline"
                    size="hud-xs"
                    onClick={() => props.game.equip(t.id, -1)}
                  >
                    To pack
                  </Button>
                </ToolRow>
              ),
          )}
        </ul>
      </section>
      <section>
        <h3 className={heading}>In the pack</h3>
        {inv.pack.length ? (
          <ul className="mt-2">
            {inv.pack.map((t) => (
              <ToolRow key={t.id} tool={t}>
                <Button
                  variant="outline"
                  size="hud-xs"
                  onClick={() => props.game.equip(t.id, target)}
                >
                  To slot {target + 1}
                </Button>
              </ToolRow>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-white/80">Nothing spare.</p>
        )}
      </section>
      <section>
        <h3 className={heading}>Carcasses and goods</h3>
        {inv.items.length ? (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {inv.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-2 border-b border-white/10 py-1.5"
              >
                <span className="truncate text-[13px]">{item.name}</span>
                <span className="font-mono text-[11px] text-white/80 tabular-nums">
                  ×{item.count}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-white/75">Empty. Go hunting.</p>
        )}
      </section>
    </PanelFrame>
  );
}

/* Minutes and seconds, for the board's clocks. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

const RISK: Record<string, string> = {
  prey: "Flees",
  defender: "Fights back",
  predator: "Hunts you",
};

/*
 * The Guild Board, at the top of the lighthouse: the only way to earn coins.
 * Contracts to take one at a time, the alpha with a price on its head, the
 * island that needs culling, and whatever you're owed.
 */
export function GuildBoardPanel(props: { hud: HudState; game: Game }) {
  const g = props.hud.guild;
  const mine = g.mission;
  const far = !g.near;
  return (
    <PanelFrame
      title="Guild Board"
      aside={<Coins coins={props.hud.inv.coins} />}
      onClose={() => props.game.closePanel()}
    >
      {far && (
        <p className="text-[12px] text-white/80">
          Climb to the top of the Harbor lighthouse to deal with the board.
        </p>
      )}

      {g.payouts.length > 0 && (
        <section>
          <h3 className={heading}>Owed to you</h3>
          <div className="mt-2 flex items-center justify-between gap-4 border border-white/40 p-3">
            <ul className="min-w-0 space-y-1">
              {g.payouts.map((p, i) => (
                <li key={i} className="flex items-baseline gap-3 text-[13px]">
                  <span className="truncate">{p.title}</span>
                  <span className="font-mono text-[11px] tabular-nums">{p.reward} ◎</span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              size="hud-xs"
              disabled={far}
              onClick={() => props.game.collect()}
            >
              Collect {g.owed} ◎
            </Button>
          </div>
        </section>
      )}

      <section>
        <h3 className={heading}>Alpha bounty</h3>
        {g.alpha ? (
          <div className="mt-2 border border-white/40 p-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="text-[15px] font-semibold">{g.alpha.name}</div>
              <div className="font-mono text-[12px] tabular-nums">{g.alpha.reward} ◎</div>
            </div>
            <div className="mt-0.5 text-[12px] text-white/80">
              {g.alpha.slainBy
                ? `Slain by ${g.alpha.slainBy}.`
                : `A great ${g.alpha.kind.toLowerCase()} roams ${g.alpha.island}. Whoever brings it down earns the bounty.`}
            </div>
            {!g.alpha.slainBy && (
              <div className="mt-1 font-mono text-[11px] tracking-[0.12em] text-white/80 tabular-nums">
                Gone in {clock(g.alpha.left)}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-white/75">
            No alpha sighted
            {g.nextAlpha !== null ? ` · word expected in ${clock(g.nextAlpha)}` : ""}.
          </p>
        )}
      </section>

      <section>
        <h3 className={heading}>Cull</h3>
        {g.cull ? (
          <div className="mt-2 border border-white/40 p-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="text-[15px] font-semibold">
                {g.cull.state === "active"
                  ? `${g.cull.island} is overrun`
                  : g.cull.state === "cleared"
                    ? `${g.cull.island} is cleared`
                    : `The cull on ${g.cull.island} ran out`}
              </div>
              <div className="font-mono text-[12px] tabular-nums">{g.cull.pot} ◎ pot</div>
            </div>
            <div className="mt-0.5 text-[12px] text-white/80">
              Cull the {g.cull.kind}. The pot is shared by everyone who helps, by their share of the
              kills.
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Progress
                aria-label="Cull progress"
                value={Math.min(100, (g.cull.done / g.cull.need) * 100)}
                className="flex-1"
              />
              <span className="font-mono text-[11px] tabular-nums">
                {g.cull.done}/{g.cull.need}
              </span>
            </div>
            {g.cull.state === "active" && (
              <div className="mt-1 font-mono text-[11px] tracking-[0.12em] text-white/80 tabular-nums">
                {clock(g.cull.left)} left
              </div>
            )}
            {g.cull.hunters.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
                {g.cull.hunters.slice(0, 6).map((h) => (
                  <li key={h.name}>
                    {h.name} · {h.kills}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-white/75">
            Every island is quiet
            {g.nextCull !== null ? ` · for about ${clock(g.nextCull)}` : ""}.
          </p>
        )}
      </section>

      {mine && (
        <section>
          <h3 className={heading}>Your contract</h3>
          <div className="mt-2 flex items-center justify-between gap-4 border border-white/40 p-3">
            <div className="min-w-0">
              <div className="text-[15px]">{mine.title}</div>
              <div className="mt-0.5 text-[12px] text-white/80">
                {mine.island ? `Try ${mine.island}. ` : ""}
                {mine.note}
              </div>
              <div className="mt-1 font-mono text-[11px] tracking-[0.12em] text-white/80 tabular-nums">
                {mine.have}/{mine.need} carcasses · pays {mine.reward} ◎
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                variant="outline"
                size="hud-xs"
                disabled={mine.have < mine.need || far}
                onClick={() => props.game.turnIn()}
              >
                Hand in
              </Button>
              <Button variant="outline" size="hud-xs" onClick={() => props.game.abandonContract()}>
                Give up
              </Button>
            </div>
          </div>
        </section>
      )}

      <section>
        <h3 className={heading}>Contracts</h3>
        <ul className="mt-2">
          {g.contracts.map((offer) => (
            <li
              key={offer.id}
              className="flex items-center justify-between gap-4 border-b border-white/15 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[14px]">{offer.title}</div>
                <div className="mt-0.5 text-[12px] text-white/75">
                  {RISK[offer.role]}
                  {offer.island ? ` · ${offer.island}` : ""}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[12px] tabular-nums">{offer.reward} ◎</span>
                <Button
                  variant="outline"
                  size="hud-xs"
                  disabled={!!mine || far}
                  onClick={() => props.game.acceptContract(offer.id)}
                >
                  Take
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {mine && <p className="mt-3 text-[12px] text-white/75">One contract at a time.</p>}
      </section>
    </PanelFrame>
  );
}

export function ShopPanel(props: { hud: HudState; game: Game }) {
  const sections = [...new Set(props.hud.shop.map((e) => e.section))];
  return (
    <PanelFrame
      title="The keeper's stall"
      aside={<Coins coins={props.hud.inv.coins} />}
      onClose={() => props.game.closePanel()}
    >
      <p className="text-[13px] text-white/80">
        Coins only come from bounties. Kits go in your pack; press B to build them.
      </p>
      {sections.map((section) => (
        <section key={section}>
          <h3 className={heading}>{section}</h3>
          <ul className="mt-2">
            {props.hud.shop
              .filter((e) => e.section === section)
              .map((e) => (
                <li
                  key={e.id}
                  className="flex items-center justify-between gap-4 border-b border-white/10 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-[14px]">
                      {e.name}
                      {!!e.owned && (
                        <span className="ml-2 font-mono text-[10px] text-white/80">
                          OWNED ×{e.owned}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-white/80">{e.note}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-mono text-[12px] tabular-nums">{e.price} ◎</span>
                    <Button
                      variant="outline"
                      size="hud-xs"
                      disabled={props.hud.inv.coins < e.price || !props.hud.nearShop}
                      onClick={() => props.game.buy(e.id)}
                    >
                      Buy
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </PanelFrame>
  );
}

/* Click to move one; shift-click moves them all. */
export function ChestPanel(props: { hud: HudState; game: Game }) {
  const moveAll = (e: React.MouseEvent, n: number) => (e.shiftKey ? n * 9999 : n);
  const pack = props.hud.inv.items.filter((i) => i.kind !== "kit");
  const chest = props.hud.chest ?? [];
  return (
    <PanelFrame title="Chest" onClose={() => props.game.closePanel()}>
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h3 className={heading}>In the chest</h3>
          {chest.length ? (
            <ul className="mt-2">
              {chest.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 border-b border-white/10 py-1.5"
                >
                  <span className="truncate text-[13px]">
                    {item.name}{" "}
                    <span className="font-mono text-[11px] text-white/80">×{item.count}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="hud-xs"
                    onClick={(e) => props.game.stash(item.id, -moveAll(e, 1))}
                  >
                    Take
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-white/80">Empty.</p>
          )}
        </section>
        <section>
          <h3 className={heading}>In your pack</h3>
          {pack.length ? (
            <ul className="mt-2">
              {pack.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-2 border-b border-white/10 py-1.5"
                >
                  <span className="truncate text-[13px]">
                    {item.name}{" "}
                    <span className="font-mono text-[11px] text-white/80">×{item.count}</span>
                  </span>
                  <Button
                    variant="outline"
                    size="hud-xs"
                    onClick={(e) => props.game.stash(item.id, moveAll(e, 1))}
                  >
                    Store
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-white/80">Nothing to store.</p>
          )}
        </section>
      </div>
      <p className="text-[12px] text-white/80">Shift-click to move the lot.</p>
    </PanelFrame>
  );
}
