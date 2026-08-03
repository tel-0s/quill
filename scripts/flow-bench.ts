/**
 * Flow metric benchmark: scores known-good prose against degenerate
 * baselines with both the old DFA composite and the new rhythm metric.
 *
 * Success criteria:
 *   1. Real prose (varied literary, Melville, Austen, House of Glass)
 *      scores clearly above every degenerate baseline.
 *   2. Degenerate baselines (constant, monotone academic, mechanical
 *      alternation) score low.
 *   3. Stability: deleting a single sentence moves the score only a little.
 *
 * Run:
 *   npx esbuild scripts/flow-bench.ts --bundle --platform=node --outfile=scripts/flow-bench.cjs && node scripts/flow-bench.cjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeDocument } from "../src/core/scoring";
import { DEFAULT_SETTINGS, Sentence, SentenceType } from "../src/core/types";
import { computeDfa } from "../src/core/dfa";
import { tokenize } from "../src/core/tokenizer";

// ---------------------------------------------------------------- corpora

const GOOD_VARIED = `The letter arrived on a Tuesday. Nobody expected it, least of all Marta, who had spent the better part of a decade convincing herself that the past was a country she would never revisit. She read it twice. Then she set it on the kitchen table, poured herself a glass of water, and stood at the window watching the neighbor's dog chase shadows across the lawn.

The handwriting was unmistakable. Her brother wrote the way he lived — in long, looping strokes that crowded the margins and ignored every line, as if the page itself were merely a suggestion. He wanted money. Of course he wanted money, and beneath the elaborate apology and the news of his daughter and the weather in Lisbon, that single fact sat like a stone in a stream, bending every sentence around it.

She could refuse. It would be easy: a short reply, polite and final, the kind she had drafted in her head a hundred times. But memory is not an account you close. When they were children he had carried her on his shoulders through the flooded orchard, and she had held on to his hair, shrieking, delighted, certain that nothing could touch them. That certainty had cost her plenty since. Still she kept it.

Outside, the dog gave up. The shadows won, as shadows do. Marta sat down at the table, took out a pen, and began — not the letter she had rehearsed, but a longer one, unruly, honest, the first true thing she had written in years. It ran to four pages. When she finished, the light had gone violet over the rooftops, and her water glass stood untouched, and she felt lighter than she had any right to feel.

She mailed it in the morning. Rain came by noon.`;

const HOUSE_OF_GLASS = `*Fire....*

There is only the singular flame. This fire is a black fire, and it burns without heat.

*Memories are consumed; centuries pass.* Then it is over.

The man who emerges -- for there is always a man -- walks slowly. A vast bridge of prismatic glass. Staircases of the same material wind upward, and there is no railing.

Wreathed in Shadow like a cloak. Not a man; not anything living.

THERE ARE FARMERS AND THERE ARE GARDENERS. THE FORMER TENDS HIS FIELD.

*"I..."* he halts, surprised by his own voice. "I think I've been trapped somewhere... a place between places."

INDEED. FOR YOU HAVE FOUND THIS GARDEN.

*"Are you the gardener of this place?"*

IN SOME SMALL WAY. IN TRUTH, EVERY GARDEN BELONGS TO ITSELF.

*"And may I enter this garden?"* he asks, because there is nothing else to ask.

THE GATE IS OPEN. SHOULD YOU CROSS, IN RETURN YOU MUST GIVE A NAME.

He speaks, and feels the word leave him like blood from a wound. "Elwin. My name is Elwin."

SO BE IT, YOUNG ELWIN.

The exchange is over. The tendrils of the inkblack fire withdraw, and the blackness is drawn up like a curtain.`;

const ACADEMIC_MONOTONE = `Although the committee reviewed the initial proposal in detail, the resulting framework demonstrates that institutional constraints shape organizational outcomes in most observed cases. Because the survey instrument was distributed across several departments, the collected responses indicate that procedural awareness varies considerably between administrative units in practice. While the previous literature emphasized structural factors above all else, the present analysis suggests that individual incentives play a comparable role in determining results. Since the sample population was drawn from a single region, the reported findings should be interpreted with appropriate caution regarding external validity concerns. Although the statistical model controlled for demographic variation, the estimated coefficients reveal that unobserved heterogeneity remains a significant limitation of the approach. Because the intervention was implemented gradually over several quarters, the measured effects capture both short-term adjustments and longer-term behavioral adaptation processes. While the qualitative interviews provided useful supplementary context, the coded transcripts confirm that participant interpretations diverge substantially from official policy documentation. Since the funding environment changed midway through the study period, the observed trends partly reflect external pressures rather than internal program dynamics. Although the replication exercise followed the original protocol closely, the obtained estimates differ noticeably from the published benchmarks in several important respects. Because the administrative records were incomplete for earlier years, the constructed panel necessarily excludes a number of potentially informative observations. While the robustness checks support the main specification overall, the sensitivity analysis indicates that certain assumptions drive a substantial portion of the results. Since the theoretical framework predicts heterogeneous responses across subgroups, the estimated interaction terms provide qualified support for the central hypothesis of the study. Although the policy implications appear straightforward at first glance, the institutional context suggests that implementation would encounter considerable practical resistance from stakeholders. Because the measurement strategy relied on self-reported outcomes, the documented improvements may partly reflect social desirability bias among the surveyed respondents. While the study contributes to an ongoing debate in the field, the accumulated evidence remains insufficient for definitive conclusions about the underlying mechanisms.`;

// -------------------------------------------------------- generated texts

function lcg(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
}

function joinIntoParagraphs(sentences: string[], perParagraph = 5): string {
	const paragraphs: string[] = [];
	for (let i = 0; i < sentences.length; i += perParagraph) {
		paragraphs.push(sentences.slice(i, i + perParagraph).join(" "));
	}
	return paragraphs.join("\n\n");
}

const CONSTANT = joinIntoParagraphs(
	Array.from({ length: 30 }, () => "The manager reviewed the quarterly report before the meeting."),
);

const ABAB = joinIntoParagraphs(
	Array.from({ length: 30 }, (_, i) =>
		i % 2 === 0
			? "The door opened."
			: "The visitor walked slowly across the long marble hallway toward the distant window while the evening light spread quietly over the polished floor and the silent furniture.",
	),
);

/** Grammatical filler sentences at iid-random target lengths (order carries no design). */
function randomLengthText(seed: number, count: number): string {
	const rand = lcg(seed);
	const pads = [
		"in the pale morning light",
		"beyond the narrow wooden bridge",
		"with a kind of practiced patience",
		"near the edge of the old harbor",
		"under a sky the color of slate",
		"after the last train had gone",
	];
	const sentences: string[] = [];
	for (let i = 0; i < count; i++) {
		const target = 3 + Math.floor(rand() * 38);
		let words = ["The", "captain", "watched", "the", "horizon"];
		while (words.length < target) {
			const pad = pads[Math.floor(rand() * pads.length)]!.split(" ");
			words = words.concat(pad);
		}
		sentences.push(words.slice(0, Math.max(3, target)).join(" ") + ".");
	}
	return joinIntoParagraphs(sentences);
}

