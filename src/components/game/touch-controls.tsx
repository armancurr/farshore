import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Input } from "../../game/client/input";

const RADIUS = 52;

/*
 * Phones get a stick on the left, look-by-dragging on the right, and three
 * buttons. All of it feeds the same Input the keyboard does.
 */
export function TouchControls(props: { input: Input }) {
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
          <div className="pointer-events-none absolute bottom-10 left-10 size-28 rounded-full border border-white/20" />
        )}
      </div>
      <div
        className="absolute inset-y-0 right-0 w-1/2"
        onPointerDown={lookDown}
        onPointerMove={lookMove}
        onPointerUp={lookUp}
        onPointerCancel={lookUp}
      />
      <div className="pointer-events-none absolute right-5 bottom-8 grid grid-cols-2 gap-3">
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto"
          {...hold((on) => input.setAlt(on))}
        >
          Block
        </Button>
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto"
          {...hold((on) => input.setAttack(on))}
        >
          Attack
        </Button>
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto h-10 w-full"
          onPointerDown={() => input.press("interact")}
        >
          Use
        </Button>
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto h-10 w-full"
          onPointerDown={() => input.press("inventory")}
        >
          Pack
        </Button>
        <Button
          variant="touch"
          size="touch"
          className="pointer-events-auto col-span-2 w-full"
          {...hold((on) => input.setJumpHeld(on))}
        >
          Jump
        </Button>
      </div>
    </div>
  );
}
