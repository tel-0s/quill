import { SentenceType } from "./types";

/**
 * Rhythm-based flow scoring.
 *
 * Replaces the DFA approach, which needs series far longer than a note
 * (hundreds-to-thousands of points) before its scaling exponent is more
 * signal than noise.  Every component here is well-defined from a handful
 * of sentences up, is order-sensitive where flow actually is, and maps to
 * something a writer can act on:
 *
 * Numeric channels (sentence length, word length):
 *   - contrast:  nPVI, the normalized pairwise variability index from
 *                speech-rhythm research — mean relative jump between
 *                adjacent sentences.  High when the writer alternates,
 *                zero when every sentence is the same size.
 *   - range:     windowed coefficient of variation — is there enough
 *                dynamic range locally, not just across the whole doc.
 *   - monotony:  penalty for long runs of near-equal values, the salient
 *                failure ("six 20-word sentences in a row") that averages
 *                can hide.
 *
 * Categorical channel (sentence structure):
 *   - variety:   Gini–Simpson index — probability two random sentences
 *                differ in type.
 *   - novelty:   adjacent-repeat rate compared to what the type mix
 *                predicts by chance.  Order-sensitive: rewards writers
 *                who alternate structure more than random, penalizes
 *                block-repeats.
 *   - monotony:  penalty for long same-type runs.
 *
 * Raw values pass through smooth "band maps" (plateau of full credit,
 * soft shoulders) so that both too little variation and mechanical
 * extremes (strict short/long alternation) lose credit.  Anchors are
 * calibrated against the corpus in scripts/flow-bench.ts.
 */

export interface BandAnchors {
	/** Score rises from 0 at `a` to 1 at `b`, plateaus to `c`, falls to `floor` at `d`. */
	a: number;
	b: number;
	c: number;
	d: number;
	floor: number;
}

export interface ChannelFlow {
	/** Channel score, 0–1. */
	score: number;
	/** Mapped contrast (numeric: nPVI; categorical: novelty vs chance), 0–1. */
	contrast: number;
	/** Raw contrast value before mapping (nPVI 0–200, or novelty −1..1). */
	rawContrast: number;
	/** Mapped range (numeric: windowed CV; categorical: variety), 0–1. */
	range: number;
	/** Raw range value before mapping (CV, or Gini–Simpson 0–1). */
	rawRange: number;
	/** Monotony multiplier, 1 = no penalty. */
	monotonyFactor: number;
	/** Mechanical-pattern multiplier (lag-2 periodicity), 1 = no penalty. */
	periodicityFactor: number;
	/** Longest run of near-equal values / same type. */
	longestRun: number;
	/** For categorical channels, the type of the longest run. */
	runType: SentenceType | null;
}

const EMPTY_CHANNEL: ChannelFlow = {
	score: 0,
	contrast: 0,
	rawContrast: 0,
	range: 0,
	rawRange: 0,
	monotonyFactor: 1,
	periodicityFactor: 1,
	longestRun: 0,
	runType: null,
};

