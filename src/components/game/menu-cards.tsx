import { Check, EnvelopeSimple } from "phosphor-solid";
import { createSignal, For, type JSX, Show } from "solid-js";
import { isEmail, joinWaitlist } from "../../lib/waitlist";
import { Button } from "../ui/button";

/* A key drawn as a little keycap. */
export function Key(props: { children: JSX.Element }) {
  return (
    <kbd class="inline-flex h-6 min-w-6 items-center justify-center rounded-ui border border-[#333] bg-[#222] px-[7px] font-key text-[11px] font-medium text-[#ececec] not-italic shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      {props.children}
    </kbd>
  );
}

/*
 * A solid dark card hanging from a menu button, with a small pointer up to it.
 * It sits a little past the button's right edge so the pointer lands under the icon.
 */
export function MenuCard(props: {
  id?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      id={props.id}
      role={props.role}
      class={`relative rounded-[14px] border border-[#242424] bg-[#121212] font-sans text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)] ${props.class ?? ""}`}
    >
      <span
        aria-hidden="true"
        class="absolute -top-[6px] right-[14px] size-[10px] rotate-45 rounded-tl-[2px] border-t border-l border-[#242424] bg-[#121212]"
      />
      {props.children}
    </div>
  );
}

const title = "m-0 text-lg leading-tight font-bold text-white";
const sub = "mt-1.5 text-[13px] leading-normal text-[#8a8a8a]";

/* Each inner list is one group; the card draws a thin line between groups. */
const CONTROL_GROUPS: [string, string[]][][] = [
  [
    ["Walk around", ["W", "A", "S", "D"]],
    ["Jump", ["Space"]],
    ["Run", ["Shift"]],
  ],
  [
    ["Use what you hold", ["Click", "F"]],
    ["Grab, talk, open", ["E"]],
    ["Pick a tool", ["1–5", "Wheel"]],
    ["Open your pack", ["Tab", "I"]],
  ],
  [
    ["Build", ["B"]],
    ["Turn a piece", ["R"]],
    ["Take a piece back", ["RMB"]],
  ],
];

const CONTROL_FOOT: [string, string][] = [
  ["N", "Toggle music"],
  ["M", "Mute"],
  ["Esc", "Pause"],
];

export function ControlsCard(props: { id?: string }) {
  return (
    <MenuCard id={props.id} role="tooltip" class="w-[21rem] px-[18px] pt-[18px] pb-4">
      <h2 class={title}>Controls</h2>
      <p class={sub}>Getting by on the island</p>
      <For each={CONTROL_GROUPS}>
        {(rows) => (
          <div class="mt-2 border-t border-[#222] pt-2 first-of-type:mt-3 first-of-type:border-t-0 first-of-type:pt-0">
            <For each={rows}>
              {([action, keys]) => (
                <div class="flex items-center justify-between gap-3 py-[5px] text-[13px] text-[#d6d6d6]">
                  {action}
                  <span class="flex gap-1">
                    <For each={keys}>{(key) => <Key>{key}</Key>}</For>
                  </span>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
      <div class="mt-3.5 flex justify-between border-t border-[#222] pt-3 text-xs text-[#8a8a8a]">
        <For each={CONTROL_FOOT}>
          {([key, action]) => (
            <span class="flex items-center gap-1.5">
              <Key>{key}</Key>
              {action}
            </span>
          )}
        </For>
      </div>
    </MenuCard>
  );
}

/*
 * The form and the "you're on the list" note share one grid cell, so the card
 * keeps its size when it flips between them. Joining shows the note right
 * away; if the send fails, the form comes back with the email still in it.
 */
export function WaitlistCard(props: { id?: string }) {
  let input: HTMLInputElement | undefined;
  let note: HTMLDivElement | undefined;
  const [email, setEmail] = createSignal("");
  const [status, setStatus] = createSignal<"idle" | "done" | "error">("idle");
  const done = () => status() === "done";

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (done() || !isEmail(email())) return;
    setStatus("done");
    /* Keep focus inside the card so it stays open on the note. */
    note?.focus();
    joinWaitlist(email()).catch((error) => {
      console.error(error);
      setStatus("error");
      input?.focus();
    });
  };

  return (
    <MenuCard id={props.id} class="grid w-[min(20rem,calc(100vw-1.5rem))]">
      <form
        class="[grid-area:1/1] px-[18px] pt-[18px] pb-[18px]"
        classList={{ invisible: done() }}
        onSubmit={submit}
      >
        <h2 class={title}>Join the waitlist</h2>
        <label for="waitlist-email" class={`block ${sub}`}>
          You will get an invite when the game is done.
        </label>
        <div class="mt-4 flex h-[42px] items-center gap-2.5 rounded-ui border border-[#2a2a2a] bg-[#0a0a0a] pr-1.5 pl-3 text-[#5c5c5c] transition-colors focus-within:border-[#4a4a4a]">
          <EnvelopeSimple size={15} weight="fill" class="flex-none" />
          <input
            ref={input}
            id="waitlist-email"
            type="email"
            name="email"
            required
            autocomplete="email"
            enterkeyhint="send"
            placeholder="you@example.com"
            value={email()}
            onInput={(e) => {
              setEmail(e.currentTarget.value);
              if (status() === "error") setStatus("idle");
            }}
            class="h-full min-w-0 flex-1 bg-transparent font-sans text-[13px] text-white placeholder:text-[#5c5c5c] focus:outline-none"
          />
          <Button type="submit" size="sm" disabled={!isEmail(email())}>
            Get invite
          </Button>
        </div>
        <Show when={status() === "error"}>
          <p class="mt-2.5 mb-0 text-xs text-[#8a8a8a]">Couldn't sign you up. Try again.</p>
        </Show>
      </form>

      <div
        ref={note}
        tabIndex={-1}
        aria-live="polite"
        class="flex flex-col items-center justify-center px-[18px] text-center [grid-area:1/1] focus:outline-none"
        classList={{ invisible: !done() }}
      >
        <Show when={done()}>
          <div class="mb-3 grid size-[46px] place-items-center rounded-ui border border-[#333] bg-[#222] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
            <Check size={20} weight="bold" />
          </div>
          <h2 class={title}>You're on the list</h2>
          <p class={`${sub} break-all`}>
            We'll send your invite to <b class="font-bold text-[#d6d6d6]">{email().trim()}</b>
          </p>
        </Show>
      </div>
    </MenuCard>
  );
}
