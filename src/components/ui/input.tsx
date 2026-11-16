import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";

/* shadcn's Input, on the near-black field from the waitlist card. */

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-1 font-sans text-[13px] text-white transition-colors outline-none placeholder:text-[#5c5c5c] focus-visible:border-[#4a4a4a] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
