/**
 * Brewing guidelines for the Aiden brewer.
 *
 * Personalized for milk-based drinks with preferences:
 * - Rich, smooth body with enhanced sweetness
 * - Minimize acidity and bitterness
 * - Light to medium roasts preferred
 * - No anaerobic/co-ferment coffees
 * - Fellow Ode Gen 2 grinder
 * - BATCH BASKET (optimized for larger volumes, fuller body, forgiving extraction)
 *
 * Temperature and ratio priors are derived from community Fellow Drops profiles
 * and adjusted for milk-forward brewing (tighter ratios, moderate temps to
 * maximize body and sweetness while minimizing harsh notes).
 */

import { convertGrind, SUPPORTED_GRINDERS } from "./grinders.js";

export interface GuidelineInput {
  process?: string;
  roast?: string; // light | medium-light | medium
  varieties?: string[];
  elevation?: string;
  tasting_notes?: string[];
  basket_type?: string; // "batch" (default) or "cone" for experimentation
  // Note: flavor_goal is always "rich, smooth, sweet, low acidity" for milk drinks
}

export interface BrewingGuidelines {
  summary: string;
  principles: string[];
  starting_recipe: {
    ratio: string;
    bloom: string;
    batch_pulses: string;
    grind_setting: string;
  };
  warnings: string[];
}

const round05 = (v: number) => Math.round(v * 2) / 2;

