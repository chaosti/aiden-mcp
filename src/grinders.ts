/**
 * Grind-setting conversion for Fellow Ode Gen 2 with Aiden.
 *
 * Based on Fellow's official Aiden grind recommendations:
 * - Batch basket (flat-bottom): Setting 8-10 (medium-coarse, like rough sea salt)
 * - Cone/V60: Setting 4-5 (medium, finer than batch)
 *
 * Ode Gen 2 dial: 1 (finest) to 11 (coarsest) with 1/3 step increments (⅓, ⅔).
 *
 * Internal reference scale maintained for compatibility with brewing guidelines.
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
// Updated anchor points based on Fellow's Aiden recommendations:
// Encore 13-14 (cone) → Ode 4-5, Encore 15-16 (batch) → Ode 8-9
const ODE_BATCH_LO = 8;    // Encore 15 → Ode 8 (batch basket)
const ODE_BATCH_HI = 9;    // Encore 16 → Ode 9 (batch basket)
const ODE_CONE_LO = 4;     // Encore 13 → Ode 4 (cone basket)
const ODE_CONE_HI = 5;     // Encore 14 → Ode 5 (cone basket)

export const SUPPORTED_GRINDERS = [GRINDER_NAME];

/**
 * Convert an Encore setting to Fellow Ode Gen 2.
 * Always returns a result (no longer nullable since only one grinder is supported).
 */
export function convertGrind(encoreSetting: number): GrinderMatch {
  // Direct mapping based on Fellow's verified Aiden settings
  // Encore 13-14 (cone) or 15-16 (batch)
  let value: number;

  if (encoreSetting <= 14) {
    // Cone basket range (Encore 13-14 → Ode 4-5)
    const t = (encoreSetting - 13) / 1;
    value = ODE_CONE_LO + t * (ODE_CONE_HI - ODE_CONE_LO);
  } else {
    // Batch basket range (Encore 15-16 → Ode 8-9)
    const t = (encoreSetting - 15) / 1;
    value = ODE_BATCH_LO + t * (ODE_BATCH_HI - ODE_BATCH_LO);
  }

  return {
    name: GRINDER_NAME,
    setting: thirds(value)
  };
}
