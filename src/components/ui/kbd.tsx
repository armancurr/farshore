import { cn } from "cn";

/* shadcn's Kbd, drawn as the little dark keycap from the controls card. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-6 w-fit min-w-6 items-center justify-center gap-1 rounded-lg border border-[#333] bg-[#222] px-[7px] font-key text-[11px] font-medium text-[#ececec] not-italic shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] select-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
