import { cn } from "cn";
import { useEffect, useState } from "react";

/*
 * The one waiting screen the whole site uses. It comes down over whatever is
 * there, says something short while the world catches up, and lifts again.
 *
 * Two backdrops: "sky" is the island's own sky over its own sea, for when
 * there's nothing drawn behind it yet (the page loading), so lifting it
 * hands straight over to the scene. "night" is a fade to black, for crossing
 * from one place to another (going ashore).
 */

export type CurtainBackdrop = "sky" | "night";

/* How long the curtain takes to come down or lift, in ms. Kept in step with index.css. */
export const CURTAIN_FADE = 900;

/* Lines while the island is first drawn. */
export const SETTING_SAIL = [
  "Painting the sky",
  "Filling the sea",
  "Raising the islands",
  "Planting the trees",
  "Waking the gulls",
] as const;

/* Lines while you're rowed ashore. */
export const GOING_ASHORE = [
  "Rowing you ashore",
  "Shooing crabs off the beach",
  "Counting the waves",
  "Tying up the boat",
  "Asking the tide nicely",
  "Folding the map back up",
] as const;

const pick = (lines: readonly string[]) => lines[Math.floor(Math.random() * lines.length)] ?? "";

export function Curtain(props: {
  show: boolean;
  backdrop: CurtainBackdrop;
  /* One of these is said each time it comes down. */
  lines?: readonly string[];
  /* Say exactly this instead, and hold still (an error, say). */
  message?: string;
  /* Already down when first drawn: nothing was behind it to fade from. */
  instant?: boolean;
  className?: string;
}) {
  const { show, lines } = props;
  const [mounted, setMounted] = useState(show);
  const [line, setLine] = useState(() => pick(lines ?? []));

  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), CURTAIN_FADE);
    return () => clearTimeout(timer);
  }, [show]);

  /* A fresh line each time it comes down again. */
  useEffect(() => {
    if (!mounted) setLine(pick(lines ?? []));
  }, [mounted, lines]);

  if (!mounted) return null;
  const text = props.message ?? line;
  const still = props.message !== undefined;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!show}
      className={cn(
        "curtain absolute inset-0 z-[60] flex items-center justify-center select-none",
        props.backdrop === "sky" ? "curtain-sky" : "bg-black",
        !props.instant && "curtain-in",
        !show && "curtain-lift pointer-events-none",
        props.className,
      )}
    >
      <div
        className={cn(
          "flex flex-col items-center gap-3 px-6 text-center",
          !props.instant && "curtain-words",
        )}
      >
        <div className="font-sans text-sm leading-none font-bold text-white [text-shadow:0_1px_12px_rgb(0_0_0/0.25)]">
          {text}
          {!still && <Ellipsis />}
        </div>
        {!still && <Wave />}
      </div>
    </div>
  );
}

/* Three dots that fill in one by one; the width stays put so the line doesn't shift. */
function Ellipsis() {
  return (
    <span aria-hidden="true" className="inline-flex w-[1.1em]">
      <span className="curtain-dot">.</span>
      <span className="curtain-dot [animation-delay:200ms]">.</span>
      <span className="curtain-dot [animation-delay:400ms]">.</span>
    </span>
  );
}

/* A little swell rolling past under the words. */
function Wave() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 8" className="h-2 w-12 overflow-hidden text-white/70">
      <path
        className="curtain-wave"
        d="M0 4 Q6 0 12 4 T24 4 T36 4 T48 4 T60 4 T72 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
