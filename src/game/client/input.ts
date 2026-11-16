/* One-shot actions; "Up" ones fire on release, so held attacks can charge. */
export type Action =
  | "jump"
  | "attack"
  | "attackUp"
  | "alt"
  | "altUp"
  | "interact"
  | "inventory"
  | "build"
  | "rotate"
  | "creative"
  /* Creative: take off or come down (the touch button for a double tap of Space). */
  | "fly";

/*
 * Keyboard and mouse while the pointer is locked, plus a small API the touch
 * controls in the HUD call into. One-shot actions queue until the game reads them.
 */
export class Input {
  yaw = 0;
  pitch = 0;
  sensitivity = 0.0022;
  private keys = new Set<string>();
  private queued = new Set<Action>();
  private stick = { x: 0, y: 0 };
  private touchSprint = false;
  private holdJump = false;
  /* Touch: the Down button while flying. */
  private holdDown = false;
  private holdAttack = false;
  private holdAlt = false;
  /* The last number key pressed (0-based), and mouse-wheel steps, until read. */
  private digit: number | null = null;
  private wheel = 0;
  /* W tapped twice quickly and still held: flying flat out. */
  private boostHeld = false;
  private lastForwardTap = 0;
  private cleanup: (() => void)[] = [];

  constructor(private target: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      el: Window | Document = window,
    ) => {
      el.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => el.removeEventListener(type, fn as EventListener));
    };

    on("keydown", (e) => {
      if (!this.locked) return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === "KeyF") this.setAttack(true);
      if (e.code === "KeyE") this.queued.add("interact");
      if (e.code === "Tab" || e.code === "KeyI") this.queued.add("inventory");
      if (e.code === "KeyB") this.queued.add("build");
      /* ⌘R / Ctrl+R is the reload key, which the island menu catches. */
      if (e.code === "KeyR" && !e.metaKey && !e.ctrlKey) this.queued.add("rotate");
      if (e.code === "KeyC" && e.shiftKey) this.queued.add("creative");
      if (e.code === "KeyW" || e.code === "ArrowUp") {
        const now = performance.now();
        this.boostHeld = now - this.lastForwardTap < 300;
        this.lastForwardTap = now;
      }
      if (/^Digit[1-9]$/.test(e.code)) this.digit = Number(e.code.slice(5)) - 1;
      if (e.code === "Tab") e.preventDefault();
      if (e.code === "Space") this.queued.add("jump");
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    on("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyF") this.setAttack(false);
      if (!this.has("KeyW", "ArrowUp")) this.boostHeld = false;
    });
    on("blur", () => {
      this.keys.clear();
      this.boostHeld = false;
      this.setAttack(false);
      this.setAlt(false);
    });
    on("mousemove", (e) => {
      if (!this.locked) return;
      this.look(e.movementX, e.movementY);
    });
    on("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.setAttack(true);
      if (e.button === 2) this.setAlt(true);
    });
    on("mouseup", (e) => {
      if (e.button === 0) this.setAttack(false);
      if (e.button === 2) this.setAlt(false);
    });
    on("wheel", (e) => {
      if (this.locked && Math.abs(e.deltaY) > 0) this.wheel += Math.sign(e.deltaY);
    });
    on("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });
  }

  get locked() {
    return document.pointerLockElement === this.target;
  }

  lock() {
    const el = this.target as HTMLElement & {
      requestPointerLock: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    };
    try {
      const result = el.requestPointerLock({ unadjustedMovement: true });
      if (result instanceof Promise) result.catch(() => el.requestPointerLock());
    } catch {
      el.requestPointerLock();
    }
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  look(dx: number, dy: number, scale = 1) {
    /* Browsers occasionally report a huge jump when the lock engages. */
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    this.yaw -= dx * this.sensitivity * scale;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * this.sensitivity * scale));
  }

  /* Dev/test only: hold a key code as if pressed. */
  hold(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }

  press(action: Action) {
    this.queued.add(action);
  }

  /* Primary attack: press queues a swing (or starts a charge), release lets it go. */
  setAttack(down: boolean) {
    if (down === this.holdAttack) return;
    this.holdAttack = down;
    this.queued.add(down ? "attack" : "attackUp");
  }

  /* Secondary: block with a shield. */
  setAlt(down: boolean) {
    if (down === this.holdAlt) return;
    this.holdAlt = down;
    this.queued.add(down ? "alt" : "altUp");
  }

  get attackHeld() {
    return this.holdAttack;
  }

  get altHeld() {
    return this.holdAlt;
  }

  setStick(x: number, y: number, sprint: boolean) {
    this.stick = { x, y };
    this.touchSprint = sprint;
  }

  setJumpHeld(held: boolean) {
    this.holdJump = held;
  }

  setDownHeld(held: boolean) {
    this.holdDown = held;
  }

  /* A number key pressed since the last read, 0-based. */
  takeDigit() {
    const d = this.digit;
    this.digit = null;
    return d;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  take(action: Action) {
    const had = this.queued.has(action);
    this.queued.delete(action);
    return had;
  }

  clear() {
    this.keys.clear();
    this.boostHeld = false;
    this.queued.clear();
    this.digit = null;
    this.wheel = 0;
    this.stick = { x: 0, y: 0 };
    this.touchSprint = false;
    this.holdJump = false;
    this.holdDown = false;
    this.holdAttack = false;
    this.holdAlt = false;
  }

  get forward() {
    const k = (this.has("KeyW", "ArrowUp") ? 1 : 0) - (this.has("KeyS", "ArrowDown") ? 1 : 0);
    return k || -this.stick.y;
  }

  get right() {
    const k = (this.has("KeyD", "ArrowRight") ? 1 : 0) - (this.has("KeyA", "ArrowLeft") ? 1 : 0);
    return k || this.stick.x;
  }

  get sprint() {
    return this.has("ShiftLeft", "ShiftRight") || this.touchSprint;
  }

  /* Double-tap W (and hold it) to go flat out; on a phone, push the stick past its edge. */
  get boost() {
    return (this.boostHeld && this.has("KeyW", "ArrowUp")) || this.touchSprint;
  }

  /* Flying down: Shift on a keyboard, the Down button on a phone. */
  get descend() {
    return this.has("ShiftLeft", "ShiftRight") || this.holdDown;
  }

  get jumpHeld() {
    return this.has("Space") || this.holdJump;
  }

  get down() {
    return this.has("ControlLeft");
  }

  private has(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  dispose() {
    for (const fn of this.cleanup) fn();
    this.unlock();
  }
}
