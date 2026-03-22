export enum SentenceType {
	Fragment = "fragment",
	Simple = "simple",
	Compound = "compound",
	Complex = "complex",
	CompoundComplex = "compound-complex",
}

export interface Word {
	text: string;
	charLength: number;
	syllableCount: number;
}

export interface Sentence {
	text: string;
	words: Word[];
	wordCount: number;
	type: SentenceType;
}

export interface Paragraph {
	text: string;
	sentences: Sentence[];
	/** 0-based offset of this paragraph in the original document (character index). */
	offset: number;
}

export interface StructuralFlowResult {
	counts: Record<SentenceType, number>;
	/** Fraction of each type (sums to 1). */
	distribution: Record<SentenceType, number>;
}

export interface SentenceLengthResult {
	lengths: number[];
	mean: number;
	standardDeviation: number;
	longSentenceFraction: number;
}

export interface WordLengthBuckets {
	short: number;
	medium: number;
	long: number;
}

export interface WordLengthResult {
	meanCharLength: number;
	meanSyllables: number;
	buckets: WordLengthBuckets;
}

export interface ParagraphAnalysis {
	paragraph: Paragraph;
	structural: StructuralFlowResult;
	sentenceLength: SentenceLengthResult;
	wordLength: WordLengthResult;
}

export interface FlowScore {
	/** Composite score (0–1). Derived from Hurst exponent and spectrum width. */
	score: number;
	/** DFA scaling exponent. 0.5=noise, ~0.75=structured, 1.0=1/f, 1.5=Brownian. */
	alpha: number;
	/** R² of the log-log scaling fit. */
	fitR2: number;
	/** Multifractal spectrum width. 0=monofractal, higher=richer variation. */
	spectrumWidth: number;
}

export interface DocumentFlowScores {
	structural: FlowScore;
	sentenceLength: FlowScore;
	wordLength: FlowScore;
	/** Mean of the three component scores. */
	composite: number;
}

export interface DocumentAnalysis {
	paragraphs: ParagraphAnalysis[];
	totalSentences: number;
	totalWords: number;
	overallStructural: StructuralFlowResult;
	overallSentenceLength: SentenceLengthResult;
	overallWordLength: WordLengthResult;
	flow: DocumentFlowScores;
}

export interface QuillSettings {
	longSentenceThreshold: number;
	shortWordMax: number;
	longWordMin: number;
	debounceMs: number;
	colors: {
		fragment: string;
		simple: string;
		compound: string;
		complex: string;
		compoundComplex: string;
		sentenceShort: string;
		sentenceLong: string;
		wordShort: string;
		wordLong: string;
	};
}

export const DEFAULT_SETTINGS: QuillSettings = {
	longSentenceThreshold: 25,
	shortWordMax: 3,
	longWordMin: 7,
	debounceMs: 500,
	colors: {
		fragment: "#ef4444",
		simple: "#8b5cf6",
		compound: "#f59e0b",
		complex: "#10b981",
		compoundComplex: "#3b82f6",
		sentenceShort: "#93c5fd",
		sentenceLong: "#1e40af",
		wordShort: "#86efac",
		wordLong: "#166534",
	},
};
