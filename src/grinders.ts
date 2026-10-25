/**
 * Grind-setting conversion for Fellow Ode Gen 2 (stock 64mm flat burrs) with Aiden.
 *
 * Research-based settings optimized for milk-forward batch brewing:
 * - Batch basket: Ode 8.0-8.2 (light→medium, medium-coarse like rough sea salt)
 * - Cone basket: Ode 5.0-5.3 (light→medium, medium like table salt, similar to V60)
 *
 * Ode Gen 2 dial: 1 (finest) to 11 (coarsest) with 1/3 step increments (⅓, ⅔).
 * Settings verified against Fellow's recommendations and community testing.
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

const GRINDER_NAME = "Fellow Ode Gen 2 (stock burrs)";
// Research-verified anchor points for Aiden batch brewing:
// Reference 13-14 (cone) → Ode 5.0-5.3, Reference 15-16 (batch) → Ode 8.0-8.2
const ODE_BATCH_LO = 8.0;    // Reference 15 → Ode 8.0 (batch, light roast)
const ODE_BATCH_HI = 8.2;    // Reference 16 → Ode 8.2 (batch, medium roast)
const ODE_CONE_LO = 5.0;     // Reference 13 → Ode 5.0 (cone, light roast)
const ODE_CONE_HI = 5.3;     // Reference 14 → Ode 5.3 (cone, medium roast)

export const SUPPORTED_GRINDERS = [GRINDER_NAME];

/**
 * Convert internal reference setting to Fellow Ode Gen 2 (stock burrs).
 * Research-verified settings for Aiden batch brewing with milk.
 * Always returns a result (only one grinder supported).
 */
export function convertGrind(referenceSetting: number): GrinderMatch {
  // Research-based mapping for Aiden + Ode Gen 2 stock burrs
  // Reference 13-14 (cone) or 15-16 (batch)
  let value: number;

  if (referenceSetting <= 14) {
    // Cone basket range (Reference 13-14 → Ode 5.0-5.3)
    // Light roast 5.0, medium roast 5.3
    const t = (referenceSetting - 13) / 1;
    value = ODE_CONE_LO + t * (ODE_CONE_HI - ODE_CONE_LO);
  } else {
    // Batch basket range (Reference 15-16 → Ode 8.0-8.2)
    // Light roast 8.0, medium roast 8.2
    const t = (referenceSetting - 15) / 1;
    value = ODE_BATCH_LO + t * (ODE_BATCH_HI - ODE_BATCH_LO);
  }

  return {
    name: GRINDER_NAME,
    setting: thirds(value)
  };
}
