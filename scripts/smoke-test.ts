import { analyzeDocument } from "../src/core/scoring";
import { DEFAULT_SETTINGS } from "../src/core/types";

const SAMPLE = `# HOUSE OF GLASS

## PROLOGUE: GARDENER

*Fire....*

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

The exchange is over. The tendrils of the inkblack fire withdraw, and the blackness is drawn up like a curtain.
`;

const result = analyzeDocument(SAMPLE, DEFAULT_SETTINGS);

console.log(`paragraphs: ${result.paragraphs.length}, sentences: ${result.totalSentences}, words: ${result.totalWords}\n`);

for (const p of result.paragraphs) {
	const types = p.paragraph.sentences.map((s) => `${s.type}(${s.wordCount})`).join(", ");
	console.log(`  [${p.paragraph.text.slice(0, 40).padEnd(40)}] ${types}`);
}

console.log("\noverall structural distribution:");
for (const [k, v] of Object.entries(result.overallStructural.distribution)) {
	console.log(`  ${k.padEnd(17)} ${(v * 100).toFixed(1)}%`);
}
console.log(`\nsentence length: mean=${result.overallSentenceLength.mean} sd=${result.overallSentenceLength.standardDeviation}`);
console.log(`word length: mean=${result.overallWordLength.meanCharLength} chars`);
console.log(`\nflow scores:`, JSON.stringify(result.flow, null, 2));
