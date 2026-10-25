/**
 * Flash brew (Japanese iced coffee) calculator for the Aiden.
 *
 * Flash brew = hot, concentrated brew directly onto ice. The Fellow app's
 * profile editor clamps ratios to 1:14-1:20, which can't express the
 * 1:9-1:12 hot concentrate flash brew needs — but that clamp is client-side
 * only. The API and device accept lower ratios (verified live 2026-06-11;
 * see validation.ts), so the default plan here is honest: set the profile
 * ratio to the true hot-concentrate ratio and the machine's displayed dose
 * and bloom-water sizing are simply correct.
 *
 * Passing machine_profile_ratio means "I'm brewing with an existing profile
 * at this ratio, don't change it" — that returns the classic workaround
 * every Aiden owner used before: dial in the hot-water volume, ignore the
 * dose the machine displays, add the real (larger) dose.
 *
 * Grounded in two published recipes:
 *   - Counter Culture flash brew guide: 1:17 total, ~27% ice, grind slightly
 *     finer than hot, keep brew time normal
 *   - Lance Hedrick's ultimate flash brew: 1:12 total, 25% ice, medium-fine
 *     grind, 93°C
 * Consensus encoded: 25-33% of total liquid as ice, grind ~2 settings finer
 * than the hot recipe, profile temps stay on the hot end for the roast (ice
 * halts extraction instantly, so bitterness risk is low).
 */

// No imports needed - direct Ode Gen 2 values used

export interface FlashBrewInput {
  dose_g?: number;
  target_volume_ml?: number;
  total_ratio?: number; // true ratio incl. ice melt; default 15
  ice_fraction?: number; // share of total liquid that is ice; default 0.3
  machine_profile_ratio?: number; // set ONLY to keep an existing profile's ratio → dose-trick plan
  grinder?: string;
}

export interface FlashBrewPlan {
  lines: string[];
  warnings: string[];
}

const round5 = (v: number) => Math.round(v / 5) * 5;

// The validation.ts ratio floor — below this the profile can't be created.
const RATIO_FLOOR = 8;

