import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Action, Input } from "../../game/client/input";
import { CREATIVE, type CameraView } from "../../game/client/modes";

const RADIUS = 52;

/*
 * Phones get a stick on the left (push it past its edge to run, or rush when
 * flying), look-by-dragging on the right, and thumb buttons for everything the
 * keyboard does. The buttons follow what you're about: building swaps Block
 * and Attack for Take and Place, flying swaps Block for Down. All of it feeds
 * the same Input the keyboard does.
 */
export function TouchControls(props: {
  input: Input;
  creative: boolean;
  flying: boolean;
  building: boolean;
  view: CameraView;
}) {
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lastLook = useRef({ x: 0, y: 0 });
  const origin = useRef({ x: 0, y: 0 });
  const { input } = props;

  const stickDown = (e: React.PointerEvent<HTMLElement>) => {
    if (stickId.current !== null) return;
    stickId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    origin.current = { x: e.clientX, y: e.clientY };
    setKnob({ x: 0, y: 0, ox: e.clientX, oy: e.clientY });
  };
  const stickMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerId !== stickId.current) return;
    const { x: ox, y: oy } = origin.current;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob({ x: dx, y: dy, ox, oy });
    input.setStick(dx / RADIUS, dy / RADIUS, len > RADIUS * 1.15);
  };
  const stickUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerId !== stickId.current) return;
    stickId.current = null;
    setKnob(null);
    input.setStick(0, 0, false);
  };

  const lookDown = (e: React.PointerEvent<HTMLElement>) => {
    if (lookId.current !== null) return;
    lookId.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    lastLook.current = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerId !== lookId.current) return;
    input.look(e.clientX - lastLook.current.x, e.clientY - lastLook.current.y, 1.6);
    lastLook.current = { x: e.clientX, y: e.clientY };
  };
  const lookUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  /* A button held down: on while the thumb is on it, off however it leaves. */
  const hold = (set: (on: boolean) => void) => ({
    onPointerDown: () => set(true),
    onPointerUp: () => set(false),
    onPointerCancel: () => set(false),
    onPointerLeave: () => set(false),
  });
  /* A one-off press, as a key would queue it. */
  const tap = (action: Action) => ({ onPointerDown: () => input.press(action) });

  const { creative, flying, building, view } = props;

  /*
   * A button that goes away under a thumb (Block turning into Down, or the
   * whole set hiding when you go down) never hears it lift: let go for it.
   */
  useEffect(
    () => () => {
      input.setAttack(false);
      input.setAlt(false);
      input.setDownHeld(false);
      input.setJumpHeld(false);
    },
    [input, building, flying],
  );
  useEffect(() => () => input.setStick(0, 0, false), [input]);
  const big = "pointer-events-auto";
  const small = "pointer-events-auto h-10 w-full";
  const side = "pointer-events-auto h-10 w-[4.5rem] text-[9px] tracking-[0.12em]";

  /* What the two big thumb buttons do depends on what you're about. */
  const thumbs = building ? (
    <>
      <Button variant="touch" size="touch" className={big} {...hold((on) => input.setAlt(on))}>
        Take
      </Button>
      <Button variant="touch" size="touch" className={big} {...hold((on) => input.setAttack(on))}>
        Place
      </Button>
      <Button variant="touch" size="touch" className={small} {...tap("rotate")}>
        Turn
      </Button>
      <Button variant="touch" size="touch" className={small} {...tap("build")}>
        Done
      </Button>
    </>
  ) : (
    <>
      {flying ? (
        <Button
          variant="touch"
          size="touch"
          className={big}
          {...hold((on) => input.setDownHeld(on))}
        >
          Down
        </Button>
      ) : (
        <Button variant="touch" size="touch" className={big} {...hold((on) => input.setAlt(on))}>
          Block
        </Button>
      )}
      <Button variant="touch" size="touch" className={big} {...hold((on) => input.setAttack(on))}>
        Attack
      </Button>
      <Button variant="touch" size="touch" className={small} {...tap("interact")}>
        Use
      </Button>
      <Button variant="touch" size="touch" className={small} {...tap("inventory")}>
        Pack
      </Button>
    </>
  );

  return (
    <div className="absolute inset-0 touch-none select-none">
      <div
        className="absolute inset-y-0 left-0 w-1/2"
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        {knob ? (
          <div
            className="pointer-events-none absolute size-28 -translate-1/2 rounded-full border border-white/30"
            style={{ left: `${knob.ox}px`, top: `${knob.oy}px`, position: "fixed" }}
          >
            <div
              className="absolute top-1/2 left-1/2 size-10 rounded-full bg-white/80"
              style={{
                transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))`,
              }}
            />
          </div>
        ) : (
          <div className="pointer-events-none absolute bottom-8 left-10 size-28 rounded-full border border-white/20" />
        )}
      </div>
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        onPointerDown={lookDown}
        onPointerMove={lookMove}
        onPointerUp={lookUp}
        onPointerCancel={lookUp}
      />
      {/* Modes, beside the thumb buttons: build, the camera, and (in dev) creative and taking off in it. */}
      <div className="pointer-events-none absolute right-[10.5rem] bottom-4 flex flex-col gap-2">
        {creative && !building && (
          <Button variant="touch" size="touch" className={side} {...tap("fly")}>
            {flying ? "Land" : "Fly"}
          </Button>
        )}
        {CREATIVE && (
          <Button
            variant="touch"
            size="touch"
            className={side}
            data-on={creative}
            {...tap("creative")}
          >
            {creative ? "Survival" : "Creative"}
          </Button>
        )}
        <Button
          variant="touch"
          size="touch"
          className={side}
          data-on={view === "third"}
          aria-label={view === "third" ? "First-person view" : "Third-person view"}
          {...tap("view")}
        >
          {view === "third" ? "1st person" : "3rd person"}
        </Button>
        {!building && (
          <Button variant="touch" size="touch" className={side} {...tap("build")}>
            Build
          </Button>
        )}
      </div>
      <div className="pointer-events-none absolute right-5 bottom-4 grid grid-cols-2 gap-2.5">
        {thumbs}
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto col-span-2 w-full"
          {...hold((on) => {
            input.setJumpHeld(on);
            /* A tap counts as well, so a quick double tap takes off in creative too. */
            if (on) input.press("jump");
          })}
        >
          {flying ? "Up" : "Jump"}
        </Button>
      </div>
    </div>
  );
}
