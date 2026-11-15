const label = "font-mono text-[10px] tracking-[0.3em] text-white/40 uppercase";
const link =
  "text-white underline decoration-white/25 underline-offset-4 transition-colors hover:decoration-white";

/* The right third: who I am, where I work, where to find me, and what's on the left. */
export function Profile(props: { onPress?: () => void }) {
  return (
    <div class="flex min-h-full flex-col gap-10 px-6 py-10 sm:px-10 lg:py-12">
      <header class="flex items-center gap-3">
        <img src="/Frame 2.png" alt="" class="size-9 object-contain grayscale" />
        <div>
          <div class="text-[15px] font-semibold tracking-tight text-white">Arman Kar</div>
          <div class="text-[13px] text-white/50">Software developer</div>
        </div>
      </header>

      <section class="space-y-4 text-[15px] leading-6 text-white/80">
        <p>
          I thrive on building clear, practical interfaces at the application layer, where humans
          meet software. Most of my work is on the frontend, shaping how products behave rather than
          just how they look.
        </p>
        <p>
          Find my work on{" "}
          <a
            class={link}
            href="https://github.com/armancurr"
            target="_blank"
            rel="noreferrer"
            onPointerDown={props.onPress}
          >
            GitHub
          </a>{" "}
          and follow me on{" "}
          <a
            class={link}
            href="https://twitter.com/rrucnamra"
            target="_blank"
            rel="noreferrer"
            onPointerDown={props.onPress}
          >
            Twitter
          </a>
          .
        </p>
      </section>

      <section class="space-y-3">
        <h2 class={label}>Now</h2>
        <div>
          <div class="flex flex-wrap items-baseline justify-between gap-x-4 text-[15px]">
            <span class="font-semibold text-white">
              Full-Stack Engineer,{" "}
              <a
                class={link}
                href="https://onesol.in"
                target="_blank"
                rel="noreferrer"
                onPointerDown={props.onPress}
              >
                OneSol AI Labs
              </a>
            </span>
            <span class="font-mono text-[11px] text-white/40">Dec 2025 — Present</span>
          </div>
          <p class="mt-2 text-[14px] leading-6 text-white/60">
            Built a hiring tool to rethink how teams discover, evaluate, and move candidates through
            the process. Focused on practical product flows, reliable interfaces, and the systems
            behind them.
          </p>
        </div>
      </section>

      <section class="mt-auto space-y-3 border-t border-white/10 pt-8">
        <h2 class={label}>
          <span class="hidden lg:inline">On the left</span>
          <span class="lg:hidden">Above</span>
        </h2>
        <p class="text-[14px] leading-6 text-white/60">
          <span class="text-white">Rising Tide</span>, a small multiplayer game I built for this
          page. Everyone here shares one island; bots fill the empty places. The sea climbs, you
          climb faster. Written from scratch with three.js and SolidJS, with a Cloudflare Durable
          Object keeping the tide.
        </p>
      </section>
    </div>
  );
}
