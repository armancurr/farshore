import {
  ArrowUpRightIcon,
  AxeIcon,
  BombIcon,
  CloudFogIcon,
  CrosshairIcon,
  DropIcon,
  FireIcon,
  HammerIcon,
  HandFistIcon,
  HeartIcon,
  type Icon,
  KnifeIcon,
  LightningIcon,
  LineVerticalIcon,
  MagicWandIcon,
  ShieldChevronIcon,
  ShieldIcon,
  ShieldWarningIcon,
  SparkleIcon,
  StarFourIcon,
  TargetIcon,
  FlameIcon,
  SwordIcon,
} from "@phosphor-icons/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { HudState } from "../../game/client/game";
import type { ToolKind } from "../../game/shared/items";

const TOOL_ICONS: Record<ToolKind, Icon> = {
  daggers: KnifeIcon,
  "dagger-b": KnifeIcon,
  knuckles: HandFistIcon,
  "fistweapon-b": HandFistIcon,
  cutlass: SwordIcon,
  "sword-a": SwordIcon,
  "sword-b": SwordIcon,
  "axe-a": AxeIcon,
  beardaxe: AxeIcon,
  mallet: HammerIcon,
  "hammer-c": HammerIcon,
  morningstar: StarFourIcon,
  spear: ArrowUpRightIcon,
  halberd: AxeIcon,
  "staff-a": LineVerticalIcon,
  axe: AxeIcon,
  "sword-d": SwordIcon,
  greatsword: SwordIcon,
  hammer: HammerIcon,
  "bow-a": TargetIcon,
  "bow-b": TargetIcon,
  "wand-a": MagicWandIcon,
  "staff-b": SparkleIcon,
  shield: ShieldIcon,
  "shield-a": ShieldIcon,
  kite: ShieldChevronIcon,
  spiked: ShieldWarningIcon,
  torch: FireIcon,
  bucket: DropIcon,
  crossbow: CrosshairIcon,
  firebow: FlameIcon,
  keg: BombIcon,
  smokebomb: CloudFogIcon,
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
 * The bottom bar: one dark card with your health and the nine things you can
 * hold. The one in hand is the bright slot. On a desktop the control hints
 * sit top left (see Hud).
 */
export function Belt(props: { hud: HudState; touch: boolean; onSelect: (i: number) => void }) {
  const { hud, touch } = props;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="pointer-events-auto rounded-[14px] border border-[#242424] bg-[#121212]/90 px-2 pt-[9px] pb-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)]">
        <Vitals hud={hud} />
        <div className={cn("flex gap-1", !touch && "sm:gap-1.5")}>
          {hud.inv.hotbar.map((tool, i) => {
            const ToolIcon = i === 0 ? HandFistIcon : tool ? TOOL_ICONS[tool.kind] : null;
            const selected = hud.inv.slot === i;
            return (
              <Button
                key={i}
                variant="slot"
                size="slot"
                /* Phones: small slots, so the belt fits between the corners. */
                className={cn(touch && "sm:size-[34px]")}
                aria-label={i === 0 ? "Fists" : (tool?.name ?? `Empty slot ${i + 1}`)}
                title={i === 0 ? "Fists" : tool?.name}
                aria-pressed={selected}
                data-selected={selected}
                onClick={() => props.onSelect(i)}
              >
                <SlotKey n={i + 1} />
                {ToolIcon && <ToolIcon size={18} weight="fill" />}
                {tool?.count != null && (
                  <span className="absolute right-1 bottom-0.5 font-sans text-[10px] leading-none font-extrabold tabular-nums group-data-[selected=true]/button:text-black/70">
                    {tool.count}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
