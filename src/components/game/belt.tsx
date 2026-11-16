import {
  AnchorIcon,
  ArrowUpRightIcon,
  AxeIcon,
  BedIcon,
  BoatIcon,
  CampfireIcon,
  FishSimpleIcon,
  LeafIcon,
  MountainsIcon,
  HammerIcon,
  HandFistIcon,
  HeartIcon,
  HouseIcon,
  HouseLineIcon,
  type Icon,
  KnifeIcon,
  LightningIcon,
  LinkSimpleIcon,
  ShieldIcon,
  ShovelIcon,
  SwordIcon,
  TreasureChestIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HudState } from "../../game/client/game";
import type { KitId, ToolKind } from "../../game/shared/items";

const TOOL_ICONS: Record<ToolKind, Icon> = {
  rod: ArrowUpRightIcon,
  rod2: ArrowUpRightIcon,
  sword: SwordIcon,
  sword2: SwordIcon,
  axe: AxeIcon,
  axe2: AxeIcon,
  spear: ArrowUpRightIcon,
  spear2: ArrowUpRightIcon,
  hammer: HammerIcon,
  pickaxe: ShovelIcon,
  daggers: KnifeIcon,
  shield: ShieldIcon,
  flail: LinkSimpleIcon,
};

const KIT_ICONS: Record<KitId, Icon> = {
  campfire: CampfireIcon,
  chest: TreasureChestIcon,
  bed: BedIcon,
  hut: HouseIcon,
  cabin: HouseLineIcon,
  dock: AnchorIcon,
  rowboat: BoatIcon,
};

/* The little number in a slot's corner; it darkens on the bright selected slot. */
function SlotKey(props: { n: number }) {
  return (
    <span className="absolute top-0.5 left-1 font-key text-[9px] leading-none text-[#5c5c5c] group-data-[selected=true]/button:text-black/45">
      {props.n}
    </span>
  );
}

/* One labelled meter: an icon, a rounded bar, and the number. */
function Meter(props: { label: string; icon: Icon; value: number; low?: boolean; dim?: boolean }) {
  const MeterIcon = props.icon;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <MeterIcon size={12} weight="fill" className={cn("shrink-0", props.low && "animate-pulse")} />
      <Progress
        aria-label={props.label}
        value={props.value}
        className="flex-1"
        trackClassName="h-[5px] rounded-full bg-[#262626]"
        indicatorClassName={cn(
          "rounded-full transition-[width] duration-200",
          props.dim ? "bg-[#8a8a8a]" : "bg-[#f2f2f2]",
        )}
      />
      <span className="min-w-[3ch] text-right font-sans text-xs font-extrabold tabular-nums">
        {Math.ceil(props.value)}
      </span>
    </div>
  );
}

/* Health and stamina, side by side across the top of the belt. */
function Vitals(props: { hud: HudState }) {
  const health = Math.max(0, Math.min(100, props.hud.health));
  const stamina = Math.max(0, Math.min(100, props.hud.stamina * 100));
  return (
    <div className="flex items-center gap-4 px-[3px] pb-2">
      <Meter label="Health" icon={HeartIcon} value={health} low={health < 25} />
      <Meter label="Stamina" icon={LightningIcon} value={stamina} dim={stamina < 25} />
    </div>
  );
}

/*
 * The bottom bar: one dark card with your health and the nine things you can
 * hold. The one in hand is the bright slot. In build mode the slots become
 * the kits you own.
 */
export function Belt(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  const { hud, touch } = props;
  const build = hud.build;
  const status = build
    ? build.target
      ? `Right-click to take back the ${build.target.toLowerCase()}`
      : build.ok
        ? "Click to place"
        : (build.reason ?? "Look at the ground")
    : touch
      ? null
      : hud.hint;

  return (
    <div className="flex flex-col items-center gap-2">
      {status && <div className="font-sans text-xs font-bold text-white/70">{status}</div>}
      <div className="pointer-events-auto rounded-[14px] border border-[#242424] bg-[#121212]/90 px-2 pt-[9px] pb-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]">
        <Vitals hud={hud} />
        <div className="flex gap-1 sm:gap-1.5">
          {build
            ? build.kits.map((kit, i) => {
                const KitIcon = KIT_ICONS[kit.id];
                return (
                  <div
                    key={kit.id}
                    title={kit.name}
                    data-selected={build.index === i}
                    className={buttonVariants({ variant: "slot", size: "slot" })}
                  >
                    <SlotKey n={i + 1} />
                    <KitIcon size={18} weight="fill" />
                    <span className="absolute right-1 bottom-0.5 font-key text-[9px] leading-none opacity-60">
                      {kit.count}
                    </span>
                  </div>
                );
              })
            : hud.inv.hotbar.map((tool, i) => {
                const item = hud.inv.itemHotbar[i];
                const ItemIcon =
                  item?.kind === "fish"
                    ? FishSimpleIcon
                    : item?.id === "stick"
                      ? ArrowUpRightIcon
                      : item?.id === "stone"
                        ? MountainsIcon
                        : LeafIcon;
                const ToolIcon = i === 0 ? HandFistIcon : tool ? TOOL_ICONS[tool.kind] : null;
                const selected = hud.inv.slot === i;
                return (
                  <Button
                    key={i}
                    variant="slot"
                    size="slot"
                    aria-label={
                      i === 0
                        ? "Fists"
                        : (tool?.name ??
                          (item
                            ? `${item.name}, ${item.count} in inventory`
                            : `Empty slot ${i + 1}`))
                    }
                    title={i === 0 ? "Fists" : (tool?.name ?? item?.name)}
                    aria-pressed={selected}
                    data-selected={selected}
                    onClick={() => props.onSelect(i)}
                  >
                    <SlotKey n={i + 1} />
                    {tool && (tool.kind === "rod" || tool.kind === "rod2") ? (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 21 16 4c1.5-2 3.5-2 4-1" />
                        <path d="M20 3v11c0 3-4 3-4 0v-1" />
                        <path d="m3 19 3 2M7 15l2 1.5" />
                        <circle cx="8" cy="18" r="2" />
                      </svg>
                    ) : item ? (
                      <ItemIcon size={18} weight="fill" />
                    ) : (
                      ToolIcon && <ToolIcon size={18} weight="fill" />
                    )}
                    {item && (
                      <span className="absolute bottom-0.5 right-1 text-[10px] tabular-nums">
                        {item.count}
                      </span>
                    )}
                    {tool?.wear != null && (
                      <Progress
                        aria-label={`${tool.name} wear`}
                        value={tool.wear * 100}
                        className="absolute inset-x-1.5 bottom-1"
                        trackClassName="h-[2px] rounded-full bg-current/15"
                        indicatorClassName="rounded-full bg-current/60"
                      />
                    )}
                  </Button>
                );
              })}
        </div>
      </div>
      {build && !touch && (
        <div className="font-sans text-[11px] text-white/45">
          1–{build.kits.length} or wheel to choose · R to turn · B when done
        </div>
      )}
    </div>
  );
}
