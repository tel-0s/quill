import {
	Paragraph,
	ParagraphAnalysis,
	DocumentAnalysis,
	DocumentFlowScores,
	LocalFlow,
	QuillSettings,
	Sentence,
	SentenceType,
	StructuralFlowResult,
	SentenceLengthResult,
	WordLengthResult,
} from "./types";
import { classifyAllSentences, computeStructuralFlow } from "./classifiers/sentenceType";
import { analyzeSentenceLength } from "./classifiers/sentenceLength";
import { analyzeWordLength } from "./classifiers/wordLength";
import { tokenize } from "./tokenizer";
import {
	categoricalChannelFlow,
	compositeFlow,
	flowConfidence,
	numericChannelFlow,
	SENTENCE_LENGTH_ANCHORS,
	WORD_LENGTH_ANCHORS,
} from "./flow";

function analyzeParagraph(paragraph: Paragraph, settings: QuillSettings): ParagraphAnalysis {
	classifyAllSentences(paragraph.sentences);

	const structural = computeStructuralFlow(paragraph.sentences);
	const sentenceLength = analyzeSentenceLength(
		paragraph.sentences,
		settings.longSentenceThreshold,
	);
	const wordLength = analyzeWordLength(
		paragraph.sentences,
		settings.shortWordMax,
		settings.longWordMin,
	);

	return {
		paragraph,
		structural,
		sentenceLength,
		wordLength,
		localFlow: { score: 0, hint: null },
	};
}

function mergeStructural(analyses: ParagraphAnalysis[]): StructuralFlowResult {
	const counts: Record<SentenceType, number> = {
		[SentenceType.Fragment]: 0,
		[SentenceType.Simple]: 0,
		[SentenceType.Compound]: 0,
		[SentenceType.Complex]: 0,
		[SentenceType.CompoundComplex]: 0,
	};

	for (const a of analyses) {
		for (const t of Object.values(SentenceType)) {
			counts[t] += a.structural.counts[t];
		}
	}

	const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
	const distribution: Record<SentenceType, number> = {} as Record<SentenceType, number>;
	for (const t of Object.values(SentenceType)) {
		distribution[t] = counts[t] / total;
	}

	return { counts, distribution };
}

function mergeSentenceLength(analyses: ParagraphAnalysis[], threshold: number): SentenceLengthResult {
	const lengths = analyses.flatMap((a) => a.sentenceLength.lengths);
	if (lengths.length === 0) {
		return { lengths: [], mean: 0, standardDeviation: 0, longSentenceFraction: 0 };
	}

	const n = lengths.length;
	const sum = lengths.reduce((a, b) => a + b, 0);
	const mean = sum / n;
	const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
	const longCount = lengths.filter((l) => l >= threshold).length;

	return {
		lengths,
		mean: Math.round(mean * 10) / 10,
		standardDeviation: Math.round(Math.sqrt(variance) * 10) / 10,
		longSentenceFraction: Math.round((longCount / n) * 100) / 100,
	};
}

function mergeWordLength(analyses: ParagraphAnalysis[]): WordLengthResult {
	const allMeans = analyses
		.filter((a) => a.paragraph.sentences.length > 0)
		.map((a) => ({
			charLen: a.wordLength.meanCharLength,
			syllables: a.wordLength.meanSyllables,
			words: a.paragraph.sentences.reduce((s, sent) => s + sent.wordCount, 0),
			buckets: a.wordLength.buckets,
		}));

	if (allMeans.length === 0) {
		return { meanCharLength: 0, meanSyllables: 0, buckets: { short: 0, medium: 0, long: 0 } };
	}

	const totalWords = allMeans.reduce((s, m) => s + m.words, 0) || 1;
	const weightedChar = allMeans.reduce((s, m) => s + m.charLen * m.words, 0);
	const weightedSyl = allMeans.reduce((s, m) => s + m.syllables * m.words, 0);
	const weightedShort = allMeans.reduce((s, m) => s + m.buckets.short * m.words, 0);
	const weightedMedium = allMeans.reduce((s, m) => s + m.buckets.medium * m.words, 0);
	const weightedLong = allMeans.reduce((s, m) => s + m.buckets.long * m.words, 0);

	return {
		meanCharLength: Math.round((weightedChar / totalWords) * 10) / 10,
		meanSyllables: Math.round((weightedSyl / totalWords) * 10) / 10,
		buckets: {
			short: weightedShort / totalWords,
			medium: weightedMedium / totalWords,
			long: weightedLong / totalWords,
		},
	};
}