function smoothstep(edge0: number, edge1: number, x: number): number {
	if (edge1 <= edge0) return x < edge0 ? 0 : 1;
	const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/** Smooth trapezoid: 0 below a, full credit in [b, c], floor beyond d. */
export function bandMap(x: number, band: BandAnchors): number {
	if (!Number.isFinite(x)) return 0;
	const rise = smoothstep(band.a, band.b, x);
	const fall = Number.isFinite(band.d) ? smoothstep(band.c, band.d, x) : 0;
	return rise * (1 - fall * (1 - band.floor));
}

/**
 * Normalized pairwise variability index: 100 × mean of
 * |x[i+1] − x[i]| / pairMean.  0 = every neighbor identical,
 * 200 = maximal alternation.
 */
export function npvi(values: number[]): number {
	let sum = 0;
	let count = 0;
	for (let i = 0; i < values.length - 1; i++) {
		const m = (values[i]! + values[i + 1]!) / 2;
		if (m <= 0) continue;
		sum += Math.abs(values[i + 1]! - values[i]!) / m;
		count++;
	}
	return count === 0 ? 0 : (100 * sum) / count;
}

function cv(values: number[]): number {
	const n = values.length;
	if (n < 2) return 0;
	const mean = values.reduce((a, b) => a + b, 0) / n;
	if (mean <= 1e-12) return 0;
	const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
	return Math.sqrt(variance) / mean;
}

/**
 * Mean CV over sliding windows, so a doc that is monotone in each half
 * but different between halves doesn't get credit for global variance.
 */
export function windowedCv(values: number[], windowSize = 10): number {
	const n = values.length;
	if (n < 2) return 0;
	if (n <= windowSize) return cv(values);

	let sum = 0;
	const count = n - windowSize + 1;
	for (let start = 0; start < count; start++) {
		sum += cv(values.slice(start, start + windowSize));
	}
	return sum / count;
}

/** Longest chain of adjacent values within relTol relative difference. */
export function longestNearRun(values: number[], relTol = 0.2): number {
	if (values.length === 0) return 0;
	let longest = 1;
	let run = 1;
	for (let i = 0; i < values.length - 1; i++) {
		const m = (values[i]! + values[i + 1]!) / 2;
		const same = m <= 0 ? true : Math.abs(values[i + 1]! - values[i]!) / m < relTol;
		run = same ? run + 1 : 1;
		if (run > longest) longest = run;
	}
	return longest;
}

function longestSameRun(types: SentenceType[]): { run: number; type: SentenceType | null } {
	if (types.length === 0) return { run: 0, type: null };
	let longest = 1;
	let longestType = types[0]!;
	let run = 1;
	for (let i = 1; i < types.length; i++) {
		run = types[i] === types[i - 1] ? run + 1 : 1;
		if (run > longest) {
			longest = run;
			longestType = types[i]!;
		}
	}
	return { run: longest, type: longestType };
}

/** Runs up to 3 are free; beyond that the multiplier decays toward 0.35. */
function monotonyFactor(run: number): number {
	if (run <= 3) return 1;
	return 0.35 + 0.65 * Math.exp(-(run - 3) / 4);
}

/**
 * Fraction of positions whose value nearly repeats two steps later.
 * Mechanical alternation (short/long/short/long) hits ~1.0; real prose,
 * even highly varied, stays well below the penalty threshold.
 */
export function lag2Periodicity(values: number[], relTol: number): number {
	const n = values.length;
	if (n < 6) return 0;
	let near = 0;
	for (let i = 0; i < n - 2; i++) {
		const m = (values[i]! + values[i + 2]!) / 2;
		if (m <= 0 || Math.abs(values[i + 2]! - values[i]!) / m < relTol) near++;
	}
	return near / (n - 2);
}

/** No penalty below 55% lag-2 repetition, down to ×0.3 at 90%+. */
function periodicityFactor(p2: number): number {
	return 1 - 0.7 * smoothstep(0.55, 0.9, p2);
}

export interface NumericAnchors {
	contrast: BandAnchors;
	range: BandAnchors;
	/** Relative tolerance for "near-equal" in run and periodicity detection. */
	runTol: number;
}

/** Sentence lengths vary a lot in good prose — wide plateau, penalize metronomes. */
export const SENTENCE_LENGTH_ANCHORS: NumericAnchors = {
	contrast: { a: 12, b: 40, c: 100, d: 160, floor: 0.25 },
	range: { a: 0.08, b: 0.28, c: 0.85, d: 1.5, floor: 0.4 },
	runTol: 0.2,
};

/** Per-sentence mean word length moves in a much narrower band. */
export const WORD_LENGTH_ANCHORS: NumericAnchors = {
	contrast: { a: 3, b: 11, c: 40, d: 80, floor: 0.3 },
	range: { a: 0.02, b: 0.07, c: 0.3, d: 0.6, floor: 0.4 },
	runTol: 0.06,
};

const VARIETY_BAND: BandAnchors = { a: 0.05, b: 0.45, c: 1, d: Infinity, floor: 1 };

/** Max Gini–Simpson with 5 categories, for normalization. */
const MAX_GINI = 1 - 1 / 5;

export function numericChannelFlow(values: number[], anchors: NumericAnchors): ChannelFlow {
	if (values.length < 2) return { ...EMPTY_CHANNEL };

	const rawContrast = npvi(values);
	const rawRange = windowedCv(values);
	const contrast = bandMap(rawContrast, anchors.contrast);
	const range = bandMap(rawRange, anchors.range);
	const longestRun = longestNearRun(values, anchors.runTol);
	const mono = monotonyFactor(longestRun);
	const periodic = periodicityFactor(lag2Periodicity(values, anchors.runTol));

	const score = (0.6 * contrast + 0.4 * range) * mono * periodic;

	return {
		score: round3(score),
		contrast: round3(contrast),
		rawContrast: round3(rawContrast),
		range: round3(range),
		rawRange: round3(rawRange),
		monotonyFactor: round3(mono),
		periodicityFactor: round3(periodic),
		longestRun,
		runType: null,
	};
}

export function categoricalChannelFlow(types: SentenceType[]): ChannelFlow {
	const n = types.length;
	if (n < 2) return { ...EMPTY_CHANNEL };

	const counts = new Map<SentenceType, number>();
	for (const t of types) {
		counts.set(t, (counts.get(t) ?? 0) + 1);
	}

	let sumSq = 0;
	for (const c of counts.values()) {
		sumSq += (c / n) ** 2;
	}

	const variety = Math.max(0, Math.min(1, (1 - sumSq) / MAX_GINI));
	const varietyMapped = bandMap(variety, VARIETY_BAND);

	let repeats = 0;
	for (let i = 1; i < n; i++) {
		if (types[i] === types[i - 1]) repeats++;
	}
	const actualRepeat = repeats / (n - 1);
	const expectedRepeat = sumSq;
	const novelty = Math.max(-1, Math.min(1, 1 - actualRepeat / Math.max(expectedRepeat, 1e-9)));
	const noveltyMapped = 0.5 + 0.5 * novelty;

	const { run, type } = longestSameRun(types);
	const mono = monotonyFactor(run);

	const score = (0.55 * varietyMapped + 0.45 * noveltyMapped) * mono;

	return {
		score: round3(score),
		contrast: round3(noveltyMapped),
		rawContrast: round3(novelty),
		range: round3(varietyMapped),
		rawRange: round3(variety),
		monotonyFactor: round3(mono),
		periodicityFactor: 1,
		longestRun: run,
		runType: type,
	};
}

/**
 * Reliability of the estimate given how many sentences it saw.
 * ~0.55 at 9 sentences, ~0.86 at 21, ~0.96 at 33.  Reported alongside
 * the score rather than baked into it — a short note gets an honest
 * score with an honest caveat, not a zero.
 */
export function flowConfidence(sentenceCount: number): number {
	if (sentenceCount < 2) return 0;
	return round3(1 - Math.exp(-(sentenceCount - 1) / 10));
}

export const CHANNEL_WEIGHTS = {
	sentenceLength: 0.45,
	structure: 0.35,
	wordLength: 0.2,
};

export function compositeFlow(
	sentenceLength: ChannelFlow,
	structure: ChannelFlow,
	wordLength: ChannelFlow,
): number {
	return round3(
		CHANNEL_WEIGHTS.sentenceLength * sentenceLength.score +
			CHANNEL_WEIGHTS.structure * structure.score +
			CHANNEL_WEIGHTS.wordLength * wordLength.score,
	);
}

function round3(x: number): number {
	return Math.round(x * 1000) / 1000;
}
