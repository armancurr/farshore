import { createSignal } from "solid-js";
import type { Input } from "../../game/client/input";

/*
 * Phones get a stick on the left, look-by-dragging on the right, and three
 * buttons. All of it feeds the same Input the keyboard does.
 */
export function TouchControls(props: { input: Input }) {
  const [knob, setKnob] = createSignal<{ x: number; y: number; ox: number; oy: number } | null>(
    null,
  );
  let stickId: number | null = null;
  let lookId: number | null = null;
  let lastLook = { x: 0, y: 0 };
  const RADIUS = 52;

  const stickDown = (e: PointerEvent) => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setKnob({ x: 0, y: 0, ox: e.clientX, oy: e.clientY });
  };
  const stickMove = (e: PointerEvent) => {
    const k = knob();
    if (e.pointerId !== stickId || !k) return;
    let dx = e.clientX - k.ox;
    let dy = e.clientY - k.oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob({ ...k, x: dx, y: dy });
    props.input.setStick(dx / RADIUS, dy / RADIUS, len > RADIUS * 1.15);
  };
  const stickUp = (e: PointerEvent) => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    setKnob(null);
    props.input.setStick(0, 0, false);
  };

  const lookDown = (e: PointerEvent) => {
    if (lookId !== null) return;
    lookId = e.pointerId;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lastLook = { x: e.clientX, y: e.clientY };
  };
  const lookMove = (e: PointerEvent) => {
    if (e.pointerId !== lookId) return;
    props.input.look(e.clientX - lastLook.x, e.clientY - lastLook.y, 1.6);
    lastLook = { x: e.clientX, y: e.clientY };
  };
  const lookUp = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = null;
  };

  const button =
    "pointer-events-auto flex size-16 items-center justify-center rounded-full border border-white/40 bg-black/40 font-mono text-[10px] tracking-[0.15em] text-white uppercase active:bg-white active:text-black";

  return (
    <div class="absolute inset-0 touch-none select-none">
      <div
        class="absolute inset-y-0 left-0 w-1/2"
        onPointerDown={stickDown}
        onPointerMove={stickMove}
        onPointerUp={stickUp}
        onPointerCancel={stickUp}
      >
        {(() => {
          const k = knob();
          return k ? (
            <div
              class="pointer-events-none absolute size-28 -translate-1/2 rounded-full border border-white/30"
              style={{ left: `${k.ox}px`, top: `${k.oy}px`, position: "fixed" }}
            >
              <div
                class="absolute top-1/2 left-1/2 size-10 rounded-full bg-white/80"
                style={{ transform: `translate(calc(-50% + ${k.x}px), calc(-50% + ${k.y}px))` }}
              />
            </div>
          ) : (
            <div class="pointer-events-none absolute bottom-10 left-10 size-28 rounded-full border border-white/20" />
          );
        })()}
      </div>
      <div
        class="absolute inset-y-0 right-0 w-1/2"
        onPointerDown={lookDown}
        onPointerMove={lookMove}
        onPointerUp={lookUp}
        onPointerCancel={lookUp}
      />
      <div class="pointer-events-none absolute right-5 bottom-8 grid grid-cols-2 gap-3">
        <button
          type="button"
          class={button}
          onPointerDown={() => props.input.setAlt(true)}
          onPointerUp={() => props.input.setAlt(false)}
          onPointerCancel={() => props.input.setAlt(false)}
          onPointerLeave={() => props.input.setAlt(false)}
        >
          Block
        </button>
        <button
          type="button"
          class={button}
          onPointerDown={() => props.input.setAttack(true)}
          onPointerUp={() => props.input.setAttack(false)}
          onPointerCancel={() => props.input.setAttack(false)}
          onPointerLeave={() => props.input.setAttack(false)}
        >
          Attack
        </button>
        <button
          type="button"
          class={`${button} h-10 w-full`}
          onPointerDown={() => props.input.press("interact")}
        >
          Use
        </button>
        <button
          type="button"
          class={`${button} h-10 w-full`}
          onPointerDown={() => props.input.press("inventory")}
        >
          Pack
        </button>
        <button
          type="button"
          class={`${button} col-span-2 w-full`}
          onPointerDown={() => props.input.setJumpHeld(true)}
          onPointerUp={() => props.input.setJumpHeld(false)}
          onPointerCancel={() => props.input.setJumpHeld(false)}
          onPointerLeave={() => props.input.setJumpHeld(false)}
        >
          Jump
        </button>
      </div>
    </div>
  );
}
