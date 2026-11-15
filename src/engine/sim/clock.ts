/**
 * Simulated time (build.md §8 Phase 2).
 *
 * The engine advances in fixed ticks. A tick is always 15 simulated seconds, whatever the speed;
 * speed only changes how many ticks run per real second (1× = 4 ticks/s, so 1 real second =
 * 1 simulated minute). State therefore depends only on the tick count and the command log, never
 * on wall-clock time or speed, which keeps replays deterministic.
 */
export const TICK_HZ = 4;
export const MINUTES_PER_TICK = 0.25;

/** The simulation opens on Monday at 08:40, just before the morning login rush. */
export const START_MINUTE = 8 * 60 + 40;

export const SPEEDS = [1, 4, 16] as const;
export type Speed = (typeof SPEEDS)[number];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const DAY = 24 * 60;

export const minuteOfTick = (tick: number): number => START_MINUTE + tick * MINUTES_PER_TICK;

/** Minutes since midnight of the current day. */
export const timeOfDay = (minute: number): number => ((minute % DAY) + DAY) % DAY;

export const dayIndex = (minute: number): number => Math.floor(minute / DAY) % 7;

export const isWeekend = (minute: number): boolean => dayIndex(minute) >= 5;

export function formatClock(minute: number): { day: string; time: string } {
  const m = Math.floor(timeOfDay(minute));
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return { day: DAYS[dayIndex(minute)]!, time: `${hh}:${mm}` };
}

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const h = (hours: number) => hours * 60;

/**
 * Office activity in [0, 1] for a time of day: a ramp up 07:30–08:45, a lunch dip
 * 12:00–13:30 (to ~55%), a ramp down 17:15–18:30, and near zero overnight and at weekends.
 */
export function workdayCurve(minute: number): number {
  const floor = 0.03;
  if (isWeekend(minute)) return floor;
  const t = timeOfDay(minute);
  const on = smooth(h(7.5), h(8.75), t) * (1 - smooth(h(17.25), h(18.5), t));
  const lunch = 1 - 0.45 * smooth(h(12), h(12.4), t) * (1 - smooth(h(13.1), h(13.5), t));
  return floor + (1 - floor) * on * lunch;
}

/**
 * 1 inside a nightly window [start, end) given in hours (may wrap past midnight), with a
 * 10-minute ramp at each edge so traffic does not snap on and off.
 */
export function windowCurve(minute: number, startHour: number, endHour: number): number {
  const t = timeOfDay(minute);
  const s = h(startHour);
  // A window that wraps midnight is evaluated on an unrolled two-day axis.
  const e = h(endHour) + (endHour <= startHour ? DAY : 0);
  const ramp = 10;
  const inside = (x: number) => smooth(s, s + ramp, x) * (1 - smooth(e - ramp, e, x));
  return Math.max(inside(t), inside(t + DAY));
}
