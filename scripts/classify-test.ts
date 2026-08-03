import { tokenize, splitSentences } from "../src/core/tokenizer";
import { classifySentence } from "../src/core/classifiers/sentenceType";

// --- sentence classification ---

const CASES: [string, string][] = [
	// fragments
	["Fire.", "fragment"],
	["A vast bridge of prismatic glass.", "fragment"],
	["Not a man; not anything living.", "fragment"],
	["Wreathed in Shadow like a cloak.", "fragment"],
	["INDEED.", "fragment"],
	["Above, below, and to all sides.", "fragment"],
	// simple
	["He ran.", "simple"],
	["That is a fire.", "simple"],
	["This fire is a black fire.", "simple"],
	["There is only the singular flame.", "simple"],
	["He struggles to stay on his feet.", "simple"],
	["I did not expect to understand.", "simple"],
	["It was, of course, still alien.", "simple"],
	["Then it is over.", "simple"],
	["The exchange is over.", "simple"],
	["He ran and jumped.", "simple"],
	["I like it.", "simple"],
	["A voice like grinding stone filled the room.", "simple"],
	["Who are you?", "simple"],
	["FOR YOU HAVE FOUND THIS GARDEN.", "simple"],
	["THE FORMER TENDS HIS FIELD.", "simple"],
	// imperatives → simple
	["Stop.", "simple"],
	["Go home now.", "simple"],
	["So be it, young Elwin.", "simple"],
	// compound
	["He ran, and she walked.", "compound"],
	["He ran, so he was tired.", "compound"],
	["He was tired, yet he kept walking.", "compound"],
	["Memories are consumed; centuries pass.", "compound"],
	["THERE ARE FARMERS AND THERE ARE GARDENERS.", "compound"],
	// complex
	["He ran because he was scared.", "complex"],
	["Because it rained, we stayed home.", "complex"],
	["The book that I read was good.", "complex"],
	["The man who emerges -- for there is always a man -- walks slowly.", "complex"],
	["I think I've been trapped.", "complex"],
	["What is thy name, so we may know thee?", "complex"],
	["He said that she left.", "complex"],
	// compound-complex
	["When he arrived, the party started, and everyone cheered.", "compound-complex"],
	["He ran because he was scared, and she followed him.", "compound-complex"],
];

let pass = 0;
for (const [text, expected] of CASES) {
	const sent = tokenize(text)[0]?.sentences[0];
	if (!sent) {
		console.log(`TOKENIZE FAIL: ${text}`);
		continue;
	}
	const got = classifySentence(sent);
	const ok = got === expected;
	if (ok) pass++;
	console.log(`${ok ? "  ok " : "WRONG"}  expected=${expected.padEnd(17)} got=${String(got).padEnd(17)} | ${text}`);
}
console.log(`\nclassification: ${pass}/${CASES.length} correct\n`);

// --- sentence splitting ---

const SPLIT_CASES: [string, number][] = [
	["He hears its words inside his skull... a voice like grinding stone.", 1],
	['"Stop!" he said.', 1],
	['"I think I\'ve been trapped," he said.', 1],
	['He yelled "Stop!" Then he left.', 2],
	["Fire.... It burns.", 2],
	["He ran. She walked.", 2],
	["Dr. Smith arrived. He sat down.", 2],
	['"Are you the gardener of this place?"', 1],
];

let splitPass = 0;
for (const [text, expected] of SPLIT_CASES) {
	const got = splitSentences(text);
	const ok = got.length === expected;
	if (ok) splitPass++;
	console.log(`${ok ? "  ok " : "WRONG"}  expected=${expected} got=${got.length} | ${JSON.stringify(got)}`);
}
console.log(`\nsplitting: ${splitPass}/${SPLIT_CASES.length} correct`);