export function flashBrewPlan(input: FlashBrewInput): FlashBrewPlan {
  const warnings: string[] = [];
  const totalRatio = input.total_ratio ?? 15;
  const iceFraction = input.ice_fraction ?? 0.3;

  if (!input.dose_g && !input.target_volume_ml) {
    return {
      lines: ["Need either dose_g (coffee you want to use) or target_volume_ml (final drink size) to plan a flash brew."],
      warnings: [],
    };
  }

  const targetDose = input.dose_g ?? (input.target_volume_ml ?? 0) / totalRatio;
  const total = targetDose * totalRatio;
  // The Aiden's volume dial moves in 10ml steps, so the hot water must land
  // on one. Ice is weighed on a scale and absorbs the remainder, keeping the
  // total (and therefore the true ratio) exact.
  const hot = Math.round((total * (1 - iceFraction)) / 10) * 10;
  const rawHotRatio = hot / targetDose;

  if (iceFraction < 0.2 || iceFraction > 0.4) {
    warnings.push(
      `Ice fraction ${Math.round(iceFraction * 100)}% is outside the 25-33% band the published recipes use. Less ice risks a lukewarm drink; more dilutes the concentrate past what the tighter ratio compensates for.`,
    );
  }
  if (hot < 150) {
    warnings.push(
      `Hot water volume (${hot}ml) is below the Aiden's 150ml minimum. Raise the dose, raise total_ratio, or lower ice_fraction.`,
    );
  }
  if (hot > 1500) {
    warnings.push(`Hot water volume (${hot}ml) exceeds the Aiden's 1500ml max. Split into two brews.`);
  }
  if (rawHotRatio < RATIO_FLOOR) {
    warnings.push(
      `Effective hot ratio 1:${rawHotRatio.toFixed(1)} is very concentrated — below ~1:8 the bed can stall with a fine grind, and 1:8 is the profile ratio floor. The plan uses 1:8; lower ice_fraction or open total_ratio for the intended strength.`,
    );
  }

  // Grind: hot pourover baseline is Ode 8.0; flash brew goes finer to compensate for ice dilution
  // For flash brew: Ode 5.0 (3 settings finer than hot batch baseline)
  const flashGrind = 5.0;
  const grindLine = `Grind: Fellow Ode Gen 2 at ${flashGrind.toFixed(1)} (about 3 settings finer than hot batch baseline of 8.0). Cold dilution mutes aromatics, so the finer grind and extra extraction keeps the cup from tasting hollow.`;

  // ---- Dose-trick path: the user is keeping an existing profile's ratio ----
  if (input.machine_profile_ratio !== undefined) {
    const machineRatio = input.machine_profile_ratio;
    const dose = targetDose;
    const ice = round5(total - hot);
    const displayedDose = hot / machineRatio;

    if (dose > 40) {
      warnings.push(
        `${Math.round(dose)}g will crowd the single-serve basket. Use the batch basket (and batch pulse settings) for doses this size.`,
      );
    }

    const lines = [
      `Flash brew plan (${Math.round(dose)}g coffee, 1:${totalRatio} true ratio, ${Math.round(iceFraction * 100)}% ice) — dose-trick variant for your existing 1:${machineRatio} profile:`,
      "",
      `1. Put ${ice}g of ice in the carafe BEFORE brewing. The Aiden brews straight onto it, Japanese style, and the melt is part of your brew water.`,
      `2. Dial the brew volume to ${hot}ml on the machine.`,
      `3. The machine will say to add ~${displayedDose.toFixed(1)}g of coffee (based on your 1:${machineRatio} profile). Ignore it. Add your actual ${Math.round(dose)}g.`,
      `4. ${grindLine}`,
      `5. Profile setup: keep temps on the hot end for the roast (or +1°C) and set bloomRatio to 3. The machine sizes bloom water from the dose it BELIEVES (${displayedDose.toFixed(1)}g), not your real ${Math.round(dose)}g, so without the max multiplier the bloom won't saturate the bed. Ice stops extraction the moment coffee hits it, so the usual bitterness worry doesn't apply.`,
      `6. Swirl the carafe when it finishes and serve over fresh ice.`,
      "",
      `What the machine thinks: ${hot}ml at 1:${machineRatio} = a normal brew.`,
      `What you actually get: ${hot}ml over ${Math.round(dose)}g = a 1:${(hot / dose).toFixed(1)} hot concentrate, melting out to ~${Math.round(total)}g total = your 1:${totalRatio} drink.`,
      "",
      `Tip: the Aiden accepts profile ratios below the app's 1:14 minimum (down to 1:${RATIO_FLOOR} via create_profile/update_profile). Omit machine_profile_ratio for a plan where the displayed dose and bloom sizing are real — no trick needed.`,
    ];
    return { lines, warnings };
  }

  // ---- Honest path (default): profile ratio = true hot-concentrate ratio ----
  // Profile ratios move in 0.5 steps, so round and re-derive the dose from
  // hot/profileRatio — that makes the machine-displayed dose exactly the dose
  // to add, at the cost of drifting a fraction of a gram from the requested
  // dose. The true total ratio is preserved by re-sizing the ice.
  const profileRatio = Math.min(20, Math.max(RATIO_FLOOR, Math.round(rawHotRatio * 2) / 2));
  const dose = hot / profileRatio;
  const honestTotal = dose * totalRatio;
  const ice = round5(honestTotal - hot);

  if (dose > 40) {
    warnings.push(
      `${Math.round(dose)}g will crowd the single-serve basket. Use the batch basket (and batch pulse settings) for doses this size.`,
    );
  }

  const lines = [
    `Flash brew plan (${dose.toFixed(1)}g coffee, 1:${totalRatio} true ratio, ${Math.round(iceFraction * 100)}% ice):`,
    "",
    `1. Set your flash profile's ratio to 1:${profileRatio} (create_profile or update_profile can do it — the Aiden accepts ratios below the Fellow app's 1:14 editor minimum).`,
    `2. Put ${ice}g of ice in the carafe BEFORE brewing. The Aiden brews straight onto it, Japanese style, and the melt is part of your brew water.`,
    `3. Dial the brew volume to ${hot}ml. The machine will ask for ${dose.toFixed(1)}g of coffee — that's the real dose. Add exactly that.`,
    `4. ${grindLine}`,
    `5. Profile setup: keep temps on the hot end for the roast (or +1°C), bloomRatio 2-3. The machine sizes bloom water from the true dose now, so no compensation is needed. Ice stops extraction the moment coffee hits it, so the usual bitterness worry doesn't apply.`,
    `6. Swirl the carafe when it finishes and serve over fresh ice.`,
    "",
    `Every number on the machine is honest: ${hot}ml over ${dose.toFixed(1)}g = a 1:${profileRatio} hot concentrate, melting out to ~${Math.round(honestTotal)}g total = your 1:${totalRatio} drink.`,
  ];

  return { lines, warnings };
}
