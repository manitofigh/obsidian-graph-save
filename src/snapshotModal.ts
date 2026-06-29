import { Modal, Setting } from 'obsidian';
import { GraphManager } from './graphManager';
import GraphSavePlugin from './main';
import { showNotice } from './notice';
import { CustomLeaf, GraphSnapshot } from './types';

export class SnapshotNameModal extends Modal {
	private name = '';

	constructor(
		private plugin: GraphSavePlugin,
		private graphManager: GraphManager,
		private graphLeaf?: CustomLeaf,
	) {
		super(plugin.app);
	}

	onOpen() {
		this.titleEl.setText('Save snapshot');

		new Setting(this.contentEl)
			.setName('Name')
			.addText((text) => {
				text.setPlaceholder('Graph layout');
				text.inputEl.focus();
				text.onChange((value) => this.name = value);
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') void this.save();
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('Save')
				.setCta()
				.onClick(() => void this.save()))
			.addButton((button) => button
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	private async save() {
		const result = this.graphManager.createSnapshot(this.name, this.graphLeaf);
		if (result === 'missing-graph') {
			showNotice('Graph Save: no graph view found');
		} else if (result === 'unchanged') {
			showNotice('Graph Save: no changes since last snapshot');
		} else {
			await this.plugin.saveSettings();
			showNotice('Graph Save: snapshot saved');
		}
		this.close();
	}
}

export class SnapshotHistoryModal extends Modal {
	constructor(
		private plugin: GraphSavePlugin,
		private graphManager: GraphManager,
		private graphLeaf?: CustomLeaf,
	) {
		super(plugin.app);
	}

	onOpen() {
		this.render();
	}

	private render() {
		this.contentEl.empty();
		this.titleEl.setText('Snapshots');

		const snapshots = this.graphManager.getSnapshots();
		if (snapshots.length === 0) {
			this.contentEl.createEl('p', { text: 'No snapshots yet.' });
			return;
		}

		snapshots.forEach((snapshot) => this.addSnapshot(snapshot));
	}

	private addSnapshot(snapshot: GraphSnapshot) {
		new Setting(this.contentEl)
			.setName(snapshot.name)
			.setDesc(this.formatDate(snapshot.createdAt))
			.addButton((button) => button
				.setButtonText('Restore')
				.setCta()
				.onClick(async () => {
					if (!this.graphManager.restoreSnapshot(snapshot.id, this.graphLeaf)) {
						showNotice('Graph Save: could not restore snapshot');
						return;
					}
					await this.plugin.saveSettings();
					showNotice('Graph Save: snapshot restored');
					this.close();
				}))
			.addButton((button) => button
				.setButtonText('Rename')
				.onClick(() => new RenameSnapshotModal(this.plugin, this.graphManager, snapshot, () => this.render()).open()))
			.addButton((button) => button
				.setButtonText('Delete')
				.onClick(async () => {
					this.graphManager.deleteSnapshot(snapshot.id);
					await this.plugin.saveSettings();
					this.render();
				}));
	}

	private formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}
}

class RenameSnapshotModal extends Modal {
	private name = '';

	constructor(
		private plugin: GraphSavePlugin,
		private graphManager: GraphManager,
		private snapshot: GraphSnapshot,
		private onSaved: () => void,
	) {
		super(plugin.app);
		this.name = snapshot.name;
	}

	onOpen() {
		this.titleEl.setText('Rename snapshot');

		new Setting(this.contentEl)
			.setName('Name')
			.addText((text) => {
				text.setValue(this.name);
				text.inputEl.focus();
				text.onChange((value) => this.name = value);
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') void this.save();
				});
			});

		new Setting(this.contentEl)
			.addButton((button) => button
				.setButtonText('Save')
				.setCta()
				.onClick(() => void this.save()))
			.addButton((button) => button
				.setButtonText('Cancel')
				.onClick(() => this.close()));
	}

	private async save() {
		if (this.graphManager.renameSnapshot(this.snapshot.id, this.name)) {
			await this.plugin.saveSettings();
			this.onSaved();
		}
		this.close();
	}
}
