import { SentenceType, ParagraphAnalysis, QuillSettings } from "../core/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const BAR_HEIGHT = 14;
const BAR_RADIUS = 3;

let clipIdCounter = 0;

function nextClipId(prefix: string): string {
	return `${prefix}-${++clipIdCounter}`;
}

function svgEl<K extends keyof SVGElementTagNameMap>(
	tag: K,
	attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) {
		el.setAttribute(k, String(v));
	}
	return el;
}

function lerp(a: string, b: string, t: number): string {
	const parse = (hex: string) => {
		const h = hex.replace("#", "");
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
	};
	const [r1, g1, b1] = parse(a);
	const [r2, g2, b2] = parse(b);
	const r = Math.round(r1 + (r2 - r1) * t);
	const g = Math.round(g1 + (g2 - g1) * t);
	const bl = Math.round(b1 + (b2 - b1) * t);
	return `rgb(${r},${g},${bl})`;
}

function makeClippedSvg(width: number, prefix: string): { svg: SVGSVGElement; group: SVGGElement } {
	const svg = svgEl("svg", { width, height: BAR_HEIGHT, viewBox: `0 0 ${width} ${BAR_HEIGHT}` });
	const id = nextClipId(prefix);
	const defs = svgEl("defs", {});
	const cp = svgEl("clipPath", { id });
	cp.appendChild(svgEl("rect", { x: 0, y: 0, width, height: BAR_HEIGHT, rx: BAR_RADIUS, ry: BAR_RADIUS }));
	defs.appendChild(cp);
	svg.appendChild(defs);
	const group = svgEl("g", { "clip-path": `url(#${id})` });
	svg.appendChild(group);
	return { svg, group };
}

export function renderStructuralBar(
	analysis: ParagraphAnalysis,
	width: number,
	settings: QuillSettings,
): SVGSVGElement {
	const { svg, group } = makeClippedSvg(width, "qst");

	const order: SentenceType[] = [
		SentenceType.Fragment,
		SentenceType.Simple,
		SentenceType.Compound,
		SentenceType.Complex,
		SentenceType.CompoundComplex,
	];
	const colorMap: Record<SentenceType, string> = {
		[SentenceType.Fragment]: settings.colors.fragment,
		[SentenceType.Simple]: settings.colors.simple,
		[SentenceType.Compound]: settings.colors.compound,
		[SentenceType.Complex]: settings.colors.complex,
		[SentenceType.CompoundComplex]: settings.colors.compoundComplex,
	};

	let x = 0;
	for (const t of order) {
		const frac = analysis.structural.distribution[t];
		if (frac <= 0) continue;
		const w = frac * width;
		group.appendChild(svgEl("rect", { x, y: 0, width: w, height: BAR_HEIGHT, fill: colorMap[t] }));
		x += w;
	}

	return svg;
}

export function renderSentenceLengthBar(
	analysis: ParagraphAnalysis,
	width: number,
	settings: QuillSettings,
): SVGSVGElement {
	const { svg, group } = makeClippedSvg(width, "qsl");

	const { lengths } = analysis.sentenceLength;
	const total = lengths.reduce((a, b) => a + b, 0);
	if (total === 0) return svg;

	const maxLen = Math.max(...lengths, settings.longSentenceThreshold);
	let x = 0;
	for (const len of lengths) {
		const w = (len / total) * width;
		const t = Math.min(len / maxLen, 1);
		const color = lerp(settings.colors.sentenceShort, settings.colors.sentenceLong, t);
		group.appendChild(svgEl("rect", { x, y: 0, width: w, height: BAR_HEIGHT, fill: color }));
		x += w;
	}

	const thresholdFrac = settings.longSentenceThreshold / maxLen;
	const markerX = Math.min(thresholdFrac * width, width - 1);
	svg.appendChild(
		svgEl("line", {
			x1: markerX, y1: 0, x2: markerX, y2: BAR_HEIGHT,
			stroke: "#ef4444", "stroke-width": 1.5, "stroke-opacity": 0.8,
		}),
	);

	return svg;
}

export function renderWordLengthBar(
	analysis: ParagraphAnalysis,
	width: number,
	settings: QuillSettings,
): SVGSVGElement {
	const { svg, group } = makeClippedSvg(width, "qwl");

	const { buckets } = analysis.wordLength;
	const segments: [number, string][] = [
		[buckets.short, settings.colors.wordShort],
		[buckets.medium, lerp(settings.colors.wordShort, settings.colors.wordLong, 0.5)],
		[buckets.long, settings.colors.wordLong],
	];

	let x = 0;
	for (const [frac, color] of segments) {
		if (frac <= 0) continue;
		const w = frac * width;
		group.appendChild(svgEl("rect", { x, y: 0, width: w, height: BAR_HEIGHT, fill: color }));
		x += w;
	}

	return svg;
}
