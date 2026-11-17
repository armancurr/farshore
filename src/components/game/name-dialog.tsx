import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { CheckIcon, UserIcon, XIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  USERNAME,
  claimUsername,
  cleanUsername,
  suggestUsername,
  usernameAvailable,
} from "@/lib/auth";
import { Spinner } from "./menu-cards";

type Check = "short" | "checking" | "free" | "taken" | "error";

/*
 * The one-time name picker. It opens by itself the first time an approved
 * player arrives without a name, comes prefilled with a guess from their
 * email, and checks each name as it's typed, so most people only press Enter.
 */
export function NameDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => suggestUsername(props.email));
  const [check, setCheck] = useState<Check>("short");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The email can arrive after the first render; seed the guess once it does. */
  const seeded = useRef(name !== "");
  useEffect(() => {
    if (seeded.current || !props.email) return;
    seeded.current = true;
    setName((current) => current || suggestUsername(props.email));
  }, [props.email]);

  /* Ask the island whether the name is free, a beat after typing stops. */
  useEffect(() => {
    if (name.length < USERNAME.min) {
      setCheck("short");
      return;
    }
    setCheck("checking");
    let stale = false;
    const timer = setTimeout(() => {
      usernameAvailable(name).then(
        (free) => !stale && setCheck(free ? "free" : "taken"),
        () => !stale && setCheck("error"),
      );
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [name]);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving || check !== "free") return;
    setSaving(true);
    setError(null);
    claimUsername(name).then(
      () => props.onOpenChange(false),
      (err: unknown) => {
        setSaving(false);
        setError(err instanceof Error ? err.message : "Couldn't save that name. Try again.");
        input.current?.select();
      },
    );
  };

  const hint =
    error ??
    {
      short: `${USERNAME.min}–${USERNAME.max} letters, numbers or underscores`,
      checking: "Checking the island…",
      free: "It's free",
      taken: "Taken. Try another",
      error: "Couldn't check that one. Keep typing or try again.",
    }[check];

  return (
    <DialogPrimitive.Root open={props.open} onOpenChange={(open) => props.onOpenChange(open)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 isolate z-50 bg-black/50 backdrop-blur-[3px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          initialFocus={input}
          className="fixed top-1/2 left-1/2 z-50 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-[14px] border border-[#242424] bg-[#121212] px-[18px] pt-[18px] pb-[18px] font-sans text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_48px_-16px_rgba(0,0,0,0.7),0_2px_6px_rgba(0,0,0,0.4)] outline-hidden duration-150 ease-out data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <DialogPrimitive.Close
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute top-3 right-3 text-[#8a8a8a] hover:text-white"
              />
            }
          >
            <XIcon size={14} weight="bold" />
            <span className="sr-only">Later</span>
          </DialogPrimitive.Close>
          <DialogPrimitive.Title className="m-0 text-lg leading-tight font-bold text-white">
            You're in. Pick a name
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1.5 text-[13px] leading-normal text-[#8a8a8a]">
            It's how the island will know you, and it's yours for good: names can't be changed.
          </DialogPrimitive.Description>

          <form onSubmit={submit} className="mt-4">
            <InputGroup>
              <InputGroupAddon>
                <UserIcon size={15} weight="fill" />
              </InputGroupAddon>
              <InputGroupInput
                ref={input}
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                maxLength={USERNAME.max}
                placeholder="your_name"
                aria-describedby="username-hint"
                aria-invalid={check === "taken" || !!error}
                value={name}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => {
                  setName(cleanUsername(e.currentTarget.value));
                  setError(null);
                }}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="sm"
                  disabled={check !== "free" || saving}
                >
                  {saving ? <Spinner /> : "Claim"}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <p
              id="username-hint"
              aria-live="polite"
              className={cn(
                "mt-2.5 mb-0 flex items-center gap-1.5 text-xs",
                check === "free" && !error ? "text-[#d6d6d6]" : "text-[#8a8a8a]",
              )}
            >
              {check === "free" && !error && <CheckIcon size={12} weight="bold" />}
              {hint}
            </p>
          </form>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
