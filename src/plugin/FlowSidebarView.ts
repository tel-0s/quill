import { ItemView, WorkspaceLeaf, MarkdownView } from "obsidian";
import { DocumentAnalysis, SentenceType, QuillSettings } from "../core/types";
import { renderStructuralBar, renderSentenceLengthBar, renderWordLengthBar } from "./FlowRenderer";

export const QUILL_VIEW_TYPE = "quill-flow-view";
const BAR_WIDTH = 140;

export class FlowSidebarView extends ItemView {
	private analysis: DocumentAnalysis | null = null;
	private settings: QuillSettings;

	constructor(leaf: WorkspaceLeaf, settings: QuillSettings) {
		super(leaf);
		this.settings = settings;
	}

	getViewType(): string {
		return QUILL_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Quill";
	}

	getIcon(): string {
		return "feather";
	}

	updateSettings(settings: QuillSettings): void {
		this.settings = settings;
	}

	setAnalysis(analysis: DocumentAnalysis): void {
		this.analysis = analysis;
		this.render();
	}

	clear(): void {
		this.analysis = null;
		this.render();
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		if (!container) return;
		container.empty();
		container.addClass("quill-sidebar");

		if (!this.analysis || this.analysis.paragraphs.length === 0) {
			const empty = container.createDiv({ cls: "quill-empty-state" });
			empty.setText("Open a note to see flow analysis.");
			return;
		}

		this.renderLegend(container);
		this.renderSummary(container);

		for (let i = 0; i < this.analysis.paragraphs.length; i++) {
			const pa = this.analysis.paragraphs[i]!;
			this.renderParagraphRow(container, pa, i);
		}
	}

	private renderLegend(container: HTMLElement): void {
		const legend = container.createDiv({ cls: "quill-legend" });

		const items: [string, string][] = [
			[this.settings.colors.fragment, "Fragment"],
			[this.settings.colors.simple, "Simple"],
			[this.settings.colors.compound, "Compound"],
			[this.settings.colors.complex, "Complex"],
			[this.settings.colors.compoundComplex, "Comp-Complex"],
		];

		for (const [color, label] of items) {
			const item = legend.createDiv({ cls: "quill-legend-item" });
			const swatch = item.createDiv({ cls: "quill-legend-swatch" });
			swatch.style.backgroundColor = color;
			item.createSpan({ text: label });
		}
	}

	private renderSummary(container: HTMLElement): void {
		if (!this.analysis) return;
		const summary = container.createDiv({ cls: "quill-doc-summary" });
		summary.createDiv({ cls: "quill-doc-summary-title", text: "Document" });

		const stats = [
			`${this.analysis.totalSentences} sentences, ${this.analysis.totalWords} words`,
			`Avg sentence: ${this.analysis.overallSentenceLength.mean} words (SD ${this.analysis.overallSentenceLength.standardDeviation})`,
			`Avg word: ${this.analysis.overallWordLength.meanCharLength} chars`,
			`Long sentences: ${Math.round(this.analysis.overallSentenceLength.longSentenceFraction * 100)}%`,
		];

		for (const s of stats) {
			summary.createDiv({ cls: "quill-doc-summary-stat", text: s });
		}
	}

	private renderParagraphRow(
		container: HTMLElement,
		pa: import("../core/types").ParagraphAnalysis,
		index: number,
	): void {
		const row = container.createDiv({ cls: "quill-paragraph-row" });

		row.addEventListener("click", () => {
			this.scrollToParagraph(pa.paragraph.offset);
		});

		const preview = pa.paragraph.text.slice(0, 50);
		row.createDiv({
			cls: "quill-paragraph-text",
			text: preview + (pa.paragraph.text.length > 50 ? "..." : ""),
		});

		this.renderMetricRow(
			row,
			"Structure",
			renderStructuralBar(pa, BAR_WIDTH, this.settings),
			null,
		);
		this.renderMetricRow(
			row,
			"Sent. len",
			renderSentenceLengthBar(pa, BAR_WIDTH, this.settings),
			String(pa.sentenceLength.mean),
		);
		this.renderMetricRow(
			row,
			"Word len",
			renderWordLengthBar(pa, BAR_WIDTH, this.settings),
			String(pa.wordLength.meanCharLength),
		);
	}

	private renderMetricRow(
		parent: HTMLElement,
		label: string,
		svg: SVGSVGElement,
		value: string | null,
	): void {
		const row = parent.createDiv({ cls: "quill-metric-row" });
		row.createDiv({ cls: "quill-metric-label", text: label });
		const barContainer = row.createDiv({ cls: "quill-metric-bar" });
		barContainer.appendChild(svg);
		row.createDiv({ cls: "quill-metric-value", text: value ?? "" });
	}

	private scrollToParagraph(offset: number): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const editor = view.editor;
		const pos = editor.offsetToPos(offset);
		editor.setCursor(pos);
		editor.scrollIntoView({ from: pos, to: pos }, true);
	}
}
