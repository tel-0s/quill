import { Sentence, SentenceLengthResult } from "../types";

export function analyzeSentenceLength(
	sentences: Sentence[],
	longThreshold: number,
): SentenceLengthResult {
	const lengths = sentences.map((s) => s.wordCount);
	if (lengths.length === 0) {
		return { lengths: [], mean: 0, standardDeviation: 0, longSentenceFraction: 0 };
	}

	const n = lengths.length;
	const sum = lengths.reduce((a, b) => a + b, 0);
	const mean = sum / n;

	const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
	const standardDeviation = Math.sqrt(variance);

	const longCount = lengths.filter((l) => l >= longThreshold).length;

	return {
		lengths,
		mean: Math.round(mean * 10) / 10,
		standardDeviation: Math.round(standardDeviation * 10) / 10,
		longSentenceFraction: Math.round((longCount / n) * 100) / 100,
	};
}
