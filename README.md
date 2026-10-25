# aiden-mcp (Personalized Edition)

A personalized MCP server for the [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer, optimized for **milk-forward brewing** with the **Fellow Ode Gen 2** grinder.

> **Forked and customized** from [ravenintheforrest/aiden-mcp](https://github.com/ravenintheforrest/aiden-mcp). This version is tailored for a specific brewing style: rich body, smooth sweetness, low acidity, batch basket priority.

## Personalization

This fork is optimized for:
- ☕ **Milk drinks** (lattes, cappuccinos, flat whites)
- 🍫 **Rich, smooth, sweet** profile
- 📉 **Minimize acidity and bitterness**
- ⚙️ **Fellow Ode Gen 2** grinder (only supported grinder)
- 🏺 **Batch basket** brewing (default, with cone basket option)
- ☀️ **Light to medium roasts** (dark roasts trigger warnings)
- 🚫 **No anaerobic/co-ferment** coffees (warnings added)

### Key Differences from Original

| Setting | Original | Personalized |
|---------|----------|--------------|
| **Grinders** | 11 supported | Fellow Ode Gen 2 only |
| **Ratio** | Dynamic (1:14-1:20) | Fixed at 1:14.5 |
| **Temperature** | 92-97°C | 93-95°C (moderate for milk) |
| **Basket** | Stock + 3 mods | Batch (default) + Cone (experimental) |
| **Flavor Goal** | User-specified | Hardcoded: body + sweetness |
| **Grind (Batch)** | - | Ode 5-5⅓ (Encore 15-16) |
| **Grind (Cone)** | - | Ode 4⅓-4⅔ (Encore 13-14) |
| **Pulse Interval** | 20-25s | 28s (batch) / 18s (cone) |

## What it does

| Tool | Auth | What |
|---|---|---|
| `fetch_coffee_details` | none | Scrape Shopify roaster product pages (Counter Culture, Onyx, Sey, Heart, Verve) for structured coffee data |
| `flash_brew` | none | Plan Japanese iced coffee with automatic ice/water split calculation |
| `brewing_guidelines` | none | **Personalized brewing profiles** optimized for milk drinks with batch or cone basket. Returns principles, starting recipe with Fellow Ode Gen 2 grind settings |
| `list_profiles` | OAuth | List brew profiles on your Aiden |
| `create_profile` | OAuth | Push new profile, get `brew.link` URL |
| `update_profile` | OAuth | Edit existing profile |
| `delete_profile` | OAuth | Free up profile slot (14-profile cap) |
| `share_profile` | OAuth | Generate `brew.link` for profile |
| `list_schedules` | OAuth | List scheduled brews |
| `create_schedule` | OAuth | Schedule recurring brew |
| `delete_schedule` | OAuth | Remove scheduled brew |
| `toggle_schedule` | OAuth | Pause/resume schedule |
| `get_device_info` | OAuth | Verify connection + slot usage |

## Brewing Philosophy

### Batch Basket (Default)
- **Grind:** Fellow Ode Gen 2 at 5-5⅓ (slightly coarser)
- **Bloom:** 45s (38s for naturals) for even saturation
- **Pulses:** 28s intervals for full drainage
- **Best for:** Rich body, smooth sweetness, forgiving extraction
- **Use case:** All milk drinks (lattes, cappuccinos, flat whites)

### Cone Basket (Experimental)
- **Grind:** Fellow Ode Gen 2 at 4⅓-4⅔ (2 clicks finer)
- **Bloom:** 43s (35s for naturals)
- **Pulses:** 18s intervals to keep bed saturated
- **Best for:** Brighter clarity, lighter body
- **Use case:** Cortados, macchiatos, or when you want more origin character
- **Warning:** Naturally emphasizes acidity vs batch basket

### Temperature Strategy
- **Light roasts:** 94.5-95°C
- **Medium roasts:** 93-94°C
- **Dark roasts:** Not recommended (triggers warning)
- **Final pulse:** 2.5-3°C lower than bloom to minimize acidity

## Setup

### Self-hosting (Recommended)

```bash
git clone https://github.com/chaosti/aiden-mcp
cd aiden-mcp
npm install
npx wrangler login

# Create OAuth state KV namespace
npx wrangler kv namespace create AIDEN_OAUTH
# Copy the id into wrangler.toml under [[kv_namespaces]]

# Deploy
npx wrangler deploy
```

### Local development

```bash
npm run dev
```

Worker runs at `http://localhost:8787`.

## Usage Examples

### Batch Basket (Default)
```javascript
brewing_guidelines({
  roast: "medium",
  process: "washed",
  elevation: "1800m"
})
// Returns: Ode Gen 2 at 5, 94°C, 28s pulse intervals
```

### Cone Basket (Experimental)
```javascript
brewing_guidelines({
  roast: "light",
  process: "natural",
  basket_type: "cone"
})
// Returns: Ode Gen 2 at 4⅓, 95°C, 18s pulse intervals + warning
```

## Profile Schema

| Field | Range | Notes |
|---|---|---|
| `ratio` | 8–20 | Fixed at 14.5 for milk drinks (1:14.5) |
| `bloomRatio` | 1–3 | Fixed at 3x |
| `bloomDuration` | 1–120 | Batch: 45s, Cone: 43s |
| `bloomTemperature` | 50–99 | 93-95°C range for milk |
| `batchPulsesNumber` | 1–10 | Fixed at 2 |
| `batchPulsesInterval` | 5–60 | Batch: 28s, Cone: 18s |
| `batchPulseTemperatures` | array of 50–99 | Descending temps |
| `title` | 1–50 chars | Alphanumeric + basic punctuation |

## Dependencies

- **@modelcontextprotocol/sdk** v1.32.2
- **zod** v4.6.7 (upgraded for security)
- **TypeScript** v5.9.3
- **wrangler** v4.152.0

### Security
- Fixed 12 vulnerabilities (16→4 remaining)
- Remaining vulnerabilities are in dev dependencies only

## Technical Details

- **Cloudflare Worker** (self-hosted)
- **Streamable HTTP** MCP transport
- **OAuth 2.0** authorization (auth code + PKCE)
- **No persistent state** beyond expiring KV records

## Caveats

- **One grinder:** Only Fellow Ode Gen 2 supported
- **One basket priority:** Batch basket is default, cone is experimental
- **Fixed ratio:** 1:14.5 for all milk drinks
- **Fellow's API is private:** Could break without notice
- **14-profile cap:** Aiden hardware limitation

## License

MIT — Original by [@ravenintheforrest](https://github.com/ravenintheforrest/aiden-mcp), personalized for milk-forward brewing.

## Credits

- Original project: [ravenintheforrest/aiden-mcp](https://github.com/ravenintheforrest/aiden-mcp)
- Fellow Aiden profile schema: [9b/fellow-aiden](https://github.com/9b/fellow-aiden)
- Brewing principles: [Counter Culture Brew Guides](https://counterculturecoffee.com/pages/how-to-brew)
