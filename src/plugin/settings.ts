import { App, PluginSettingTab, Setting } from "obsidian";
import type QuillPlugin from "./main";
import { DEFAULT_SETTINGS } from "../core/types";

export class QuillSettingTab extends PluginSettingTab {
	plugin: QuillPlugin;

	constructor(app: App, plugin: QuillPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Long sentence threshold")
			.setDesc("Word count at which a sentence is considered 'long'.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.longSentenceThreshold))
					.setValue(String(this.plugin.settings.longSentenceThreshold))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.longSentenceThreshold = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Short word maximum")
			.setDesc("Maximum character length for a word to be considered 'short'.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.shortWordMax))
					.setValue(String(this.plugin.settings.shortWordMax))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.shortWordMax = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Long word minimum")
			.setDesc("Minimum character length for a word to be considered 'long'.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.longWordMin))
					.setValue(String(this.plugin.settings.longWordMin))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.longWordMin = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName("Debounce interval (ms)")
			.setDesc("How long to wait after typing before re-analyzing.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_SETTINGS.debounceMs))
					.setValue(String(this.plugin.settings.debounceMs))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n >= 100) {
							this.plugin.settings.debounceMs = n;
							await this.plugin.saveSettings();
						}
					}),
			);

		containerEl.createEl("h3", { text: "Colors" });

		const colorEntries: [keyof typeof DEFAULT_SETTINGS.colors, string][] = [
			["fragment", "Fragment"],
			["simple", "Simple"],
			["compound", "Compound"],
			["complex", "Complex"],
			["compoundComplex", "Compound-Complex"],
			["sentenceShort", "Short sentence"],
			["sentenceLong", "Long sentence"],
			["wordShort", "Short word"],
			["wordLong", "Long word"],
		];

		for (const [key, label] of colorEntries) {
			new Setting(containerEl)
				.setName(label)
				.addColorPicker((picker) =>
					picker
						.setValue(this.plugin.settings.colors[key])
						.onChange(async (value) => {
							this.plugin.settings.colors[key] = value;
							await this.plugin.saveSettings();
						}),
				);
		}
	}
}