function sentenceTexts(text: string): string[] {
	return tokenize(text).flatMap((p) => p.sentences.map((s) => s.text));
}

function shuffledText(text: string, seed: number): string {
	const sentences = sentenceTexts(text);
	const rand = lcg(seed);
	for (let i = sentences.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[sentences[i], sentences[j]] = [sentences[j]!, sentences[i]!];
	}
	return joinIntoParagraphs(sentences);
}

// ------------------------------------------------------------- old metric

const COMPLEXITY_MAP: Record<SentenceType, number> = {
	[SentenceType.Fragment]: 0,
	[SentenceType.Simple]: 1,
	[SentenceType.Compound]: 2,
	[SentenceType.Complex]: 3,
	[SentenceType.CompoundComplex]: 4,
};

function oldComposite(sentences: Sentence[]): number {
	const structural = computeDfa(sentences.map((s) => COMPLEXITY_MAP[s.type]));
	const length = computeDfa(sentences.map((s) => s.wordCount));
	const word = computeDfa(
		sentences.map((s) =>
			s.words.length === 0
				? 0
				: s.words.reduce((sum, w) => sum + w.charLength, 0) / s.words.length,
		),
	);
	return Math.round(((structural.score + length.score + word.score) / 3) * 1000) / 1000;
}

// ------------------------------------------------------------------ bench

interface BenchCase {
	name: string;
	text: string;
	/** good = real prose; bad = constructed degenerate; control = order-destroyed variant. */
	kind: "good" | "bad" | "ctrl";
}

/** scripts/corpus/*.txt: line 1 = display name, line 2 = source, rest = excerpt. */
function loadCorpus(): BenchCase[] {
	const dir = join(__dirname, "corpus");
	return readdirSync(dir)
		.filter((f) => f.endsWith(".txt"))
		.map((f) => {
			const lines = readFileSync(join(dir, f), "utf8").split("\n");
			return { name: lines[0]!, text: lines.slice(2).join("\n").trim(), kind: "good" as const };
		});
}

const CASES: BenchCase[] = [
	{ name: "varied literary", text: GOOD_VARIED, kind: "good" },
	{ name: "House of Glass", text: HOUSE_OF_GLASS, kind: "good" },
	{ name: "varied ×3 (long)", text: [GOOD_VARIED, GOOD_VARIED, GOOD_VARIED].join("\n\n"), kind: "good" },
	...loadCorpus(),
	{ name: "academic monotone", text: ACADEMIC_MONOTONE, kind: "bad" },
	{ name: "constant sentence", text: CONSTANT, kind: "bad" },
	{ name: "mechanical ABAB", text: ABAB, kind: "bad" },
	{ name: "iid random lengths", text: randomLengthText(42, 30), kind: "ctrl" },
	{ name: "varied (shuffled)", text: shuffledText(GOOD_VARIED, 7), kind: "ctrl" },
];

function fmt(x: number): string {
	return x.toFixed(3);
}

function pad(s: string, w: number): string {
	return s.length >= w ? s : s + " ".repeat(w - s.length);
}

