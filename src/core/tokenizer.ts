import { Paragraph, Sentence, Word, SentenceType } from "./types";

const MARKDOWN_PATTERNS: [RegExp, string][] = [
	[/^#{1,6}\s+/gm, ""],           // headings
	[/!\[([^\]]*)\]\([^)]*\)/g, ""], // images
	[/\[([^\]]*)\]\([^)]*\)/g, "$1"], // links -> keep text
	[/(`{3}[\s\S]*?`{3}|`[^`]+`)/g, ""], // code blocks and inline code
	[/^>+\s?/gm, ""],               // blockquotes
	[/^[-*+]\s+/gm, ""],            // unordered list markers
	[/^\d+\.\s+/gm, ""],            // ordered list markers
	[/^---+$/gm, ""],               // horizontal rules
	[/(\*{1,3}|_{1,3})(.*?)\1/g, "$2"], // bold/italic
	[/~~(.*?)~~/g, "$1"],           // strikethrough
	[/\^(\S+)/g, "$1"],             // footnote markers
];

/** Common abbreviations that shouldn't trigger sentence boundaries. */
const ABBREVIATIONS = new Set([
	"mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
	"vs", "etc", "inc", "ltd", "dept", "est",
	"jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
	"fig", "approx", "govt", "gen", "sgt", "cpl", "pvt",
	"i.e", "e.g", "cf", "al",
]);

export function stripMarkdown(text: string): string {
	let result = text;
	for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
		result = result.replace(pattern, replacement);
	}
	return result;
}

export function splitParagraphs(text: string): { text: string; offset: number }[] {
	const paragraphs: { text: string; offset: number }[] = [];
	const raw = text.split(/\n\s*\n/);
	let cursor = 0;

	for (const block of raw) {
		const trimmed = block.trim();
		if (trimmed.length > 0) {
			const idx = text.indexOf(block, cursor);
			paragraphs.push({ text: trimmed, offset: idx >= 0 ? idx : cursor });
			if (idx >= 0) {
				cursor = idx + block.length;
			}
		}
	}
	return paragraphs;
}

export function splitSentences(text: string): string[] {
	const sentences: string[] = [];
	let buffer = "";

	const tokens = text.split(/(\s+)/);
	for (const token of tokens) {
		buffer += token;

		if (/[.!?]["'\u201D\u2019)]*$/.test(token.trim())) {
			const word = token.trim().replace(/[.!?]["'\u201D\u2019)]*$/, "").toLowerCase();
			if (ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.replace(/\./g, ""))) {
				continue;
			}
			if (/\.\.\.$/.test(token.trim())) {
				sentences.push(buffer.trim());
				buffer = "";
				continue;
			}
			sentences.push(buffer.trim());
			buffer = "";
		}
	}

	const remaining = buffer.trim();
	if (remaining.length > 0) {
		if (sentences.length > 0 && remaining.length < 3) {
			sentences[sentences.length - 1] += " " + remaining;
		} else {
			sentences.push(remaining);
		}
	}

	return sentences.filter((s) => s.length > 0);
}

export function splitWords(sentence: string): string[] {
	return sentence
		.replace(/[^\w'\u2019-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 0);
}

export function countSyllables(word: string): number {
	const w = word.toLowerCase().replace(/[^a-z]/g, "");
	if (w.length <= 2) return 1;

	let count = 0;
	let prevVowel = false;
	const vowels = "aeiouy";

	for (let i = 0; i < w.length; i++) {
		const isVowel = vowels.includes(w[i]!);
		if (isVowel && !prevVowel) {
			count++;
		}
		prevVowel = isVowel;
	}

	if (w.endsWith("e") && !w.endsWith("le") && count > 1) {
		count--;
	}
	if (w.endsWith("le") && w.length > 2 && !vowels.includes(w[w.length - 3]!)) {
		count++;
	}
	if (w.endsWith("ed") && count > 1) {
		const beforeEd = w[w.length - 3];
		if (beforeEd && beforeEd !== "t" && beforeEd !== "d") {
			count--;
		}
	}

	return Math.max(1, count);
}

function makeWord(text: string): Word {
	const cleaned = text.replace(/[^a-zA-Z\u00C0-\u024F]/g, "");
	return {
		text,
		charLength: cleaned.length || text.length,
		syllableCount: countSyllables(text),
	};
}

/**
 * Tokenize raw markdown into a structured document hierarchy.
 * Sentence types are initialized to Simple and must be classified separately.
 */
export function tokenize(markdownText: string): Paragraph[] {
	const stripped = stripMarkdown(markdownText);
	const rawParagraphs = splitParagraphs(stripped);

	return rawParagraphs.map(({ text, offset }) => {
		const rawSentences = splitSentences(text);
		const sentences: Sentence[] = rawSentences.map((s) => {
			const wordTexts = splitWords(s);
			const words = wordTexts.map(makeWord);
			return {
				text: s,
				words,
				wordCount: words.length,
				type: SentenceType.Simple,
			};
		});

		return { text, sentences, offset };
	});
}
