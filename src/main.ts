import { Menu, Plugin, TAbstractFile } from 'obsidian';
import { addGraphActions, removeGraphActions } from './graphActions';
import { GraphManager } from './graphManager';
import { showNotice } from './notice';
import { GraphSaveSettings, GraphSaveSettingTab, normalizeSettings } from './settings';
import { SnapshotHistoryModal, SnapshotNameModal } from './snapshotModal';
import { CustomLeaf } from './types';

export default class GraphSavePlugin extends Plugin {
	settings!: GraphSaveSettings;
	graphManager!: GraphManager;
	private graphLeafEvents = new WeakSet<CustomLeaf>();

	async onload() {
		await this.loadSettings();
		this.graphManager = new GraphManager(this);

		this.app.workspace.onLayoutReady(() => this.setupGraphLeaves());
		this.registerEvents();
		this.registerCommands();
		this.addSettingTab(new GraphSaveSettingTab(this.app, this));

		if (this.settings.enableAutoSave) this.graphManager.startAutoSave();
	}

	async onunload() {
		await this.graphManager.shutdownAutoSave();
		this.app.workspace
			.getLeavesOfType('graph')
			.forEach((leaf) => {
				removeGraphActions(leaf as CustomLeaf);
				this.graphManager.pinManager.unpatchWorker(leaf as CustomLeaf);
			});
	}

	private setupGraphLeaves() {
		this.app.workspace
			.getLeavesOfType('graph')
			.forEach((leaf) => this.setupGraphLeaf(leaf as CustomLeaf));
	}

	private setupGraphLeaf(leaf: CustomLeaf) {
		addGraphActions(leaf, this.graphManager, this);
		this.registerGraphLeafEvents(leaf);
		this.graphManager.pinManager.patchWorker(leaf);
		this.graphManager.queueAutoRestore(leaf);
	}

	private registerGraphLeafEvents(leaf: CustomLeaf) {
		if (this.graphLeafEvents.has(leaf)) return;
		this.graphLeafEvents.add(leaf);

		this.registerDomEvent(leaf.view.containerEl, 'pointerup', () => {
			if (this.settings.enableAutoSave) void this.graphManager.flushAutoSaveNow();
		});
	}

	private registerEvents() {
		this.registerEvent(this.app.workspace.on('layout-change', () => this.setupGraphLeaves()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => this.graphManager.pruneSavedData()));
		this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => this.graphManager.handleRename(file, oldPath)));
		this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => this.graphManager.handleDelete(file)));
		this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => this.addPinMenuItem(menu, file.path)));
	}

	private addPinMenuItem(menu: Menu, nodeId: string) {
		const leaf = this.graphManager.getActiveLeaf();
		if (!leaf) return;

		const pinned = this.graphManager.pinManager.isPinned(nodeId);
		menu.addItem((item) => item
			.setTitle(pinned ? 'Unpin node' : 'Pin node')
			.setIcon(pinned ? 'pin-off' : 'pin')
			.onClick(() => pinned
				? this.graphManager.pinManager.unpinNode(nodeId, leaf)
				: this.graphManager.pinManager.pinNode(nodeId, leaf)));
	}

	private registerCommands() {
		this.addCommand({
			id: 'save-snapshot',
			name: 'Save graph snapshot',
			callback: () => new SnapshotNameModal(this, this.graphManager).open(),
		});

		this.addCommand({
			id: 'restore-snapshot',
			name: 'Restore graph snapshot',
			callback: () => new SnapshotHistoryModal(this, this.graphManager).open(),
		});

		this.addCommand({
			id: 'shuffle-layout',
			name: 'Shuffle graph layout',
			callback: async () => {
				if (!this.graphManager.shuffleLayout()) {
					showNotice('Graph Save: no graph view found');
					return;
				}
				await this.saveSettings();
				showNotice('Graph Save: layout shuffled');
			},
		});
	}

	async loadSettings() {
		this.settings = normalizeSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
