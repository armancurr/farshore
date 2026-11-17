import type * as THREE from "three";
import type { Team } from "../../shared/catalogue";
import { type CrewSnap, nameFromIndex, skinFromIndex, TEAM_TAG } from "../../shared/crew";
import { clamp, lerp } from "../../shared/math";
import { FLAG } from "../../shared/protocol";
import type { SeatPose } from "../../shared/drive";
import { weaponFromIndex } from "../../shared/weapons";
import { Avatar } from "./avatars";

/*
 * Everyone's crews, as you see them: the same characters players are, eased
 * between snapshots the same way, with each man's name over his head in his
 * land's colours ("Bram · Arman's crew"). Only the men near you are sent,
 * so a man who stops coming is put away.
 */

type Sample = { t: number; x: number; y: number; z: number; yaw: number; flags: number };

type Shown = { avatar: Avatar; buf: Sample[]; plot: number; seen: number; label: string };

/* Who a plot's men answer to, and in what colours. */
export type CrewLabel = { owner: string; team: Team; mine: boolean };

/* Seats on the vehicles as they're drawn, so a man aboard rides with the hull. */
export type Seats = {
  riderPose(id: number): SeatPose | null;
  riderHidden(id: number): boolean;
};

export class CrewsView {
  private shown = new Map<number, Shown>();
  private snaps = 0;

  constructor(
    private scene: THREE.Scene,
    private labelOf: (plot: number) => CrewLabel | null,
  ) {}

  get(id: number) {
    return this.shown.get(id) ?? null;
  }

  /* The avatars on show, for the crosshair. */
  list() {
    return this.shown.values();
  }

  set(snaps: readonly CrewSnap[], time: number) {
    this.snaps++;
    for (const [id, plot, x, y, z, yaw, flags, weapon, stagger, skin, name] of snaps) {
      let s = this.shown.get(id);
      const who = this.labelOf(plot);
      const label = who ? `${nameFromIndex(name)} · ${who.owner}'s crew` : nameFromIndex(name);
      if (!s) {
        const avatar = new Avatar(id, label, skinFromIndex(skin));
        avatar.group.visible = false;
        this.scene.add(avatar.group);
        s = { avatar, buf: [], plot, seen: 0, label };
        this.shown.set(id, s);
      }
      s.seen = this.snaps;
      s.avatar.setSkin(skinFromIndex(skin));
      s.avatar.setGear(weaponFromIndex(weapon), stagger);
      s.avatar.setRaider((flags & FLAG.raider) !== 0);
      s.avatar.setTag(label, who ? TEAM_TAG[who.team] : "#fff");
      s.buf.push({ t: time, x, y, z, yaw, flags });
      if (s.buf.length > 12) s.buf.shift();
    }
    /* Out of sight: put away. */
    for (const [id, s] of this.shown) {
      if (s.seen === this.snaps) continue;
      this.scene.remove(s.avatar.group);
      s.avatar.dispose();
      this.shown.delete(id);
    }
  }

  /* Eased between the two snapshots either side of `t`, or seated where the vehicle is drawn. */
  update(dt: number, t: number, camera: THREE.Vector3, seats: Seats) {
    for (const [id, s] of this.shown) {
      const buf = s.buf;
      if (!buf.length) continue;
      let a = buf[0];
      let b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= t) {
          a = buf[i];
          b = buf[Math.min(i + 1, buf.length - 1)];
          break;
        }
      }
      const span = b.t - a.t;
      const k = span > 0 ? clamp((t - a.t) / span, 0, 1) : 1;
      let dyaw = b.yaw - a.yaw;
      if (dyaw > Math.PI) dyaw -= Math.PI * 2;
      if (dyaw < -Math.PI) dyaw += Math.PI * 2;
      const av = s.avatar;
      const seat = seats.riderPose(id);
      av.group.visible = !(seat && seats.riderHidden(id));
      if (seat) av.setPose(seat.x, seat.y, seat.z, seat.yaw, 0, b.flags | FLAG.riding, dt, camera);
      else
        av.setPose(
          lerp(a.x, b.x, k),
          lerp(a.y, b.y, k),
          lerp(a.z, b.z, k),
          a.yaw + dyaw * k,
          0,
          b.flags,
          dt,
          camera,
        );
    }
  }

  clear() {
    for (const s of this.shown.values()) {
      this.scene.remove(s.avatar.group);
      s.avatar.dispose();
    }
    this.shown.clear();
  }
}
