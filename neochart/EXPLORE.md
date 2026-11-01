# Ad-Hoc Site Exploration: neochart.com

Ad-hoc exploration of [neochart.com](https://neochart.com) performed using `playwright-cli` to discover routing, pages, key elements, selectors, and dynamic behaviors.

---

## 1. Commands Used

```bash
# Optional: install Chromium browser for playwright-cli (user space)
playwright-cli install-browser chromium

# Launch browser and navigate to base URL
playwright-cli open https://neochart.com --browser chromium

# Inspect accessible DOM tree and element references
playwright-cli snapshot

# Test search form interaction
# Note: e8 and e9 are session-specific snapshot node references, not persistent selectors.
playwright-cli fill e8 "copyright"
playwright-cli click e9

# Navigate to secondary pages
playwright-cli goto https://www.neochart.com/about/index.html
playwright-cli snapshot

playwright-cli goto https://www.neochart.com/constitution/index.html
playwright-cli snapshot

# Close the session
playwright-cli close
```

> **Snapshot References vs Selectors**: Element references like `e8` (search input) and `e9` (search button) are ephemeral IDs assigned by `playwright-cli` within a single active snapshot session. For automated integration scripts, use standard persistent CSS selectors (`form.searchbar input[name="q"]`, `form.searchbar button[type="submit"]`).

---

## 2. Pages Explored

### 2.1 Domain Apex (`https://neochart.com`)
- **HTTP Routing**: Returns `HTTP 301 Moved Permanently` with `Location: https://www.neochart.com/`.
- **Target**: `https://www.neochart.com/` (HTTP 200).

### 2.2 Homepage (`https://www.neochart.com/`)
- **Page Title**: `neochart — Legal Document Library`
- **Masthead**:
  - `h1.brand`: `neochart` (linked to `/`) + tagline `· a free legal document library`
  - Scale text: `1.4M+ pages of primary law...`
- **Search CTA**:
  - `form.searchbar` with `action="/search/"` and `role="search"`
  - `input#q` (`name="q"`, `type="search"`, placeholder `"Search by meaning or citation"`)
  - `button[type="submit"]` (`Search`)
- **Navigation Sections**:
  - Topics Grid: `nav[aria-label="Topics"] a` containing 12 life-event topics (`/topics/home-and-housing/`, `/topics/work/`, etc.)
  - Reading Guides: Plain-language guides (`/guides/eviction-in-texas/index.html`, etc.)
  - Browse the Library: Direct links to primary legal corpora:
    - United States Code: `/usc/index.html`
    - U.S. Constitution: `/constitution/index.html`
    - Texas Statutes: `/texas/index.html`
    - Case Law: `/caselaw/index.html`
- **Footer**:
  - Content disclaimer: `Informational only — not legal advice...`
  - Provenance link: `/about/index.html`

### 2.3 Search Results (`https://www.neochart.com/search/?q=copyright`)
- **Page Title**: `Search — neochart`
- **Behavior**:
  - Static HTML shell renders search form and `Searching…` status.
  - Client-side JavaScript asynchronously fetches results and dynamically renders filter buttons (`All (100)`, `Federal (50)`, `Cases (50)`) and article links.

### 2.4 About & Provenance (`https://www.neochart.com/about/index.html`)
- **Page Title**: `About & provenance — neochart`
- **Main Heading**: `h1` "About & provenance"
- **Breadcrumb Navigation**: Link back to `../index.html`
- **Content Sections (`h2`)**:
  - `Sources` (Caselaw Access Project, govinfo.gov, Texas statutes, National Archives)
  - `Method` (deterministic parsing, no LLM summarization)
  - `Ecosystem links` (citation lookup API, egtry Computational Law)
  - `As of / currency`
  - `Not legal advice`

### 2.5 Constitution Index (`https://www.neochart.com/constitution/index.html`)
- **Page Title**: `U.S. Constitution`
- **Content**: Articles and Amendments links with official transcripts.

---

## 3. Key Elements & Selectors

| Purpose | Selector | Expected Content / Behavior |
|---|---|---|
| Page Title | `title` | `neochart — Legal Document Library` |
| Brand Heading | `h1.brand` | Contains `neochart` and tagline |
| Search Form CTA | `form.searchbar` | `action="/search/"` |
| Search Input | `form.searchbar input[name="q"]` | Text input for citations / queries |
| Core Browse Links | `a[href="/usc/index.html"]`, etc. | Links to USC, Constitution, Texas, Case Law |
| Footer About Link | `footer a[href="/about/index.html"]` | Resolves to `/about/index.html` |
| About Page Title | `title` | `About & provenance — neochart` |
| About Heading | `main h1` / `header h1` | `About & provenance` |
| About Sections | `main h2` | `Sources`, `Method`, `Not legal advice` |

---

## 4. Flaky & Dynamic Elements (Testing Considerations)

1. **Apex Redirect**: The apex `neochart.com` redirects to `https://www.neochart.com/` with HTTP 301. Automated tests must assert on the exact 301 status and location header.
2. **Dynamic Search Results**: Search results are rendered via client-side JavaScript from an external API (`execute-api.us-east-1.amazonaws.com`). Asserting on raw search result counts or live citation counts in static integration tests would be brittle. Static tests verify the search form markup and CTA on the homepage, while testing full search execution requires browser JavaScript.
3. **Corpus Stability**: The core navigation links (`/about/index.html`, `/constitution/index.html`, `/usc/index.html`, `/texas/index.html`, `/caselaw/index.html`) and semantic section headings are static, fast, and deterministic, making them ideal assertion targets for stable regression testing.
4. **playwright-cli Browser Default**: By default `playwright-cli` targets Google Chrome channel (`/opt/google/chrome/chrome`). In server/CI environments without Chrome installed, `--browser chromium` or running `playwright-cli install-browser chromium` is required.
