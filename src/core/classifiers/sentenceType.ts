import nlp from "compromise";
import { Sentence, SentenceType, StructuralFlowResult } from "../types";

const SUBORDINATING_CONJUNCTIONS = new Set([
	"after", "although", "as", "because", "before", "even",
	"if", "once", "provided", "since", "so", "than", "that",
	"though", "till", "unless", "until", "when", "whenever",
	"where", "whereas", "wherever", "whether", "while",
]);

const RELATIVE_PRONOUNS = new Set([
	"who", "whom", "whose", "which", "that",
]);

const COORDINATING_CONJUNCTIONS = new Set([
	"for", "and", "nor", "but", "or", "yet", "so",
]);

interface TaggedToken {
	text: string;
	tags: string[];
	normal: string;
}

function tagSentence(text: string): TaggedToken[] {
	const doc = nlp(text);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const terms: any[] = doc.termList();
	return terms.map((t) => ({
		text: String(t.text ?? ""),
		tags: t.tags instanceof Set ? Array.from(t.tags) : Array.isArray(t.tags) ? t.tags : [],
		normal: String(t.normal ?? t.text ?? "").toLowerCase(),
	}));
}

function isFiniteVerb(tags: string[]): boolean {
	const verbTags = ["Verb", "PastTense", "PresentTense", "Copula", "Modal", "Auxiliary"];
	const nonFinite = ["Gerund", "Infinitive", "Participle"];
	const hasVerb = tags.some((t) => verbTags.includes(t));
	const isNonFinite = tags.some((t) => nonFinite.includes(t));
	return hasVerb && !isNonFinite;
}

function hasSubjectNearby(tokens: TaggedToken[], verbIndex: number): boolean {
	const subjectTags = ["Noun", "Pronoun", "ProperNoun"];
	const start = Math.max(0, verbIndex - 4);
	for (let i = start; i < verbIndex; i++) {
		const tok = tokens[i];
		if (tok && tok.tags.some((t) => subjectTags.includes(t))) {
			return true;
		}
	}
	return false;
}

/**
 * Scan tokens to count independent and dependent clauses.
 * A clause is a subject+finite-verb unit.
 * Dependent clauses are introduced by subordinating conjunctions or relative pronouns.
 * Independent clause joins are signaled by coordinating conjunctions between clause-capable spans.
 */
function countClauses(tokens: TaggedToken[]): { independent: number; dependent: number } {
	let independent = 0;
	let dependent = 0;
	let inDependentZone = false;
	let foundVerbInCurrentClause = false;
	let foundSubjectInCurrentClause = false;

	const subjectTags = ["Noun", "Pronoun", "ProperNoun"];

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]!;
		const normal = tok.normal;

		if (SUBORDINATING_CONJUNCTIONS.has(normal)) {
			if (foundVerbInCurrentClause && foundSubjectInCurrentClause) {
				independent++;
			}
			inDependentZone = true;
			foundVerbInCurrentClause = false;
			foundSubjectInCurrentClause = false;
			continue;
		}

		if (RELATIVE_PRONOUNS.has(normal) && i + 1 < tokens.length) {
			const next = tokens[i + 1]!;
			if (isFiniteVerb(next.tags) || next.tags.some((t) => subjectTags.includes(t))) {
				if (foundVerbInCurrentClause && foundSubjectInCurrentClause) {
					independent++;
				}
				inDependentZone = true;
				foundVerbInCurrentClause = false;
				foundSubjectInCurrentClause = false;
				continue;
			}
		}

		if (COORDINATING_CONJUNCTIONS.has(normal) && !inDependentZone) {
			if (foundVerbInCurrentClause && foundSubjectInCurrentClause) {
				const hasUpcomingVerb = tokens.slice(i + 1).some(
					(t, idx) => isFiniteVerb(t.tags) && hasSubjectNearby(tokens, i + 1 + idx),
				);
				if (hasUpcomingVerb) {
					independent++;
					foundVerbInCurrentClause = false;
					foundSubjectInCurrentClause = false;
					continue;
				}
			}
		}

		if (tok.tags.some((t) => subjectTags.includes(t))) {
			foundSubjectInCurrentClause = true;
		}

		if (isFiniteVerb(tok.tags)) {
			foundVerbInCurrentClause = true;
		}
	}

	if (foundVerbInCurrentClause && foundSubjectInCurrentClause) {
		if (inDependentZone) {
			dependent++;
		} else {
			independent++;
		}
	} else if (inDependentZone && foundVerbInCurrentClause) {
		dependent++;
	}

	if (dependent === 0 && independent === 0) {
		const anyVerb = tokens.some((t) => isFiniteVerb(t.tags));
		if (anyVerb) {
			independent = 1;
		}
	}

	return { independent, dependent };
}

export function classifySentence(sentence: Sentence): SentenceType {
	if (sentence.wordCount <= 2) {
		const tokens = tagSentence(sentence.text);
		const hasVerb = tokens.some((t) => isFiniteVerb(t.tags));
		if (!hasVerb) return SentenceType.Fragment;
	}

	const tokens = tagSentence(sentence.text);

	const hasAnyFiniteVerb = tokens.some((t) => isFiniteVerb(t.tags));
	if (!hasAnyFiniteVerb) {
		return SentenceType.Fragment;
	}

	const { independent, dependent } = countClauses(tokens);

	if (independent === 0 && dependent === 0) {
		return SentenceType.Fragment;
	}
	if (independent >= 2 && dependent >= 1) {
		return SentenceType.CompoundComplex;
	}
	if (independent >= 2) {
		return SentenceType.Compound;
	}
	if (dependent >= 1) {
		return SentenceType.Complex;
	}
	return SentenceType.Simple;
}

export function classifyAllSentences(sentences: Sentence[]): void {
	for (const s of sentences) {
		s.type = classifySentence(s);
	}
}

export function computeStructuralFlow(sentences: Sentence[]): StructuralFlowResult {
	const counts: Record<SentenceType, number> = {
		[SentenceType.Fragment]: 0,
		[SentenceType.Simple]: 0,
		[SentenceType.Compound]: 0,
		[SentenceType.Complex]: 0,
		[SentenceType.CompoundComplex]: 0,
	};

	for (const s of sentences) {
		counts[s.type]++;
	}

	const total = sentences.length || 1;
	const distribution: Record<SentenceType, number> = {
		[SentenceType.Fragment]: counts[SentenceType.Fragment] / total,
		[SentenceType.Simple]: counts[SentenceType.Simple] / total,
		[SentenceType.Compound]: counts[SentenceType.Compound] / total,
		[SentenceType.Complex]: counts[SentenceType.Complex] / total,
		[SentenceType.CompoundComplex]: counts[SentenceType.CompoundComplex] / total,
	};

	return { counts, distribution };
}
