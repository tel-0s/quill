import nlp from "compromise";
import { Sentence, SentenceType, StructuralFlowResult } from "../types";

// "that", "so", and "for" are handled specially in countClauses — they are
// ambiguous between subordinator/relative/demonstrative/coordinator/preposition.
const SUBORDINATING_CONJUNCTIONS = new Set([
	"after", "although", "as", "because", "before",
	"if", "once", "provided", "since", "than",
	"though", "till", "unless", "until", "when", "whenever",
	"where", "whereas", "wherever", "whether", "while",
]);

const RELATIVE_PRONOUNS = new Set([
	"who", "whom", "whose", "which",
]);

const COORDINATING_CONJUNCTIONS = new Set([
	"and", "nor", "but", "or", "yet",
]);

/** Verbs that commonly take a zero-complementizer clause: "I think [that] it works." */
const BRIDGE_VERBS = new Set([
	"think", "thinks", "thought", "know", "knows", "knew",
	"believe", "believes", "believed", "say", "says", "said",
	"hope", "hopes", "hoped", "wish", "wishes", "wished",
	"guess", "guessed", "suppose", "supposed",
	"feel", "feels", "felt", "hear", "hears", "heard",
	"see", "sees", "saw", "mean", "means", "meant",
	"doubt", "doubted", "bet", "reckon",
]);

const PERSONAL_PRONOUNS = new Set(["i", "you", "he", "she", "we", "they", "it"]);

const SUBJECT_TAGS = ["Noun", "Pronoun", "ProperNoun"];

const VERB_TAGS = ["Verb", "PastTense", "PresentTense", "Copula", "Modal", "Auxiliary"];

/** Punctuation that always ends a clause: semicolons, colons, dashes, ! / ? inside a sentence. */
const HARD_BOUNDARY = /[;:!?]|--|—|–/;

interface TaggedToken {
	text: string;
	tags: string[];
	normal: string;
	post: string;
}

/**
 * compromise's POS tagging falls apart on all-caps text (verbs get tagged
 * Acronym).  Sentences that are mostly uppercase are case-normalized first.
 */
function normalizeCase(text: string): string {
	const letters = text.replace(/[^a-zA-Z]/g, "");
	if (letters.length >= 4) {
		const upper = letters.replace(/[^A-Z]/g, "").length;
		if (upper / letters.length > 0.8) {
			const lowered = text.toLowerCase();
			return lowered.charAt(0).toUpperCase() + lowered.slice(1);
		}
	}
	return text;
}

function tagSentence(text: string): TaggedToken[] {
	const doc = nlp(normalizeCase(text));
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const terms: any[] = doc.termList();
	return terms.map((t) => ({
		text: String(t.text ?? ""),
		tags: t.tags instanceof Set ? Array.from(t.tags) : Array.isArray(t.tags) ? t.tags : [],
		normal: String(t.normal ?? t.text ?? "").toLowerCase(),
		post: String(t.post ?? ""),
	}));
}

/**
 * Is the token at index i a finite verb?  Context-sensitive because
 * compromise tags bare present-tense forms ("centuries *pass*") with
 * Infinitive: those are finite unless preceded by "to" or sentence-initial
 * (a sentence-initial bare verb is handled by imperative detection).
 */
function isFiniteVerbAt(tokens: TaggedToken[], i: number): boolean {
	const tok = tokens[i];
	if (!tok) return false;
	const tags = tok.tags;
	if (!tags.some((t) => VERB_TAGS.includes(t))) return false;
	// compromise tags prepositional "like" as a verb; it's only verbal
	// after a pronoun subject ("I like it" vs. "a shadow like a cloak")
	if (tok.normal === "like" && !(tokens[i - 1]?.tags.includes("Pronoun") ?? false)) {
		return false;
	}
	if (tags.includes("Imperative")) return true;
	if (tags.includes("Gerund") || tags.includes("Participle")) return false;
	if (tags.includes("Infinitive")) {
		if (i === 0) return false;
		if (!tags.includes("PresentTense")) return false;
		if ((tokens[i - 1]?.normal ?? "") === "to") return false;
	}
	return true;
}

function isSubjectish(tok: TaggedToken): boolean {
	// existential "there" functions as a syntactic subject
	if (tok.normal === "there") return true;
	return tok.tags.some((t) => SUBJECT_TAGS.includes(t));
}

function isDashToken(tok: TaggedToken): boolean {
	const t = tok.text.trim();
	return t.length > 0 && /^[-–—]+$/.test(t);
}

