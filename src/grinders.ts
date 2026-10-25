/**
 * Grinder information for Fellow Ode Gen 2 (stock 64mm flat burrs) with Aiden.
 *
 * Research-based settings optimized for milk-forward brewing:
 * - Batch basket: Ode 8.0-8.2 (medium-coarse, like rough sea salt)
 * - Cone basket: Ode 5.0-5.3 (medium, like table salt, similar to V60)
 *
 * Ode Gen 2 dial: 1 (finest) to 11 (coarsest) with 0.1 increments.
 * 1 click past a number = +0.1 (e.g., 1 click past 8 = 8.1, 2 clicks = 8.2)
 *
 * Settings verified against Fellow's recommendations and community testing.
 */

export const GRINDER_NAME = "Fellow Ode Gen 2 (stock burrs)";
export const SUPPORTED_GRINDERS = [GRINDER_NAME];

// Recommended ranges for milk-forward brewing
export const BATCH_BASKET_RANGE = { min: 8.0, max: 8.2 };
export const CONE_BASKET_RANGE = { min: 5.0, max: 5.3 };
