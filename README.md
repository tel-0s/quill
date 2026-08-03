# Quill

Writing flow analysis for [Obsidian](https://obsidian.md). Quill breaks your prose into paragraphs and surfaces three families of metrics in a right-sidebar panel:

- **Structural flow** — the mix of sentence types (fragment, simple, compound, complex, compound-complex) rendered as a stacked bar per paragraph.
- **Sentence length flow** — per-sentence word counts shown as a segmented bar with a red threshold marker for long sentences, plus the paragraph mean.
- **Word length flow** — short/medium/long word distribution as a three-segment bar, plus the paragraph mean character length.

The core analysis engine has zero Obsidian dependencies and is designed to be extracted as a standalone library for use in LLM reward functions.

## Installation

Copy or symlink the `quill` folder into your vault's `.obsidian/plugins/` directory, then enable **Quill** under Settings → Community Plugins.

For development:

```bash
npm install
npm run dev     # watch mode — rebuilds on save
npm run build   # production build
```

The build outputs `main.js` at the project root, which is what Obsidian loads.

## Usage

Click the feather icon in the ribbon or run **Quill: Toggle flow panel** from the command palette. The sidebar updates automatically as you type (debounced at 500ms by default).

Each paragraph row is clickable — it scrolls the editor to that paragraph.

## Settings

| Setting | Default | Description |
|---|---|---|
| Long sentence threshold | 25 words | Sentences at or above this length are flagged |
| Short word maximum | 3 chars | Upper bound for the "short" word bucket |
| Long word minimum | 7 chars | Lower bound for the "long" word bucket |
| Debounce interval | 500ms | Delay after typing before re-analysis |
| Colors | — | Full color picker for all nine category/gradient colors |

## Architecture

```
src/
  core/                         Portable analysis engine
    types.ts                    Shared type definitions
    tokenizer.ts                Markdown stripping, paragraph/sentence/word splitting
    classifiers/
      sentenceType.ts           5-way classification via compromise.js POS tagging
      sentenceLength.ts         Per-sentence word count, mean, std dev
      wordLength.ts             Character/syllable counting, bucketed distribution
    flow.ts                     Rhythm-based flow scoring (nPVI, variety, novelty, runs)
    scoring.ts                  Orchestrates analysis and aggregates results
  plugin/                       Obsidian integration
    main.ts                     Plugin lifecycle, commands, event listeners
    FlowSidebarView.ts          ItemView subclass for the right sidebar
    FlowRenderer.ts             SVG bar generation
    settings.ts                 Settings tab
```

The `core/` module can be imported independently of Obsidian — it takes a markdown string and settings, and returns a `DocumentAnalysis` object with per-paragraph and document-wide metrics. This is the foundation for eventual use as a component in LLM training reward functions.

## Sentence Classification

Sentences are classified using [compromise](https://github.com/spencermountain/compromise) for part-of-speech tagging combined with heuristic clause boundary detection:

| Type | Rule |
|---|---|
| Fragment | No finite verb, or no subject for a finite verb |
| Simple | 1 independent clause, 0 dependent clauses |
| Compound | 2+ independent clauses, 0 dependent clauses |
| Complex | 1 independent clause, 1+ dependent clauses |
| Compound-Complex | 2+ independent clauses, 1+ dependent clauses |

Dependent clauses are opened by subordinating conjunctions, relative pronouns, complementizer "that", purpose "so", and zero-complementizer clauses after bridge verbs ("I think [that] it works"); they close at the next clause-boundary punctuation. Independent clause joins are detected via coordinating conjunctions (FANBOYS) followed by a new subject+verb pair, and via semicolons/colons/dashes between clause-capable spans. Ambiguous words ("that", "so", "for", "like") are disambiguated by context, imperatives count as clauses with an implicit subject, and mostly-uppercase sentences are case-normalized before POS tagging.

## Flow Scoring

The overall flow score is a weighted blend of three channels (sentence length 0.45, structure 0.35, word length 0.20), each built from interpretable rhythm components computed over the document's sentence sequence:

| Component | Channels | What it measures |
|---|---|---|
| Contrast (nPVI) | length, word | Mean relative jump between adjacent sentences — the pairwise variability index from speech-rhythm research |
| Range (windowed CV) | length, word | Whether there is enough dynamic range *locally*, not just across the whole document |
| Variety (Gini–Simpson) | structure | Probability that two random sentences differ in type |
| Novelty | structure | Adjacent same-type repeats compared to chance given the type mix — rewards deliberate alternation, penalizes block-repeats |
| Monotony runs | all | Penalty for long runs of near-equal lengths or same-type sentences |
| Periodicity guard | length, word | Penalty for mechanical lag-2 patterns (strict short/long alternation) |

Raw values pass through smooth band maps (full credit over the range observed in good prose, soft shoulders on both sides), so both monotony and mechanical extremes lose points. Every component is well-defined from a handful of sentences, so short notes get an honest score plus a **confidence** value (a function of sentence count) instead of a zero. Each paragraph also gets a **local flow score** over a window of surrounding sentences, with a hint when something specific is wrong ("5 similar-length sentences in a row").

The previous metric (detrended fluctuation analysis, `src/core/dfa.ts`) is retained for reference but no longer wired in: DFA scaling exponents need series far longer than a typical note before they carry signal, and on the benchmark corpus it scored random noise above Melville.

`scripts/flow-bench.ts` is the calibration benchmark. It scores ten public-domain excerpts (Melville, Austen, Dickens, Fitzgerald, Conrad, Shelley, London, Joyce, Carroll, Hemingway — fixtures in `scripts/corpus/`, sourced from Project Gutenberg) plus constructed texts against degenerate baselines (constant sentences, monotone academic prose, mechanical short/long alternation) and order-destroyed controls (shuffled prose, iid-random lengths), then checks separation and single-edit stability. Current results: real prose 0.71–0.94, degenerate texts 0.03–0.22, controls ~0.74–0.76 (a shuffled text keeps its surface rhythm — what it loses is coherence, which a rhythm metric doesn't claim to measure). The old DFA metric fails the same gate: it scores several real texts at 0.00 and ranked iid-random noise above London and Hemingway.

Regression tests for the classifier and sentence splitter live in `scripts/classify-test.ts` (run with `npx esbuild scripts/classify-test.ts --bundle --platform=node --outfile=scripts/classify-test.cjs && node scripts/classify-test.cjs`); `scripts/smoke-test.ts` runs a full manuscript-style document through the analyzer; `scripts/flow-bench.ts` runs the flow metric benchmark the same way.

## License

MIT