/** Pronoun base for contractions: "i've" → "i". */
function pronounBase(normal: string): string {
	return normal.split(/['’]/)[0] ?? normal;
}

/**
 * Detect a sentence-initial imperative: a base-form verb (optionally after
 * leading adverbs/interjections) with no overt subject — "Stop." "Go home now."
 * Single-word sentences need the explicit Imperative tag, so that one-word
 * noun/verb ambiguities ("Fire.") stay fragments.
 */
function findImperativeIndex(tokens: TaggedToken[]): number {
	for (let i = 0; i < Math.min(tokens.length, 3); i++) {
		const tok = tokens[i]!;
		if (tok.tags.includes("Adverb") || tok.tags.includes("Expression") || isDashToken(tok)) {
			continue;
		}
		if (
			tok.tags.includes("Verb") &&
			!tok.tags.includes("Gerund") &&
			!tok.tags.includes("PastTense") &&
			!tok.tags.some((t) => SUBJECT_TAGS.includes(t)) &&
			(tok.tags.includes("Imperative") ||
				(tok.tags.includes("Infinitive") && tokens.length > 1))
		) {
			return i;
		}
		return -1;
	}
	return -1;
}

/**
 * compromise sometimes tags a 3rd-person-singular verb as a plural noun
 * ("the former *tends* his field").  When a sentence has no finite verb at
 * all, re-tag a Plural token directly followed by a possessive/determiner —
 * plural nouns aren't followed by those without punctuation.
 */
function rescueMistaggedVerb(tokens: TaggedToken[]): void {
	for (let i = 0; i < tokens.length - 1; i++) {
		const tok = tokens[i]!;
		const next = tokens[i + 1]!;
		if (
			tok.tags.includes("Plural") &&
			!tok.tags.includes("Pronoun") &&
			(next.tags.includes("Possessive") || next.tags.includes("Determiner"))
		) {
			tok.tags = tok.tags.filter((t) => t !== "Noun" && t !== "Plural" && t !== "Singular");
			tok.tags.push("Verb", "PresentTense");
			return;
		}
	}
}

/**
 * After a coordinator, a *new clause* needs its own subject before its verb.
 * "and she walked" → true; "and jumped" (compound predicate) → false.
 */
function startsNewClause(tokens: TaggedToken[], i: number): boolean {
	let subjectSeen = false;
	for (let j = i + 1; j < tokens.length; j++) {
		if (isFiniteVerbAt(tokens, j)) return subjectSeen;
		if (isSubjectish(tokens[j]!)) subjectSeen = true;
	}
	return false;
}

/**
 * Distinguish purpose "so" ("so [that] we may know") from coordinating
 * "so" ("he ran, so he was tired"): purpose clauses carry a modal.
 */
function isPurposeSo(tokens: TaggedToken[], i: number): boolean {
	if (tokens[i + 1]?.normal === "that") return true;
	for (let j = i + 1; j < Math.min(tokens.length, i + 4); j++) {
		if (tokens[j]!.tags.includes("Modal")) return true;
		if (isFiniteVerbAt(tokens, j)) return false;
	}
	return false;
}

/** Separator text between token i-1 and token i (trailing punctuation or a dash token). */
function separatorBefore(tokens: TaggedToken[], i: number): string {
	const prev = tokens[i - 1];
	if (!prev) return "";
	return isDashToken(prev) ? prev.text + prev.post : prev.post;
}

/**
 * Scan tokens to count independent and dependent clauses.
 * A clause is a subject+finite-verb unit.  Dependent clauses are opened by
 * subordinators, relative pronouns, complementizer "that", purpose "so",
 * and zero-complementizer clauses after bridge verbs; they are closed by
 * clause-boundary punctuation (commas close a completed dependent clause,
 * semicolons/colons/dashes close anything).
 */
function countClauses(tokens: TaggedToken[], imperativeIdx: number): { independent: number; dependent: number } {
	let independent = 0;
	let dependent = 0;
	let inDependentZone = false;
	let hasVerb = false;
	let hasSubject = false;
	let lastVerbNormal = "";

	const flush = (): void => {
		if (hasVerb && (hasSubject || inDependentZone)) {
			if (inDependentZone) dependent++;
			else independent++;
		}
		hasVerb = false;
		hasSubject = false;
		lastVerbNormal = "";
	};

	for (let i = 0; i < tokens.length; i++) {
		const tok = tokens[i]!;
		const normal = tok.normal;

		if (isDashToken(tok)) {
			flush();
			inDependentZone = false;
			continue;
		}

		let handled = false;

		if (i === imperativeIdx) {
			hasVerb = true;
			hasSubject = true; // implicit "you"
			lastVerbNormal = normal;
			handled = true;
		}

		if (!handled && normal === "that") {
			const prev = tokens[i - 1];
			const next = tokens[i + 1];
			const nextIsFinite = isFiniteVerbAt(tokens, i + 1);
			const nextStartsClause = next != null && (nextIsFinite || isSubjectish(next));
			// the Determiner tag blocks a relative reading only before a plain
			// noun ("that fire"); before a pronoun or verb it can't be a determiner
			const determinerBlock =
				tok.tags.includes("Determiner") &&
				!nextIsFinite &&
				!(next?.tags.includes("Pronoun") ?? false);
			if (
				nextStartsClause && !determinerBlock &&
				((prev != null && isSubjectish(prev)) || (hasVerb && hasSubject))
			) {
				// relative ("the book that I read") or complementizer ("he said that ...")
				flush();
				inDependentZone = true;
			} else if (!hasSubject && !hasVerb && !determinerBlock) {
				// demonstrative subject: "That is a fire."
				hasSubject = true;
			}
			continue;
		}

		if (!handled && RELATIVE_PRONOUNS.has(normal) && i > 0) {
			// i > 0: sentence-initial "Who/Which" is interrogative, not relative
			const next = tokens[i + 1];
			if (next && (isFiniteVerbAt(tokens, i + 1) || isSubjectish(next))) {
				flush();
				inDependentZone = true;
				continue;
			}
		}

		if (!handled && normal === "so") {
			const discourse = i === 0 || /,/.test(tok.post);
			if (!discourse) {
				if (isPurposeSo(tokens, i)) {
					flush();
					inDependentZone = true;
				} else if (/[,;:—–]|--/.test(separatorBefore(tokens, i)) && startsNewClause(tokens, i)) {
					flush();
				}
			}
			continue;
		}

		if (!handled && normal === "for") {
			// coordinating "for" follows a comma or dash; otherwise it's a preposition
			if (/[,;:—–]|--/.test(separatorBefore(tokens, i)) && startsNewClause(tokens, i)) {
				flush();
			}
			continue;
		}

		if (!handled && COORDINATING_CONJUNCTIONS.has(normal)) {
			if (startsNewClause(tokens, i)) {
				flush();
			}
			continue;
		}

		if (!handled && SUBORDINATING_CONJUNCTIONS.has(normal) && !/,/.test(tok.post)) {
			// a comma right after ("Once, ...") marks discourse use, not subordination
			flush();
			inDependentZone = true;
			continue;
		}

		if (!handled) {
			// zero-complementizer clause: "I think [that] I've been trapped"
			if (
				hasVerb && hasSubject && !inDependentZone &&
				PERSONAL_PRONOUNS.has(pronounBase(normal)) &&
				BRIDGE_VERBS.has(lastVerbNormal) &&
				isFiniteVerbAt(tokens, i + 1)
			) {
				flush();
				inDependentZone = true;
			}

			if (isSubjectish(tok)) {
				hasSubject = true;
			}
			if (isFiniteVerbAt(tokens, i)) {
				hasVerb = true;
				lastVerbNormal = normal;
			}
		}

		// clause-boundary punctuation attached to this token
		if (HARD_BOUNDARY.test(tok.post)) {
			flush();
			inDependentZone = false;
		} else if (/,/.test(tok.post) && inDependentZone && hasVerb && hasSubject) {
			// a completed dependent clause ends at the next comma:
			// "Because it rained, we stayed home."
			flush();
			inDependentZone = false;
		}
	}

	flush();

	if (dependent === 0 && independent === 0) {
		const anyVerb = tokens.some((t, i) => i === imperativeIdx || isFiniteVerbAt(tokens, i));
		if (anyVerb) {
			independent = 1;
		}
	}

	return { independent, dependent };
}

export function classifySentence(sentence: Sentence): SentenceType {
	const tokens = tagSentence(sentence.text);
	if (tokens.length === 0) {
		return SentenceType.Fragment;
	}

	let imperativeIdx = findImperativeIndex(tokens);
	let hasAnyFiniteVerb = imperativeIdx >= 0 || tokens.some((t, i) => isFiniteVerbAt(tokens, i));
	if (!hasAnyFiniteVerb) {
		rescueMistaggedVerb(tokens);
		imperativeIdx = findImperativeIndex(tokens);
		hasAnyFiniteVerb = imperativeIdx >= 0 || tokens.some((t, i) => isFiniteVerbAt(tokens, i));
	}
	if (!hasAnyFiniteVerb) {
		return SentenceType.Fragment;
	}

	const { independent, dependent } = countClauses(tokens, imperativeIdx);

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
