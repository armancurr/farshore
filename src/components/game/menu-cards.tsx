import { CheckIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Fragment, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { PopoverTitle } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { isEmail, joinWaitlist } from "@/lib/waitlist";

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
];

const CONTROL_FOOT: [string, string][] = [
  ["C", "This card"],
  ["N", "Music"],
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
 * What goes inside the waitlist popover. The form and the "you're on the list"
 * note share one grid cell, so the card keeps its size when it flips between
 * them. Joining shows the note right away; if the send fails, the form comes
 * back with the email still in it.
 */
export function WaitlistCard() {
  const input = useRef<HTMLInputElement>(null);
  const note = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");
  const done = status === "done";

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (done || !isEmail(email)) return;
    setStatus("done");
    /* Keep focus inside the card so it stays open on the note. */
    note.current?.focus();
    joinWaitlist(email).catch((error) => {
      console.error(error);
      setStatus("error");
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
          You will get an invite when the game is done.
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
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              if (status === "error") setStatus("idle");
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" size="sm" disabled={!isEmail(email)}>
              Get invite
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {status === "error" && (
          <p className="mt-2.5 mb-0 text-xs text-[#8a8a8a]">Couldn't sign you up. Try again.</p>
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
            <div className="mb-3 grid size-[46px] place-items-center rounded-lg border border-[#333] bg-[#222] shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
              <CheckIcon size={20} weight="bold" />
            </div>
            <h2 className={title}>You're on the list</h2>
            <p className={`${sub} break-all`}>
              We'll send your invite to <b className="font-bold text-[#d6d6d6]">{email.trim()}</b>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
