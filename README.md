# aiden-mcp (Personalized Edition)

A personalized MCP server for the [Fellow Aiden](https://fellowproducts.com/products/aiden) coffee brewer, optimized for **batch brewing with milk** using the **Fellow Ode Gen 2** grinder.

> **Forked and customized** from [ravenintheforrest/aiden-mcp](https://github.com/ravenintheforrest/aiden-mcp). This version is tailored for a specific brewing style: batch basket brewing (300-500ml) for milk-based beverages, prioritizing rich body, smooth sweetness, and low acidity.

## Personalization

This fork is optimized for:
- ☕ **Batch brews with milk** (300-500ml brewed coffee for adding milk)
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
| **Ratio** | Dynamic (1:14-1:20) | Dynamic (1:14-1:16, default 1:15) |
| **Temperature** | 92-97°C | 94-96°C (moderate for milk) |
| **Basket** | Stock + 3 mods | Batch (default) + Cone (experimental) |
| **Flavor Goal** | User-specified | Hardcoded: body + sweetness |
| **Grind (Batch)** | - | **Ode 8.0-8.2** (stock burrs) |
| **Grind (Cone)** | - | **Ode 5.0-5.3** (stock burrs) |
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
- **Grind:** Fellow Ode Gen 2 (stock burrs) at **8.0-8.2** (medium-coarse, like rough sea salt)
  - Light roast: **8.0**
  - Medium roast: **8.1-8.2**
- **Bloom:** 45s (38s for naturals) for even saturation
- **Pulses:** 28s intervals for full drainage
- **Best for:** Rich body, smooth sweetness, forgiving extraction
- **Use case:** Batch brews (300-500ml) for adding milk - perfect for making multiple drinks or large milk-based beverages

### Cone Basket (Experimental)
- **Grind:** Fellow Ode Gen 2 (stock burrs) at **5.0-5.3** (medium, like table salt, similar to V60)
  - Light roast: **5.0-5.2**
  - Medium roast: **5.3**
- **Bloom:** 43s (35s for naturals)
- **Pulses:** 18s intervals to keep bed saturated
- **Best for:** Brighter clarity, lighter body
- **Use case:** Smaller batches or when you want more origin character in your milk-based brew
- **Warning:** Naturally emphasizes acidity vs batch basket

### Temperature Strategy
- **Light roasts:** 95-96°C (95°C for natural process, 96°C for washed)
- **Medium roasts:** 93-94°C (93°C for darker mediums, 94°C baseline)
- **Dark roasts:** Not recommended (triggers warning)
- **Final pulse:** 2.5-3°C lower than bloom to minimize acidity
- **Research basis:** Optimized for milk drinks to minimize acidity/bitterness amplified by milk

## Setup

### Self-hosting (Recommended)

```bash
git clone https://github.com/chaosti/aiden-mcp
cd aiden-mcp
npm install
npx wrangler login

# Create OAuth state KV namespace (IMPORTANT: Create your own!)
npx wrangler kv namespace create AIDEN_OAUTH
# Copy the generated namespace ID into wrangler.toml under [[kv_namespaces]]
# Replace the existing id with YOUR namespace ID

# Deploy
npx wrangler deploy
```

**Security Note:** The KV namespace ID in `wrangler.toml` is specific to the original deployment. **Self-hosters MUST create their own KV namespace** as shown above for security isolation. Never share KV namespace IDs between deployments.

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
// Returns: Ode Gen 2 (stock burrs) at 8, 94°C, 28s pulse intervals
```

### Cone Basket (Experimental)
```javascript
brewing_guidelines({
  roast: "light",
  process: "natural",
  basket_type: "cone"
})
// Returns: Ode Gen 2 (stock burrs) at 5⅓, 96°C, 18s pulse intervals + warning
```

## Profile Schema

| Field | Range | Notes |
|---|---|---|
| `ratio` | 8–20 | Dynamic 1:14-1:16 (default 1:15) based on coffee density/process |
| `bloomRatio` | 1–3 | Fixed at 3x |
| `bloomDuration` | 1–120 | Batch: 45s, Cone: 43s |
| `bloomTemperature` | 50–99 | 94-96°C range for milk |
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

### OAuth Security Hardening (v1.1.0)

This fork includes comprehensive security hardening for OAuth endpoints:

- **Rate Limiting**: 10 attempts per 5-minute window on all OAuth endpoints to prevent brute force attacks
- **Enhanced Redirect URI Validation**: Blocks malicious URI schemes (javascript:, data:, file:), validates hostname structure, prevents IP addresses for HTTPS
- **CORS Protection**: Allowlist-based origin validation (claude.ai only), proper preflight handling, explicit rejection of unauthorized origins
- **Reduced Error Verbosity**: Minimized information disclosure in error messages
- **KV Namespace Isolation**: Self-hosters must create their own KV namespace for security isolation

These protections defend against:
- Brute force attacks on Fellow credentials
- Token enumeration and abuse
- Client registration spam
- Malicious redirect URIs
- Unauthorized cross-origin access
- Information disclosure through verbose errors

## Technical Details

- **Cloudflare Worker** (self-hosted)
- **Streamable HTTP** MCP transport
- **OAuth 2.0** authorization (auth code + PKCE)
- **No persistent state** beyond expiring KV records

## Caveats

- **One grinder:** Only Fellow Ode Gen 2 supported
- **One basket priority:** Batch basket is default, cone is experimental
- **Dynamic ratio:** 1:14-1:16 (default 1:15) adjusts based on coffee density and process
- **Fellow's API is private:** Could break without notice
- **14-profile cap:** Aiden hardware limitation

## License

MIT — Original by [@ravenintheforrest](https://github.com/ravenintheforrest/aiden-mcp), personalized for milk-forward brewing.

## Credits

- Original project: [ravenintheforrest/aiden-mcp](https://github.com/ravenintheforrest/aiden-mcp)
- Fellow Aiden profile schema: [9b/fellow-aiden](https://github.com/9b/fellow-aiden)
- Brewing principles: [Counter Culture Brew Guides](https://counterculturecoffee.com/pages/how-to-brew)
