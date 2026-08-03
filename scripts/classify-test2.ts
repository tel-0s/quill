import { tokenize } from "../src/core/tokenizer";
import { classifySentence } from "../src/core/classifiers/sentenceType";

const docs = [
	"THERE ARE FARMERS AND THERE ARE GARDENERS.",
	"THE FORMER TENDS HIS FIELD.",
	"INDEED.",
	"FOR YOU HAVE FOUND THIS GARDEN.",
	"*Fire....*",
	'"I think I\'ve been trapped," he said.',
	'*"Are you the gardener of this place?"*',
	"He hears its words inside his skull... a voice like grinding stone.",
	"Then it is over.",
	"The exchange is over.",
];

for (const text of docs) {
	const paras = tokenize(text);
	for (const p of paras) {
		for (const s of p.sentences) {
			console.log(`${classifySentence(s).padEnd(17)} | wc=${String(s.wordCount).padStart(2)} | ${JSON.stringify(s.text)}`);
		}
	}
}
