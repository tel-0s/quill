import { Plugin, MarkdownView, WorkspaceLeaf } from "obsidian";
import { QuillSettings, DEFAULT_SETTINGS } from "../core/types";
import { analyzeDocument } from "../core/scoring";
import { FlowSidebarView, QUILL_VIEW_TYPE } from "./FlowSidebarView";
import { QuillSettingTab } from "./settings";

export default class QuillPlugin extends Plugin {
	settings: QuillSettings = DEFAULT_SETTINGS;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(QUILL_VIEW_TYPE, (leaf) => new FlowSidebarView(leaf, this.settings));

		this.addRibbonIcon("feather", "Quill: Toggle flow panel", () => {
			this.toggleView();
		});

		this.addCommand({
			id: "quill-analyze",
			name: "Analyze current document",
			callback: () => {
				this.runAnalysis();
			},
		});

		this.addCommand({
			id: "quill-toggle-panel",
			name: "Toggle flow panel",
			callback: () => {
				this.toggleView();
			},
		});

		this.registerEvent(
			this.app.workspace.on("editor-change", () => {
				this.scheduleAnalysis();
			}),
		);

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.runAnalysis();
			}),
		);

		this.addSettingTab(new QuillSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			this.runAnalysis();
		});
	}

	onunload(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
	}

	async loadSettings(): Promise<void> {
		const data = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		if (data?.colors) {
			this.settings.colors = Object.assign({}, DEFAULT_SETTINGS.colors, data.colors);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.getView()?.updateSettings(this.settings);
		this.runAnalysis();
	}

	private scheduleAnalysis(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.runAnalysis();
		}, this.settings.debounceMs);
	}

	private runAnalysis(): void {
		const view = this.getView();
		if (!view) return;

		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!mdView) {
			view.clear();
			return;
		}

		const text = mdView.editor.getValue();
		if (!text.trim()) {
			view.clear();
			return;
		}

		const analysis = analyzeDocument(text, this.settings);
		view.setAnalysis(analysis);
	}

	private getView(): FlowSidebarView | null {
		const leaves = this.app.workspace.getLeavesOfType(QUILL_VIEW_TYPE);
		if (leaves.length > 0 && leaves[0]) {
			return leaves[0].view as FlowSidebarView;
		}
		return null;
	}

	private async toggleView(): Promise<void> {
		const existing = this.getView();
		if (existing) {
			existing.leaf.detach();
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: QUILL_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
			this.runAnalysis();
		}
	}
}
