import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Game, HudState, ToolView } from "../../game/client/game";

const heading = "font-mono text-[10px] tracking-[0.3em] text-white/45 uppercase";

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
      <span className="mr-1.5 text-white/45">◎</span>
      {props.coins}
    </div>
  );
}

function ToolRow(props: { tool: ToolView; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <div className="min-w-0">
        <div className="truncate text-[13px]">{props.tool.name}</div>
        <div className="font-mono text-[10px] tracking-[0.12em] text-white/40 uppercase">
          {props.tool.wear === null
            ? "Never wears out"
            : `${Math.round(props.tool.wear * 100)}% left`}
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
    const free = inv.hotbar.findIndex((t, k) => k > 0 && !t && !inv.itemHotbar[k]);
    return free > 0 ? free : 1;
  })();
  return (
    <PanelFrame
      title="Pack"
      aside={<Coins coins={inv.coins} />}
      onClose={() => props.game.closePanel()}
    >
      <section>
        <h3 className={heading}>Crafting</h3>
        <div className="mt-2 flex items-center justify-between gap-4 border-b border-white/10 py-2">
          <div>
            <div className="text-[13px]">Stone axe</div>
            <div className="text-[11px] text-white/50">2 sticks · 2 stones · 1 dry fiber</div>
          </div>
          <Button
            variant="outline"
            size="hud-xs"
            onClick={() => props.game.craftAxe()}
            disabled={(
              [
                ["stick", 2],
                ["stone", 2],
                ["dry_fiber", 1],
              ] as const
            ).some(([id, count]) => (inv.items.find((item) => item.id === id)?.count ?? 0) < count)}
          >
            Craft
          </Button>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-white/10 py-2">
          <div>
            <div className="text-[13px]">Rowboat</div>
            <div className="text-[11px] text-white/50">8 wood · 4 dry fiber</div>
            <div className="text-[11px] text-white/40">
              Craft, then press B to place it on water.
            </div>
          </div>
          <Button
            variant="outline"
            size="hud-xs"
            onClick={() => props.game.craftBoat()}
            disabled={(
              [
                ["wood", 8],
                ["dry_fiber", 4],
              ] as const
            ).some(([id, count]) => (inv.items.find((item) => item.id === id)?.count ?? 0) < count)}
          >
            Craft
          </Button>
        </div>
      </section>
      <section>
        <h3 className={heading}>Hotbar</h3>
        <div className="mt-2 grid grid-cols-5 gap-1 sm:grid-cols-9" aria-label="Hotbar slots">
          {inv.hotbar.map((tool, slot) => {
            const item = inv.itemHotbar[slot];
            return (
              <div
                key={slot}
                className="relative flex min-h-16 flex-col justify-between border border-white/25 bg-white/5 p-1.5"
                title={slot === 0 ? "Fists" : (tool?.name ?? item?.name ?? "Empty")}
              >
                <span className="font-mono text-[10px] text-white/40">{slot + 1}</span>
                <span className="break-words text-[10px] leading-tight">
                  {slot === 0 ? "Fists" : (tool?.name ?? item?.name ?? "—")}
                </span>
                {item && <span className="text-right font-mono text-[10px]">×{item.count}</span>}
              </div>
            );
          })}
        </div>
        <ul className="mt-2">
          {inv.hotbar.map(
            (t, k) =>
              t && (
                <ToolRow key={t.id} tool={t}>
                  <span className="self-center font-mono text-[10px] text-white/40">{k + 1}</span>
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
          {inv.itemHotbar.map(
            (item, k) =>
              item && (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 border-b border-white/10 py-2"
                >
                  <span className="text-[13px]">
                    {item.name} ×{item.count}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-white/40">{k + 1}</span>
                    <Button
                      variant="outline"
                      size="hud-xs"
                      onClick={() => props.game.equipItem(item.id, -1)}
                    >
                      To pack
                    </Button>
                  </div>
                </li>
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
                {t.droppable && (
                  <Button variant="outline" size="hud-xs" onClick={() => props.game.drop(t.id)}>
                    Drop
                  </Button>
                )}
              </ToolRow>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-white/40">Nothing spare.</p>
        )}
      </section>
      <section>
        <h3 className={heading}>Catch and goods</h3>
        {inv.items.length ? (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {inv.items.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-2 border-b border-white/10 py-1.5"
              >
                <span className="truncate text-[13px]">{item.name}</span>
                <span className="font-mono text-[11px] text-white/60 tabular-nums">
                  ×{item.count}
                </span>
                {!inv.itemHotbar.some((entry) => entry?.id === item.id) && (
                  <Button
                    variant="outline"
                    size="hud-xs"
                    onClick={() => props.game.equipItem(item.id, target)}
                  >
                    To slot {target + 1}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-white/40">Empty. Go fishing.</p>
        )}
      </section>
    </PanelFrame>
  );
}

export function BoardPanel(props: { hud: HudState; game: Game }) {
  const b = props.hud.bounty;
  return (
    <PanelFrame
      title="Bounty board"
      aside={<Coins coins={props.hud.inv.coins} />}
      onClose={() => props.game.closePanel()}
    >
      {b && (
        <section>
          <h3 className={heading}>Your bounty</h3>
          <div className="mt-2 flex items-center justify-between gap-4 border border-white/30 p-3">
            <div className="min-w-0">
              <div className="text-[15px]">{b.title}</div>
              <div className="mt-0.5 text-[12px] text-white/50">{b.note}</div>
              <div className="mt-1 font-mono text-[11px] tracking-[0.12em] text-white/70 tabular-nums">
                {b.have}/{b.need} · pays {b.reward} ◎
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                variant="outline"
                size="hud-xs"
                disabled={b.have < b.need || !props.hud.nearBoard}
                onClick={() => props.game.turnIn()}
              >
                Hand in
              </Button>
              <Button variant="outline" size="hud-xs" onClick={() => props.game.abandonBounty()}>
                Abandon
              </Button>
            </div>
          </div>
        </section>
      )}
      <section>
        <h3 className={heading}>Posted</h3>
        <ul className="mt-2">
          {props.hud.board.map((offer) => (
            <li
              key={offer.id}
              className="flex items-center justify-between gap-4 border-b border-white/10 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[14px]">{offer.title}</div>
                <div className="mt-0.5 text-[12px] text-white/45">{offer.note}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="font-mono text-[12px] tabular-nums">{offer.reward} ◎</span>
                <Button
                  variant="outline"
                  size="hud-xs"
                  disabled={!!b || !props.hud.nearBoard}
                  onClick={() => props.game.acceptBounty(offer.id)}
                >
                  Take
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {b && <p className="mt-3 text-[12px] text-white/40">One bounty at a time.</p>}
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
      <p className="text-[13px] text-white/50">
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
                        <span className="ml-2 font-mono text-[10px] text-white/40">
                          OWNED ×{e.owned}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12px] text-white/45">{e.note}</div>
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
                    <span className="font-mono text-[11px] text-white/50">×{item.count}</span>
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
            <p className="mt-2 text-[13px] text-white/40">Empty.</p>
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
                    <span className="font-mono text-[11px] text-white/50">×{item.count}</span>
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
            <p className="mt-2 text-[13px] text-white/40">Nothing to store.</p>
          )}
        </section>
      </div>
      <p className="text-[12px] text-white/40">Shift-click to move the lot.</p>
    </PanelFrame>
  );
}
