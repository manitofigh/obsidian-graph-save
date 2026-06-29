import { App, PluginSettingTab, Setting } from 'obsidian';
import GraphSavePlugin from './main';
import { GraphData, GraphOptions, GraphSnapshot, NodePosition } from './types';

export interface GraphSaveSettings {
	nodePositions: NodePosition[];
	pinnedNodes: string[];
	snapshots: GraphSnapshot[];
	globalOptions: GraphOptions;
	workspacesGraphData: Record<string, GraphData>;
	automaticallyRestoreNodePositions: boolean;
	enableSaveOptions: boolean;
	enableWorkspaces: boolean;
	enableAutoSave: boolean;
	autoSaveIntervalSeconds: number;
}

export const DEFAULT_SETTINGS: GraphSaveSettings = {
	nodePositions: [],
	pinnedNodes: [],
	snapshots: [],
	globalOptions: {},
	workspacesGraphData: {},
	automaticallyRestoreNodePositions: true,
	enableSaveOptions: false,
	enableWorkspaces: false,
	enableAutoSave: true,
	autoSaveIntervalSeconds: 1,
};

interface LegacySettings extends Partial<GraphSaveSettings> {
	autoSaveIntervalMinutes?: number;
}

export function normalizeSettings(raw: unknown): GraphSaveSettings {
	const loaded = isRecord(raw) ? raw as LegacySettings : {};
	const legacySeconds = typeof loaded.autoSaveIntervalMinutes === 'number'
		? loaded.autoSaveIntervalMinutes * 60
		: DEFAULT_SETTINGS.autoSaveIntervalSeconds;

	return {
		nodePositions: toNodePositions(loaded.nodePositions),
		pinnedNodes: toStrings(loaded.pinnedNodes),
		snapshots: toSnapshots(loaded.snapshots),
		globalOptions: toOptions(loaded.globalOptions),
		workspacesGraphData: toWorkspacesGraphData(loaded.workspacesGraphData),
		automaticallyRestoreNodePositions: toBoolean(loaded.automaticallyRestoreNodePositions, DEFAULT_SETTINGS.automaticallyRestoreNodePositions),
		enableSaveOptions: toBoolean(loaded.enableSaveOptions, DEFAULT_SETTINGS.enableSaveOptions),
		enableWorkspaces: toBoolean(loaded.enableWorkspaces, DEFAULT_SETTINGS.enableWorkspaces),
		enableAutoSave: toBoolean(loaded.enableAutoSave, DEFAULT_SETTINGS.enableAutoSave),
		autoSaveIntervalSeconds: clampSeconds(loaded.autoSaveIntervalSeconds ?? legacySeconds),
	};
}

function toSnapshots(value: unknown): GraphSnapshot[] {
	if (!Array.isArray(value)) return [];

	return value.filter(isSnapshot).map((snapshot) => ({
		...snapshot,
		data: toGraphData(snapshot.data),
	}));
}

function isSnapshot(value: unknown): value is GraphSnapshot {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.name === 'string'
		&& typeof value.createdAt === 'number'
		&& (typeof value.workspace === 'string' || value.workspace === null)
		&& typeof value.signature === 'string'
		&& isRecord(value.data);
}

function toWorkspacesGraphData(value: unknown): Record<string, GraphData> {
	if (!isRecord(value)) return {};

	const graphData: Record<string, GraphData> = {};
	Object.keys(value).forEach((name) => {
		graphData[name] = toGraphData(value[name]);
	});
	return graphData;
}

function toGraphData(value: unknown): GraphData {
	if (!isRecord(value)) return { nodePositions: [], options: {} };

	return {
		nodePositions: toNodePositions(value.nodePositions),
		options: toOptions(value.options),
	};
}

function toNodePositions(value: unknown): NodePosition[] {
	if (!Array.isArray(value)) return [];

	return value.filter(isNodePosition);
}

function isNodePosition(value: unknown): value is NodePosition {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& Number.isFinite(value.x)
		&& Number.isFinite(value.y);
}

function toStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toOptions(value: unknown): GraphOptions {
	return isRecord(value) ? value : {};
}

function toBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function clampSeconds(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value)
		? Math.max(1, Math.min(30, Math.round(value)))
		: DEFAULT_SETTINGS.autoSaveIntervalSeconds;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class GraphSaveSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: GraphSavePlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addRestoreSetting();
		this.addSaveOptionsSetting();
		this.addWorkspaceSetting();
		this.addAutoSaveSetting();
	}

	private addRestoreSetting() {
		new Setting(this.containerEl)
			.setName('Automatically restore node positions')
			.setDesc('Move saved nodes back to their saved positions whenever a graph view opens')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.automaticallyRestoreNodePositions)
				.onChange((value) => this.update('automaticallyRestoreNodePositions', value)));
	}

	private addSaveOptionsSetting() {
		new Setting(this.containerEl)
			.setName('Also save graph view settings')
			.setDesc('Save filters, groups, display, and forces. Leave off if you only want node positions restored')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableSaveOptions)
				.onChange((value) => this.update('enableSaveOptions', value)));
	}

	private addWorkspaceSetting() {
		new Setting(this.containerEl)
			.setName('Separate layouts per Obsidian workspace')
			.setDesc('Use a different saved graph layout for each saved layout in Obsidian Workspaces')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableWorkspaces)
				.onChange((value) => this.update('enableWorkspaces', value)));
	}

	private addAutoSaveSetting() {
		new Setting(this.containerEl)
			.setName('Enable autosave')
			.setDesc('Save visible graph node positions while a graph view is open')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableAutoSave)
				.onChange((value) => {
					this.update('enableAutoSave', value);
					value ? this.plugin.graphManager.startAutoSave() : this.plugin.graphManager.stopAutoSave();
					this.display();
				}));

		if (!this.plugin.settings.enableAutoSave) return;

		new Setting(this.containerEl)
			.setName('Autosave frequency')
			.setDesc('Seconds between saves when graph positions change')
			.addSlider((slider) => slider
				.setLimits(1, 30, 1)
				.setValue(this.plugin.settings.autoSaveIntervalSeconds)
				.setDynamicTooltip()
				.onChange((value) => {
					this.update('autoSaveIntervalSeconds', value);
					this.plugin.graphManager.startAutoSave();
				}));
	}

	private update<K extends keyof GraphSaveSettings>(key: K, value: GraphSaveSettings[K]) {
		this.plugin.settings[key] = value;
		void this.plugin.saveSettings();
	}
}
