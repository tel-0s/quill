import { Sentence, WordLengthResult } from "../types";

export function analyzeWordLength(
	sentences: Sentence[],
	shortWordMax: number,
	longWordMin: number,
): WordLengthResult {
	const allWords = sentences.flatMap((s) => s.words);
	if (allWords.length === 0) {
		return {
			meanCharLength: 0,
			meanSyllables: 0,
			buckets: { short: 0, medium: 0, long: 0 },
		};
	}

	const totalChars = allWords.reduce((sum, w) => sum + w.charLength, 0);
	const totalSyllables = allWords.reduce((sum, w) => sum + w.syllableCount, 0);
	const n = allWords.length;

	let shortCount = 0;
	let longCount = 0;
	for (const w of allWords) {
		if (w.charLength <= shortWordMax) shortCount++;
		else if (w.charLength >= longWordMin) longCount++;
	}
	const mediumCount = n - shortCount - longCount;

	return {
		meanCharLength: Math.round((totalChars / n) * 10) / 10,
		meanSyllables: Math.round((totalSyllables / n) * 10) / 10,
		buckets: {
			short: shortCount / n,
			medium: mediumCount / n,
			long: longCount / n,
		},
	};
}
