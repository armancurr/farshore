import {
  AnchorIcon,
  ArrowUpRightIcon,
  AxeIcon,
  BedIcon,
  BoatIcon,
  CampfireIcon,
  HammerIcon,
  HandFistIcon,
  HeartIcon,
  HouseIcon,
  HouseLineIcon,
  type Icon,
  KnifeIcon,
  LightningIcon,
  MoonIcon,
  ShieldIcon,
  StarFourIcon,
  SwordIcon,
  TreasureChestIcon,
  WavesIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { Button, buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HudState } from "../../game/client/game";
import type { KitId, ToolKind } from "../../game/shared/items";

const TOOL_ICONS: Record<ToolKind, Icon> = {
  daggers: KnifeIcon,
  sickle: MoonIcon,
  machete: KnifeIcon,
  boardaxe: AxeIcon,
  spear: ArrowUpRightIcon,
  trident: WavesIcon,
  mace: StarFourIcon,
  halberd: AxeIcon,
  axe: AxeIcon,
  greatsword: SwordIcon,
  hammer: HammerIcon,
  shield: ShieldIcon,
};

const KIT_ICONS: Record<KitId, Icon> = {
  campfire: CampfireIcon,
  chest: TreasureChestIcon,
  bed: BedIcon,
  hut: HouseIcon,
  cabin: HouseLineIcon,
  dock: AnchorIcon,
  rowboat: BoatIcon,
  desertbike: LightningIcon,
};

/* The little number in a slot's corner; it darkens on the bright selected slot. */
function SlotKey(props: { n: number }) {
  return (
    <span className="absolute top-0.5 left-1 font-key text-[9px] leading-none text-white/80 group-data-[selected=true]/button:text-black/45">
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
 * What the keys and mouse do right now: building, flying, rowing, or the
 * thing in hand. Phones only get the building line; they have their own buttons.
 */
export function controlHint(hud: HudState, touch: boolean) {
  const build = hud.build;
  if (build) {
    if (build.target) return `Right-click to take back the ${build.target.toLowerCase()}`;
    return build.ok ? "Click to place" : (build.reason ?? "Look at the ground");
  }
  return touch ? null : hud.hint;
}

/*
 * The bottom bar: one dark card with your health and the nine things you can
 * hold. The one in hand is the bright slot. In build mode the slots become
 * the kits you own. On a desktop the control hints sit top left (see Hud);
 * on phones the belt is up top, so the building line stays with it.
 */
export function Belt(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  const { hud, touch } = props;
  const build = hud.build;
  const status = touch ? controlHint(hud, touch) : null;

  return (
    <div className="flex flex-col items-center gap-2">
      {status && <div className="font-sans text-xs font-bold text-white/70">{status}</div>}
      <div className="pointer-events-auto rounded-[14px] border border-[#242424] bg-[#121212]/90 px-2 pt-[9px] pb-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]">
        <Vitals hud={hud} />
        <div className={cn("flex gap-1", !touch && "sm:gap-1.5")}>
          {build
            ? build.kits.map((kit, i) => {
                const KitIcon = KIT_ICONS[kit.id];
                return (
                  <div
                    key={kit.id}
                    title={kit.name}
                    data-selected={build.index === i}
                    className={cn(
                      buttonVariants({ variant: "slot", size: "slot" }),
                      /* Phones: small slots, so the belt fits between the corners. */
                      touch && "sm:size-[34px]",
                    )}
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
                const ToolIcon = i === 0 ? HandFistIcon : tool ? TOOL_ICONS[tool.kind] : null;
                const selected = hud.inv.slot === i;
                return (
                  <Button
                    key={i}
                    variant="slot"
                    size="slot"
                    className={cn(touch && "sm:size-[34px]")}
                    aria-label={i === 0 ? "Fists" : (tool?.name ?? `Empty slot ${i + 1}`)}
                    title={i === 0 ? "Fists" : tool?.name}
                    aria-pressed={selected}
                    data-selected={selected}
                    onClick={() => props.onSelect(i)}
                  >
                    <SlotKey n={i + 1} />
                    {ToolIcon && <ToolIcon size={18} weight="fill" />}
                  </Button>
                );
              })}
        </div>
      </div>
      {build && !touch && (
        <div className="font-sans text-[11px] text-white/80">
          1–{build.kits.length} or wheel to choose · R to turn · B when done
        </div>
      )}
    </div>
  );
}
