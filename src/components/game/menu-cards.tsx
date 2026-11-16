import { CheckIcon, CircleNotchIcon, EnvelopeSimpleIcon, SignOutIcon } from "@phosphor-icons/react";
import { Fragment, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { PopoverTitle } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { isEmail, joinWaitlist, signOut } from "@/lib/auth";

/*
 * The small pointer from a menu card up to its button. The card sits a little
 * past the button's right edge, so the pointer lands under the button's icon.
 */
export function MenuPointer() {
  return (
    <span
      aria-hidden="true"
      className="absolute -top-[6px] right-[14px] size-[10px] rotate-45 rounded-tl-[2px] border-t border-l border-[#242424] bg-[#121212]"
    />
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
    ["Pick a tool", ["1–9", "Wheel"]],
    ["Open your pack", ["Tab", "I"]],
  ],
  [
    ["Build", ["B"]],
    ["Turn a piece", ["R"]],
    ["Take a piece back", ["RMB"]],
  ],
  [
    ["Creative mode", ["Shift+C"]],
    ["Take off, or drop", ["Space ×2"]],
    ["Fly flat out", ["W ×2"]],
  ],
];

const CONTROL_FOOT: [string, string][] = [
  ["C", "This card"],
  ["N", "Map"],
  ["M", "Mute"],
  ["Esc", "Pause"],
];

/* What goes inside the Controls tooltip. */
export function ControlsCard() {
  return (
    <>
      <h2 className={title}>Controls</h2>
      <p className={sub}>Getting by on the island</p>
      {CONTROL_GROUPS.map((rows, g) => (
        <Fragment key={rows[0][0]}>
          {g === 0 ? <div className="mt-3" /> : <Separator className="mt-2 mb-2" />}
          {rows.map(([action, keys]) => (
            <div
              key={action}
              className="flex items-center justify-between gap-3 py-[5px] text-[13px] text-[#d6d6d6]"
            >
              {action}
              <span className="flex gap-1">
                {keys.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </Fragment>
      ))}
      <Separator className="mt-3.5" />
      <div className="flex justify-between pt-3 text-xs text-[#8a8a8a]">
        {CONTROL_FOOT.map(([key, action]) => (
          <span key={key} className="flex items-center gap-1.5">
            <Kbd>{key}</Kbd>
            {action}
          </span>
        ))}
      </div>
    </>
  );
}

/*
 * What goes inside the waitlist popover, for guests. Nothing is emailed from
 * here: the address is kept, and invites go out by hand. The form and the note
 * after it share one grid cell, so the card keeps its size when it flips.
 * Joining shows the note right away; if the request fails, the form comes back
 * with the email still in it.
 */
export function AccessCard() {
  const input = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const done = status === "done";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (done || !isEmail(email)) return;
    setStatus("done");
    setError(null);
    /* Keep focus inside the card so it stays open on the note. */
    note.current?.focus();
    joinWaitlist(email).catch((err: unknown) => {
      setStatus("idle");
      setError(err instanceof Error ? err.message : "Couldn't sign you up. Try again.");
      input.current?.focus();
    });
  };

  return (
    <div className="grid">
      <form
        className={`[grid-area:1/1] px-[18px] pt-[18px] pb-[18px] ${done ? "invisible" : ""}`}
        onSubmit={submit}
      >
        <PopoverTitle>Join the waitlist</PopoverTitle>
        <label htmlFor="waitlist-email" className={`block ${sub}`}>
          It's invite only for now. Leave your email and you'll get an invite link when there's
          room.
        </label>
        <InputGroup className="mt-4">
          <InputGroupAddon>
            <EnvelopeSimpleIcon size={15} weight="fill" />
          </InputGroupAddon>
          <InputGroupInput
            ref={input}
            id="waitlist-email"
            type="email"
            name="email"
            required
            autoComplete="email"
            enterKeyHint="send"
            placeholder="you@example.com"
            value={email}
            aria-invalid={!!error}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              setError(null);
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" size="sm" disabled={!isEmail(email)}>
              Get invite
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {error ? (
          <p role="alert" className="mt-2.5 mb-0 text-xs text-[#8a8a8a]">
            {error}
          </p>
        ) : (
          <p className="mt-2.5 mb-0 text-xs text-[#5c5c5c]">
            Already invited? Open the link in your invite email.
          </p>
        )}
      </form>

      <div
        ref={note}
        tabIndex={-1}
        aria-live="polite"
        className={`flex flex-col items-center justify-center px-[18px] text-center [grid-area:1/1] focus:outline-none ${done ? "" : "invisible"}`}
      >
        {done && (
          <>
            <NoteIcon>
              <CheckIcon size={20} weight="bold" />
            </NoteIcon>
            <h2 className={title}>You're on the list</h2>
            <p className={`${sub} break-all`}>
              We'll send your invite link to{" "}
              <b className="font-bold text-[#d6d6d6]">{email.trim()}</b>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* Signed in, but not let in. Approval can come any time; the tab checks back. */
export function PendingCard(props: { email: string | null }) {
  return (
    <div className="px-[18px] pt-[18px] pb-4">
      <PopoverTitle>Not in yet</PopoverTitle>
      <p className={`${sub} break-all`}>
        You're signed in as <b className="font-bold text-[#d6d6d6]">{props.email}</b>, but this
        email hasn't been let onto the island yet. You'll hear from us when it is.
      </p>
      <SignOutRow note="Wrong account?" />
    </div>
  );
}

/* The player's own card, under their name in the title bar. */
export function PlayerCard(props: { username: string; email: string | null }) {
  return (
    <div className="px-[18px] pt-[18px] pb-4">
      <PopoverTitle className="break-all">{props.username}</PopoverTitle>
      <p className={`${sub} break-all`}>{props.email}</p>
      <SignOutRow note="Your island waits on the grand map" />
    </div>
  );
}

/*
 * Signing out means needing the invite link again to get back in, so it asks
 * once.
 */
function SignOutRow(props: { note: string }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Separator className="mt-3.5" />
      <div className="flex items-center justify-between gap-3 pt-3 text-xs text-[#8a8a8a]">
        {sure ? "You'll need your invite link to get back in" : props.note}
        <Button
          variant="link"
          size="bare"
          className="gap-1"
          disabled={busy}
          onBlur={() => setSure(false)}
          onClick={() => {
            if (!sure) {
              setSure(true);
              return;
            }
            setBusy(true);
            void signOut().finally(() => {
              setBusy(false);
              setSure(false);
            });
          }}
        >
          {busy ? <Spinner /> : <SignOutIcon size={13} weight="bold" />}
          {sure ? "Yes, sign out" : "Sign out"}
        </Button>
      </div>
    </>
  );
}

export function NoteIcon(props: { children: React.ReactNode }) {
  return (
    <div className="mb-3 grid size-[46px] place-items-center rounded-lg border border-[#333] bg-[#222] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
      {props.children}
    </div>
  );
}

export function Spinner() {
  return <CircleNotchIcon size={14} weight="bold" className="animate-spin" aria-label="Working" />;
}
