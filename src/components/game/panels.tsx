import { For, type JSX, Show } from "solid-js";
import type { Game, HudState, ToolView } from "../../game/client/game";

const button =
  "border border-white/40 px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] uppercase hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-30";

const heading = "font-mono text-[10px] tracking-[0.3em] text-white/45 uppercase";

/* The frame every panel shares: a title, a close button, and its body. */
export function PanelFrame(props: {
  title: string;
  aside?: JSX.Element;
  onClose: () => void;
  children: JSX.Element;
}) {
  return (
    <div class="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 p-4">
      <div class="flex max-h-[90%] w-[min(100%,680px)] flex-col border border-white/25 bg-black/90">
        <div class="flex items-center justify-between gap-4 border-b border-white/15 px-5 py-3.5">
          <div class="font-mono text-[12px] tracking-[0.3em] uppercase">{props.title}</div>
          <div class="flex items-center gap-4">
            {props.aside}
            <button type="button" class={button} onClick={() => props.onClose()}>
              Close
            </button>
          </div>
        </div>
        <div class="space-y-6 overflow-y-auto px-5 py-5">{props.children}</div>
      </div>
    </div>
  );
}

export function Coins(props: { coins: number }) {
  return (
    <div class="font-mono text-[12px] tracking-[0.15em] tabular-nums">
      <span class="mr-1.5 text-white/45">◎</span>
      {props.coins}
    </div>
  );
}

function ToolRow(props: { tool: ToolView; children: JSX.Element }) {
  return (
    <li class="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <div class="min-w-0">
        <div class="truncate text-[13px]">{props.tool.name}</div>
        <div class="font-mono text-[10px] tracking-[0.12em] text-white/40 uppercase">
          {props.tool.wear === null
            ? "Never wears out"
            : `${Math.round(props.tool.wear * 100)}% left`}
        </div>
      </div>
      <div class="flex shrink-0 gap-2">{props.children}</div>
    </li>
  );
}

export function InventoryPanel(props: { hud: HudState; game: Game }) {
  const inv = () => props.hud.inv;
  /* Equip into the selected slot, or the first free one. */
  const target = () => {
    const i = inv();
    if (i.slot > 0) return i.slot;
    const free = i.hotbar.findIndex((t, k) => k > 0 && !t);
    return free > 0 ? free : 1;
  };
  return (
    <PanelFrame
      title="Pack"
      aside={<Coins coins={inv().coins} />}
      onClose={() => props.game.closePanel()}
    >
      <section>
        <h3 class={heading}>Hotbar</h3>
        <ul class="mt-2">
          <For each={inv().hotbar}>
            {(tool, k) => (
              <Show when={tool}>
                {(t) => (
                  <ToolRow tool={t()}>
                    <span class="self-center font-mono text-[10px] text-white/40">{k() + 1}</span>
                    <button
                      type="button"
                      class={button}
                      onClick={() => props.game.equip(t().id, -1)}
                    >
                      To pack
                    </button>
                  </ToolRow>
                )}
              </Show>
            )}
          </For>
        </ul>
      </section>
      <section>
        <h3 class={heading}>In the pack</h3>
        <Show
          when={inv().pack.length}
          fallback={<p class="mt-2 text-[13px] text-white/40">Nothing spare.</p>}
        >
          <ul class="mt-2">
            <For each={inv().pack}>
              {(t) => (
                <ToolRow tool={t}>
                  <button
                    type="button"
                    class={button}
                    onClick={() => props.game.equip(t.id, target())}
                  >
                    To slot {target() + 1}
                  </button>
                  <Show when={t.droppable}>
                    <button type="button" class={button} onClick={() => props.game.drop(t.id)}>
                      Drop
                    </button>
                  </Show>
                </ToolRow>
              )}
            </For>
          </ul>
        </Show>
      </section>
      <section>
        <h3 class={heading}>Catch and goods</h3>
        <Show
          when={inv().items.length}
          fallback={<p class="mt-2 text-[13px] text-white/40">Empty. Go fishing.</p>}
        >
          <ul class="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            <For each={inv().items}>
              {(item) => (
                <li class="flex items-baseline justify-between gap-2 border-b border-white/10 py-1.5">
                  <span class="truncate text-[13px]">{item.name}</span>
                  <span class="font-mono text-[11px] text-white/60 tabular-nums">
                    ×{item.count}
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </PanelFrame>
  );
}
