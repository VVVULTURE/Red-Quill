# Red Quill

A free, rule-based AI-text humanizer — paste in AI-generated writing, get
back a rewrite with more natural sentence rhythm and fewer AI "tells." No
API key, no backend, no cost. The whole thing runs as static HTML/CSS/JS in
your browser.

## How it works

```
Browser (app/page.tsx)
   │  calls humanize(text, intensity) directly — no network request
   ▼
lib/humanizer.ts   (pure JS/TS, runs on your machine, not a server)
   │  applies a pipeline of weighted, randomized text transforms
   ▼
Result rendered in the "Transmuted" panel
```

There's no API route anymore and nothing to configure — `next.config.js`
sets `output: "export"`, so `npm run build` produces plain static files in
`out/`. You can host that folder literally anywhere: Vercel, Netlify,
Cloudflare Pages, GitHub Pages, or just open `index.html` locally.

### The algorithm

This isn't a model — it's a pipeline of targeted, probabilistic transforms
that target the specific patterns that make AI writing read as AI writing:

1. **Phrase substitution** — a dictionary of ~30 AI-tell phrases ("it is
   important to note that", "in conclusion", "a wide range of") swapped for
   plainer alternatives, chosen randomly from a few options each time so
   repeated matches don't all turn into the same replacement.
2. **Word substitution** — ~40 individual words AI writing leans on
   ("utilize," "facilitate," "robust," "myriad," "seamlessly") swapped for
   everyday equivalents.
3. **Filler trimming** — throat-clearing openers ("needless to say,",
   "simply put,") get cut outright at the higher intensities.
4. **Contraction injection** — "it is" → "it's", "do not" → "don't", etc.,
   applied at a randomized rate rather than 100%, since real human writing
   mixes contracted and uncontracted forms inconsistently.
5. **Em dash reduction** — AI writing overuses em dashes; this swaps a
   portion of them for commas, hyphens, or sentence breaks.
6. **Burstiness** — the most important one. AI sentences tend toward a
   uniform medium length. This pass merges adjacent short sentences with a
   conjunction, and splits overlong sentences at a natural conjunction near
   their midpoint, producing the irregular short/long rhythm of real human
   writing.

Every transform is probability-gated per intensity level (Light/Medium/
Heavy) and driven by a seeded PRNG, so hitting "Reroll" on the same input
gives you a different — but still grammatical — variation each time.

**Honesty about limits:** this is regex and heuristics, not language
understanding. It's very good at killing the specific lexical/rhythmic
patterns detectors and readers key on, but it can't catch everything a full
language model could, and on rare awkward sentence structures the merge/
split heuristics can produce a slightly clunky (though still grammatical)
result. Skim the output before using it — same as you'd proofread anything.

### Abbreviation & number safety

A naive "split on . ! ?" approach breaks badly on "Dr. Smith," "U.S.,"
"3.5 million," or "$19.99" — the periods inside those get misread as
sentence boundaries. `lib/humanizer.ts` protects a list of common
abbreviations (Dr., Mr., U.S., U.K., e.g., i.e., Ph.D., a.m./p.m., etc.) and
all digit-decimal periods before splitting, then restores them afterward.
This was caught and fixed via the test suite below — see `Edge cases
covered` if you want to extend the abbreviation list.

## Project structure

```
red-quill/
├── app/
│   ├── layout.tsx     # fonts + metadata
│   ├── page.tsx        # the whole UI, client component
│   └── globals.css     # theme (crimson/verdigris alchemy aesthetic)
├── lib/
│   └── humanizer.ts     # the actual algorithm — no dependencies
├── next.config.js       # output: "export" — fully static build
├── package.json
└── tsconfig.json
```

## Running it locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. No `.env` file needed — there's nothing to
configure.

## Deploying — free, anywhere

Because this is a static export with zero server logic, you have more
options than before, all free:

### Vercel (easiest)
1. Push to GitHub, import the repo at vercel.com.
2. Vercel auto-detects Next.js and the static export — no env vars to add.
3. Deploy.

### Netlify
1. Push to GitHub, import at app.netlify.com.
2. Build command: `npm run build`. Publish directory: `out`.

### Cloudflare Pages
1. Push to GitHub, import at dash.cloudflare.com/pages.
2. Build command: `npm run build`. Build output directory: `out`.

### GitHub Pages
1. `npm run build` locally.
2. Push the contents of `out/` to a `gh-pages` branch (or use the
   `actions/deploy-pages` GitHub Action to do this on every push).
3. Enable Pages in repo settings, pointing at that branch.

All four are $0 forever for this app — there's no serverless function
invocation to meter, since there's no server.

## Extending the dictionaries

`lib/humanizer.ts` has two plain objects at the top, `PHRASE_MAP` and
`WORD_MAP`. Each key maps to an array of alternatives:

```ts
"in conclusion": ["so", "bottom line", "all in all", "to wrap up"],
```

Add more AI-tell words/phrases you notice as keys, with 2-4 natural
alternatives as the array, and they're picked up automatically — no other
code changes needed.

## Testing

The algorithm was validated with a test harness covering grammar
correctness, determinism (same seed → same output), variation (different
seeds → different output), meaning preservation, and a 5,400-run fuzz pass
across edge cases (abbreviations, decimals, currency, quoted speech) to
catch content-loss bugs before they ship. That harness isn't included in
the production build, but the abbreviation/decimal protection it caught
real bugs in is — see `protectAbbreviations` and `protectDecimals` in
`lib/humanizer.ts`.