export function brewingGuidelines(input: GuidelineInput): BrewingGuidelines {
  const principles: string[] = [];
  const warnings: string[] = [];

  // Detect basket type (default to batch)
  const basketType = (input.basket_type ?? "batch").toLowerCase();
  const isConeBasket = /cone|conical|v-?60/.test(basketType);
  const isBatchBasket = !isConeBasket; // default to batch

  // Personal brewing philosophy for milk drinks
  if (isBatchBasket) {
    principles.push(
      "MILK-FORWARD BREWING (Batch Basket): Optimized for the Aiden batch basket and milk drinks. The batch basket's flat bed and larger capacity provide even extraction, fuller body, and forgiving brewing—perfect for rich, sweet profiles. Ratio locked at 1:14.5 for strength, moderate temps (94-96°C) to minimize acidity/bitterness."
    );
  } else {
    principles.push(
      "MILK-FORWARD BREWING (Cone Basket - Experimental): Using cone basket for brighter, cleaner profile. Note: Cone baskets naturally emphasize acidity and clarity over body. Best for lighter roasts where you want origin characteristics to shine through in milk. Requires finer grind and careful attention to extraction."
    );
    warnings.push(
      "⚠️ CONE BASKET: You're experimenting with the cone basket. This will produce a brighter, lighter-bodied cup than batch basket. If the coffee tastes too acidic or thin in milk, switch back to batch basket for better body and sweetness."
    );
  }

  // Detect process category
  const proc = (input.process ?? "").toLowerCase();
  const isAnaerobic = /anaerobic|carbonic|co-?ferment/i.test(proc);
  const isNatural = !isAnaerobic && /natural|sundried|dry/i.test(proc);
  const isHoney = !isAnaerobic && !isNatural && /honey|semi/i.test(proc);
  const isWashed = !isNatural && !isHoney && !isAnaerobic && /washed|fully washed/i.test(proc);
  const processKnown = isNatural || isHoney || isAnaerobic || isWashed;

  // Warn about anaerobic/coferment (not preferred)
  if (isAnaerobic) {
    warnings.push(
      "⚠️ ANAEROBIC/CO-FERMENT DETECTED: This process is not preferred due to potential funky/unusual flavors that don't pair well with milk. Consider washed or natural process coffees instead."
    );
  }

  // Detect roast tier — adjusted for milk-forward brewing (avoid dark roasts)
  const roastStr = (input.roast ?? "").toLowerCase();
  const roastKnown = /light|medium/.test(roastStr);
  let roastBase = 94; // default: medium roast baseline for milk drinks
  if (/medium[\s-]?light/.test(roastStr)) roastBase = 95;
  else if (/light/.test(roastStr)) roastBase = 96;
  else if (/medium/.test(roastStr)) roastBase = 94;

  // Warn about dark roasts (not preferred)
  if (/dark/.test(roastStr)) {
    warnings.push(
      "⚠️ DARK ROAST DETECTED: Dark roasts are not preferred as they can introduce bitterness and lack the sweetness desired for milk drinks. Light to medium roasts are recommended."
    );
    roastBase = 92; // lower temp to minimize bitterness if brewing dark anyway
  }

  // Detect elevation tier
  const elevMatch = (input.elevation ?? "").replace(/,/g, "").match(/\d{3,4}/g);
  const peakElev = elevMatch ? Math.max(...elevMatch.map((s) => parseInt(s, 10))) : 0;
  const isDenseElev = peakElev >= 1800;
  const isVeryHighElev = peakElev >= 1900;
  const isLowElev = peakElev > 0 && peakElev <= 1400;

  // Detect dense varietals (Bourbon, SL28, Geisha tend to be more dense at altitude)
  const varieties = input.varieties ?? [];
  const hasDenseVariety = varieties.some((v) =>
    /bourbon|sl28|sl34|geisha|gesha|pink bourbon|yellow bourbon|red bourbon/i.test(v),
  );

  // Tasting note classifications (for milk drinks: prioritize chocolate/caramel notes)
  const notes = (input.tasting_notes ?? []).map((n) => n.toLowerCase());
  const hasChocolateNotes = notes.some((n) =>
    /chocolate|cocoa|caramel|nut|nutty|hazelnut|almond|toffee|brown sugar/.test(n),
  );
  const hasFruitNotes = notes.some((n) =>
    /berry|berries|fruit|peach|cherry|plum|fig|strawberry|raspberry|blackberry|blueberry|stone fruit|tropical|citrus|orange|lemon|lime|clementine|grapefruit/.test(
      n,
    ),
  );

  // Flavor goals are hardcoded for milk drinks: rich, smooth, sweet, low acidity
  const wantsLessAcid = true;  // always minimize acidity
  const wantsMoreBody = true;  // always maximize body and sweetness

  // ============================================================
  // Apply principles
  // ============================================================

  // Milk-drink temperature philosophy: moderate temps to avoid harsh notes
  principles.push(
    "TEMPERATURE FOR MILK: Moderate temps (94-96°C) maximize body and sweetness while minimizing acidity and bitterness that become amplified in milk. Light roasts at 96°C, medium at 94°C."
  );

  // Roast guidance
  if (roastKnown) {
    principles.push(
      `Roast: ${roastStr}. Temps adjusted for milk-forward brewing (slightly lower than black coffee to reduce harsh notes).`
    );
  } else {
    warnings.push(
      "Roast level not provided. Assuming medium roast (94°C baseline) optimized for milk drinks."
    );
  }

  // Process (simplified for milk drinks)
  if (isNatural) {
    principles.push(
      "Natural process: Good for milk drinks due to naturally sweet, fruity character. Shorter bloom (35-40s), slightly coarser grind for clarity."
    );
  } else if (isWashed) {
    principles.push(
      "Washed process: Clean, versatile for milk drinks. Balanced sweetness and body. Drop final pulse temp by 1-2°C to minimize acidity."
    );
  } else if (isHoney) {
    principles.push(
      "Honey process: Excellent for milk — sweet, syrupy body between washed and natural. Slightly coarser grind."
    );
  }

  if (!processKnown && !isAnaerobic) {
    warnings.push(
      "Process not specified. Recipe defaults to balanced profile suitable for milk drinks."
    );
  }

  // Elevation
  if (isVeryHighElev) {
    principles.push(
      `Very high elevation (~${peakElev}m): bean is dense and slow to degas. Push bloom to 50s minimum, keep bloom temp at or 1°C above your pulse temps. Expert profiles for 1800m+ coffee run ~1–2.5°C hotter than low-grown.`,
    );
  } else if (isDenseElev && hasDenseVariety) {
    principles.push(
      `High elevation (~${peakElev}m) + Bourbon-family varietal: dense, structured. Long bloom (45s+), full water in bloom (3x ratio).`,
    );
  } else if (isLowElev) {
    principles.push(
      `Low-grown (~${peakElev}m): softer bean, extracts quickly. Recipe runs ~1°C under the roast baseline; avoid going finer than the recipe grind or harshness creeps in.`,
    );
  }

  // Tasting note guidance for milk drinks
  if (hasChocolateNotes) {
    principles.push(
      "Chocolate/caramel notes: Perfect for milk! These notes are enhanced by medium-body extraction. Maintain moderate temps (93-94°C) and don't go too coarse on grind."
    );
  }
  if (hasFruitNotes) {
    principles.push(
      "Fruit notes: Can work well in milk if balanced. Keep temps moderate to avoid sour/acidic notes that clash with milk sweetness."
    );
  }

  // Goals are always: rich body, low acidity, smooth sweetness
  if (isBatchBasket) {
    principles.push(
      "BATCH BASKET ADVANTAGES: Flat bed geometry ensures even extraction across the entire coffee bed. Larger capacity (300-500ml) perfect for milk drinks. Forgiving brewing reduces risk of harsh notes."
    );
    principles.push(
      "RATIO ADJUSTMENT: Dynamic ratio (1:14-1:16, default 1:15) based on coffee density and process. Dense high-elevation coffees → tighter ratio (1:14-1:14.5) for strength. Lighter/natural coffees → more open ratio (1:15-1:15.5) for balance. Batch basket's depth + slightly coarser grind = balanced extraction with full body."
    );
    principles.push(
      "LOW ACIDITY: Final pulse 2.5-3°C lower than bloom minimizes brightness. Batch basket's slower drawdown naturally dampens sharp acidity. Longer pulse intervals (28s) allow full drainage."
    );
  } else {
    principles.push(
      "CONE BASKET CHARACTERISTICS: Conical geometry with single-hole drain = faster drawdown. Requires 2 clicks finer on grind to maintain extraction. Produces cleaner, brighter cup with more clarity but less body than batch basket."
    );
    principles.push(
      "RATIO ADJUSTMENT (Cone): Dynamic ratio (1:14-1:16, default 1:15) based on coffee density and process. Same ratio logic as batch basket. Finer grind compensates for fast drainage. Expect lighter body than batch. Moderate temps still target sweetness."
    );
    principles.push(
      "ACIDITY (Cone): Cone baskets naturally emphasize brightness. Final pulse 2-2.5°C lower than bloom. Tighter pulse intervals (18s) keep bed saturated. If too bright, switch to batch basket."
    );
  }

  // ============================================================
  // Starting recipe (personalized for milk drinks)
  // ============================================================

  // Dynamic ratio (1:14-1:16) for milk drinks, default 1:15
  // Adjust based on coffee density and process for optimal strength and balance
  let ratio = 15; // default baseline

  // Denser coffees (high elevation, dense varietals): tighter ratio for strength
  if (isDenseElev && hasDenseVariety) {
    ratio = 14;
  } else if (isDenseElev || hasDenseVariety) {
    ratio = 14.5;
  }

  // Lighter/softer coffees or processes: more open ratio for balance
  if (isLowElev) {
    ratio = 15.5;
  }

  // Natural process: slightly more open for clarity
  if (isNatural && ratio === 15) {
    ratio = 15.5;
  }

  // Washed process at baseline: keep at 15
  // Honey process: keep at current ratio (balanced sweetness)

  // Ensure ratio stays within 1:14-1:16 range
  ratio = Math.max(14, Math.min(16, ratio));

  // Temperature model: moderate for milk (adjusted from roast baseline)
  let base = roastBase;
  if (isDenseElev) base += 0.5; // less elevation boost for milk
  else if (isLowElev) base -= 0.5;
  if (isNatural) base -= 0.5; // slight reduction for naturals
  if (isHoney) base -= 0.5;
  if (isAnaerobic) base -= 1.5; // still reduce for anaerobic
  base = Math.min(97, Math.max(92, base)); // cap at 97°C for milk

  const bloomTemp = round05(base);
  const pulseHigh = round05(base - 0.5);
  const pulseSpread = 2.5; // wider spread to reduce acidity
  const pulseLow = round05(pulseHigh - pulseSpread);

  // Grind: basket-specific optimization
  let grindEncore: number;
  let bloomDuration: number;
  let pulseInterval: number;

  if (isBatchBasket) {
    // Batch basket: slightly coarser grind for even extraction and sweetness
    // Encore 15-16 range for batch basket's larger bed depth
    grindEncore = isNatural ? 16 : 15;
    // Batch basket benefits from longer bloom for even saturation
    bloomDuration = isNatural ? 38 : 45;
    if (isVeryHighElev) bloomDuration = 50;
    // Longer intervals allow the larger bed to fully drain between pulses
    pulseInterval = 28;
  } else {
    // Cone basket: 2 clicks finer to compensate for faster drainage
    // Encore 13-14 range (same as single-serve or slightly finer)
    grindEncore = isNatural ? 14 : 13;
    // Cone basket: standard bloom duration
    bloomDuration = isNatural ? 35 : 43;
    if (isVeryHighElev) bloomDuration = 48;
    // Tighter intervals to keep the conical bed saturated
    pulseInterval = 18;
  }

  // Grind conversion (always Fellow Ode Gen 2)
  const converted = convertGrind(grindEncore);
  const grindSetting = `Fellow Ode Gen 2: ${converted.setting} (≈ Encore ${grindEncore})`;

  if (isBatchBasket) {
    principles.push(
      "Grind setting is calibrated for Fellow Ode Gen 2 + batch basket. The slightly coarser setting works with the batch basket's larger bed depth for optimal extraction. Adjust by taste: if weak/sour, go 1 click finer; if bitter/harsh, go 1 click coarser."
    );
  } else {
    principles.push(
      "Grind setting is calibrated for Fellow Ode Gen 2 + cone basket. The finer setting (2 clicks finer than batch) compensates for faster drainage. Adjust by taste: if weak/sour or fast drawdown (<3min), go 1 click finer; if bitter/harsh or slow drawdown (>4.5min), go 1 click coarser."
    );
  }

  // ============================================================
  // Summary
  // ============================================================

  const procName = isNatural
    ? "natural"
    : isWashed
      ? "washed"
      : isHoney
        ? "honey"
        : isAnaerobic
          ? "anaerobic"
          : "unspecified";
  const roastDescr = roastKnown ? `${roastStr.trim()} roast ` : "";
  const elevDescr = peakElev ? ` (${peakElev}m)` : "";
  const basketDescr = isBatchBasket ? "BATCH BASKET" : "CONE BASKET (Experimental)";
  const summary = `${basketDescr} profile for ${roastDescr}${procName} coffee${elevDescr}. Optimized for milk drinks: ${isBatchBasket ? "rich body, smooth sweetness, low acidity" : "brighter clarity, lighter body (vs batch)"}.`;

  const basketNote = isBatchBasket
    ? "batch basket: longer for even saturation"
    : "cone basket: standard";
  const pulseNote = isBatchBasket
    ? "batch basket: 28s for full drainage"
    : "cone basket: 18s to keep bed saturated";
  const grindNote = isBatchBasket
    ? "batch basket: slightly coarser"
    : "cone basket: 2 clicks finer than batch";

  return {
    summary,
    principles,
    starting_recipe: {
      ratio: `1:${ratio} (milk drink strength)`,
      bloom: `${bloomTemp}°C, ${bloomDuration}s, 3x ratio (${basketNote})`,
      batch_pulses: `2 pulses at ${round05(pulseHigh - 1)}/${pulseLow}°C, ${pulseInterval}s interval (${pulseNote})`,
      grind_setting: `${grindSetting} (${grindNote})`,
    },
    warnings,
  };
}