function meanWordLength(s: Sentence): number {
	if (s.words.length === 0) return 0;
	return s.words.reduce((sum, w) => sum + w.charLength, 0) / s.words.length;
}

function scoreSentences(sentences: Sentence[]): DocumentFlowScores {
	const lengths = sentences.map((s) => s.wordCount);
	const wordMeans = sentences.map(meanWordLength);
	const types = sentences.map((s) => s.type);

	const sentenceLength = numericChannelFlow(lengths, SENTENCE_LENGTH_ANCHORS);
	const wordLength = numericChannelFlow(wordMeans, WORD_LENGTH_ANCHORS);
	const structure = categoricalChannelFlow(types);

	return {
		sentenceLength,
		structure,
		wordLength,
		composite: compositeFlow(sentenceLength, structure, wordLength),
		confidence: flowConfidence(sentences.length),
	};
}

const LOCAL_WINDOW_PAD = 4;
const LOCAL_WINDOW_MIN = 8;
const LOCAL_HINT_THRESHOLD = 0.5;

function localHint(flow: DocumentFlowScores): string | null {
	if (flow.composite >= LOCAL_HINT_THRESHOLD) return null;

	const { sentenceLength, structure } = flow;
	if (sentenceLength.longestRun >= 4) {
		return `${sentenceLength.longestRun} similar-length sentences in a row`;
	}
	if (structure.longestRun >= 4 && structure.runType) {
		return `${structure.longestRun}× ${structure.runType} in a row`;
	}
	if (sentenceLength.contrast < 0.35) {
		return "sentence lengths barely vary here";
	}
	if (structure.range < 0.35) {
		return "little structural variety here";
	}
	return null;
}

/**
 * Flow for the window of sentences around each paragraph (the paragraph
 * plus up to LOCAL_WINDOW_PAD neighbors on each side), so monotonous
 * stretches are localized instead of diluted into the document score.
 */
function computeLocalFlows(analyses: ParagraphAnalysis[], allSentences: Sentence[]): void {
	let cursor = 0;
	for (const a of analyses) {
		const count = a.paragraph.sentences.length;
		let start = cursor - LOCAL_WINDOW_PAD;
		let end = cursor + count + LOCAL_WINDOW_PAD;
		cursor += count;

		if (end - start < LOCAL_WINDOW_MIN) {
			const deficit = LOCAL_WINDOW_MIN - (end - start);
			start -= Math.ceil(deficit / 2);
			end += Math.floor(deficit / 2);
		}
		start = Math.max(0, start);
		end = Math.min(allSentences.length, end);

		const window = allSentences.slice(start, end);
		const flow = scoreSentences(window);
		const localFlow: LocalFlow = {
			score: flow.composite,
			hint: localHint(flow),
		};
		a.localFlow = localFlow;
	}
}

export function analyzeDocument(markdownText: string, settings: QuillSettings): DocumentAnalysis {
	const paragraphs = tokenize(markdownText);
	const analyses = paragraphs.map((p) => analyzeParagraph(p, settings));

	const totalSentences = paragraphs.reduce((s, p) => s + p.sentences.length, 0);
	const totalWords = paragraphs.reduce(
		(s, p) => s + p.sentences.reduce((ws, sent) => ws + sent.wordCount, 0),
		0,
	);

	const allSentences = analyses.flatMap((a) => a.paragraph.sentences);
	computeLocalFlows(analyses, allSentences);

	return {
		paragraphs: analyses,
		totalSentences,
		totalWords,
		overallStructural: mergeStructural(analyses),
		overallSentenceLength: mergeSentenceLength(analyses, settings.longSentenceThreshold),
		overallWordLength: mergeWordLength(analyses),
		flow: scoreSentences(allSentences),
	};
}
