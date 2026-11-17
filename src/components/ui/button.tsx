import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/*
 * shadcn's Button, restyled for farshore. `default` is the solid light button
 * on the menu cards; `menu` is the bold title-bar link; the mono, uppercase
 * variants are the in-game panels; `slot` is the belt.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap outline-none select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "gap-2 rounded-lg border border-[#d4d4d4] bg-[#f2f2f2] font-sans font-extrabold text-[#0a0a0a] transition-[background-color,scale] duration-100 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#f2f2f2] disabled:active:scale-100",
        menu: "gap-1.5 rounded-sm font-sans leading-none font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white/60 disabled:cursor-not-allowed disabled:opacity-40 data-disabled:cursor-not-allowed data-disabled:opacity-40",
        ghost: "rounded-lg text-white hover:bg-white/10 focus-visible:bg-white/10",
        /* Thin white rule, fills white under the pointer. Panels and the pause menu. */
        outline:
          "border border-white/40 font-mono text-white uppercase hover:bg-white hover:text-black disabled:pointer-events-none disabled:opacity-30",
        /* The dark twin of default: the second choice next to a light button. */
        secondary:
          "gap-2 rounded-lg border border-[#2a2a2a] bg-[#1c1c1c] font-sans font-extrabold text-white transition-[background-color,scale] duration-100 hover:bg-[#242424] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.98]",
        /* Quiet text, for the less likely choice. */
        link: "font-sans text-xs font-bold text-white/80 transition-colors hover:text-white focus-visible:text-white",
        /* A belt slot. data-selected marks the one in hand: it turns bright. */
        slot: "relative rounded-lg bg-[#1c1c1c] text-white/90 transition-colors data-[selected=true]:bg-[#f2f2f2] data-[selected=true]:text-[#0a0a0a]",
        /* The round thumb buttons on phones. */
        touch:
          "rounded-full border border-white/40 bg-black/40 font-mono text-[10px] tracking-[0.15em] text-white uppercase active:bg-white active:text-black",
      },
      size: {
        default: "h-[42px] px-4 text-sm",
        sm: "h-[30px] px-3 text-[13px]",
        /* Sized by its text alone: the title-bar links. */
        inline: "text-[15px]",
        "hud-xs": "px-2.5 py-1 text-[10px] tracking-[0.18em]",
        /* Sized by its text alone, at the text's own size. */
        bare: "",
        slot: "size-[34px] sm:size-10",
        touch: "size-16",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