const rows: { c: BenchCase; n: number; oldScore: number; flow: ReturnType<typeof analyzeDocument>["flow"] }[] = [];

for (const c of CASES) {
	const result = analyzeDocument(c.text, DEFAULT_SETTINGS);
	const sentences = result.paragraphs.flatMap((p) => p.paragraph.sentences);
	rows.push({ c, n: sentences.length, oldScore: oldComposite(sentences), flow: result.flow });
}

console.log(
	pad("case", 34) + pad("kind", 6) + pad("sents", 7) + pad("OLD", 8) + pad("NEW", 8) +
	pad("len", 8) + pad("struct", 8) + pad("word", 8) + "conf",
);
console.log("-".repeat(95));
for (const r of rows) {
	console.log(
		pad(r.c.name, 34) + pad(r.c.kind, 6) + pad(String(r.n), 7) +
		pad(fmt(r.oldScore), 8) + pad(fmt(r.flow.composite), 8) +
		pad(fmt(r.flow.sentenceLength.score), 8) + pad(fmt(r.flow.structure.score), 8) +
		pad(fmt(r.flow.wordLength.score), 8) + fmt(r.flow.confidence),
	);
}

// Detail dump for calibration.
console.log("\nchannel detail (raw values):");
for (const r of rows) {
	const f = r.flow;
	console.log(
		pad(r.c.name, 34) +
		`len[nPVI=${fmt(f.sentenceLength.rawContrast)} cv=${fmt(f.sentenceLength.rawRange)} run=${f.sentenceLength.longestRun}] ` +
		`struct[nov=${fmt(f.structure.rawContrast)} var=${fmt(f.structure.rawRange)} run=${f.structure.longestRun}] ` +
		`word[nPVI=${fmt(f.wordLength.rawContrast)} cv=${fmt(f.wordLength.rawRange)} run=${f.wordLength.longestRun}]`,
	);
}

// ------------------------------------------------------- separation check

const goodScores = rows.filter((r) => r.c.kind === "good");
const badScores = rows.filter((r) => r.c.kind === "bad");
const ctrlScores = rows.filter((r) => r.c.kind === "ctrl");

const worstGoodNew = Math.min(...goodScores.map((r) => r.flow.composite));
const bestBadNew = Math.max(...badScores.map((r) => r.flow.composite));
const worstGoodOld = Math.min(...goodScores.map((r) => r.oldScore));
const bestBadOld = Math.max(...badScores.map((r) => r.oldScore));

console.log("\nseparation (worst good − best degenerate):");
console.log(`  old: ${fmt(worstGoodOld)} − ${fmt(bestBadOld)} = ${fmt(worstGoodOld - bestBadOld)}`);
console.log(`  new: ${fmt(worstGoodNew)} − ${fmt(bestBadNew)} = ${fmt(worstGoodNew - bestBadNew)}  ${worstGoodNew > bestBadNew ? "PASS" : "FAIL"}`);
console.log(
	`  order-destroyed controls: ${ctrlScores.map((r) => `${r.c.name}=${fmt(r.flow.composite)}`).join(", ")}`,
);

// -------------------------------------------------------- stability check

function stability(text: string): { maxDeltaNew: number; maxDeltaOld: number } {
	const base = analyzeDocument(text, DEFAULT_SETTINGS);
	const baseSentences = base.paragraphs.flatMap((p) => p.paragraph.sentences);
	const baseOld = oldComposite(baseSentences);
	const texts = sentenceTexts(text);

	let maxDeltaNew = 0;
	let maxDeltaOld = 0;
	const step = Math.max(1, Math.floor(texts.length / 6));
	for (let i = 0; i < texts.length; i += step) {
		const edited = joinIntoParagraphs(texts.filter((_, j) => j !== i));
		const result = analyzeDocument(edited, DEFAULT_SETTINGS);
		const sentences = result.paragraphs.flatMap((p) => p.paragraph.sentences);
		maxDeltaNew = Math.max(maxDeltaNew, Math.abs(result.flow.composite - base.flow.composite));
		maxDeltaOld = Math.max(maxDeltaOld, Math.abs(oldComposite(sentences) - baseOld));
	}
	return { maxDeltaNew, maxDeltaOld };
}

const stab = stability(GOOD_VARIED);
console.log("\nstability (max |Δcomposite| deleting one sentence, varied literary):");
console.log(`  old: ${fmt(stab.maxDeltaOld)}`);
console.log(`  new: ${fmt(stab.maxDeltaNew)}  ${stab.maxDeltaNew < 0.08 ? "PASS" : "FAIL"}`);

// ------------------------------------------------------ short-doc check

const SHORT_NOTE = `The meeting ran long. Nobody minded, because the plan finally made sense. We ship on Thursday.`;
const shortResult = analyzeDocument(SHORT_NOTE, DEFAULT_SETTINGS);
console.log("\nshort note (3 sentences):");
console.log(`  new: ${fmt(shortResult.flow.composite)} (confidence ${fmt(shortResult.flow.confidence)}) — old metric returned hard 0`);
