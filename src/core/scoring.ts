import {
	Paragraph,
	ParagraphAnalysis,
	DocumentAnalysis,
	DocumentFlowScores,
	FlowScore,
	QuillSettings,
	SentenceType,
	StructuralFlowResult,
	SentenceLengthResult,
	WordLengthResult,
} from "./types";
import { classifyAllSentences, computeStructuralFlow } from "./classifiers/sentenceType";
import { analyzeSentenceLength } from "./classifiers/sentenceLength";
import { analyzeWordLength } from "./classifiers/wordLength";
import { tokenize } from "./tokenizer";
import { computeDfa, DfaResult } from "./dfa";

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

	return { paragraph, structural, sentenceLength, wordLength };
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

const COMPLEXITY_MAP: Record<SentenceType, number> = {
	[SentenceType.Fragment]: 0,
	[SentenceType.Simple]: 1,
	[SentenceType.Compound]: 2,
	[SentenceType.Complex]: 3,
	[SentenceType.CompoundComplex]: 4,
};

function computeFlowScores(analyses: ParagraphAnalysis[]): DocumentFlowScores {
	const allSentences = analyses.flatMap((a) => a.paragraph.sentences);

	const structuralSeries = allSentences.map((s) => COMPLEXITY_MAP[s.type]);
	const sentLengthSeries = allSentences.map((s) => s.wordCount);
	const wordLengthSeries = allSentences.map((s) => {
		if (s.words.length === 0) return 0;
		return s.words.reduce((sum, w) => sum + w.charLength, 0) / s.words.length;
	});

	const structDfa = computeDfa(structuralSeries);
	const sentDfa = computeDfa(sentLengthSeries);
	const wordDfa = computeDfa(wordLengthSeries);

	const toScore = (dfa: DfaResult): FlowScore => ({
		score: dfa.score,
		alpha: dfa.alpha,
		fitR2: dfa.fitR2,
		spectrumWidth: dfa.spectrumWidth,
	});

	const composite = Math.round(
		((structDfa.score + sentDfa.score + wordDfa.score) / 3) * 1000,
	) / 1000;

	return {
		structural: toScore(structDfa),
		sentenceLength: toScore(sentDfa),
		wordLength: toScore(wordDfa),
		composite,
	};
}

export function analyzeDocument(markdownText: string, settings: QuillSettings): DocumentAnalysis {
	const paragraphs = tokenize(markdownText);
	const analyses = paragraphs.map((p) => analyzeParagraph(p, settings));

	const totalSentences = paragraphs.reduce((s, p) => s + p.sentences.length, 0);
	const totalWords = paragraphs.reduce(
		(s, p) => s + p.sentences.reduce((ws, sent) => ws + sent.wordCount, 0),
		0,
	);

	return {
		paragraphs: analyses,
		totalSentences,
		totalWords,
		overallStructural: mergeStructural(analyses),
		overallSentenceLength: mergeSentenceLength(analyses, settings.longSentenceThreshold),
		overallWordLength: mergeWordLength(analyses),
		flow: computeFlowScores(analyses),
	};
}
