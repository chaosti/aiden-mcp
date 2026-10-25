/**
 * Grind-setting conversion for Fellow Ode Gen 2.
 *
 * The brewing heuristics are calibrated against a Baratza Encore (40-step
 * dial), so we convert from Encore to Ode Gen 2 using linear interpolation
 * between two anchor points (Encore 12 → Ode 4, Encore 20 → Ode 7).
 *
 * Ode Gen 2 dial moves in 1/3 steps (⅓, ⅔).
 */

export interface GrinderMatch {
  name: string;
  setting: string;
  note?: string;
}

/** Ode dials move in 1/3 steps — render 5.33 as "5⅓". */
function thirds(v: number): string {
  const whole = Math.floor(v + 1 / 6);
  const frac = Math.round((v - whole) * 3);
  if (frac <= 0) return `${whole}`;
  if (frac >= 3) return `${whole + 1}`;
  return `${whole}${frac === 1 ? "⅓" : "⅔"}`;
}

const GRINDER_NAME = "Fellow Ode Gen 2";
const ODE_LO = 4;  // Encore 12 equivalent
const ODE_HI = 7;  // Encore 20 equivalent

export const SUPPORTED_GRINDERS = [GRINDER_NAME];

/**
 * Convert an Encore setting to Fellow Ode Gen 2.
 * Always returns a result (no longer nullable since only one grinder is supported).
 */
export function convertGrind(encoreSetting: number): GrinderMatch {
  // Linear interpolation between Encore-12 and Encore-20 anchors
  const t = (encoreSetting - 12) / 8;
  const value = ODE_LO + t * (ODE_HI - ODE_LO);
  return {
    name: GRINDER_NAME,
    setting: thirds(value)
  };
}
