import { setIcon } from 'obsidian';
import { GraphManager } from './graphManager';
import GraphSavePlugin from './main';
import { showNotice } from './notice';
import { SnapshotHistoryModal, SnapshotNameModal } from './snapshotModal';
import { CustomLeaf } from './types';

const SAVE_BUTTON_CLASS = 'graph-save-save-btn';
const RESTORE_BUTTON_CLASS = 'graph-save-restore-btn';
const SHUFFLE_BUTTON_CLASS = 'graph-save-shuffle-btn';

export function addGraphActions(leaf: CustomLeaf, graphManager: GraphManager, plugin: GraphSavePlugin) {
	const actions = leaf.view.containerEl.querySelector('.view-actions');
	if (!actions || actions.querySelector(`.${SAVE_BUTTON_CLASS}`)) return;

	const saveButton = createAction('save', 'Graph Save: save snapshot', SAVE_BUTTON_CLASS, () =>
		new SnapshotNameModal(plugin, graphManager, leaf).open());

	const restoreButton = createAction('rotate-ccw', 'Graph Save: restore snapshot', RESTORE_BUTTON_CLASS, () =>
		new SnapshotHistoryModal(plugin, graphManager, leaf).open());

	const shuffleButton = createAction('shuffle', 'Graph Save: shuffle layout', SHUFFLE_BUTTON_CLASS, () => {
		if (!graphManager.shuffleLayout(leaf)) {
			showNotice('Graph Save: no graph view found');
			return;
		}
		void plugin.saveSettings();
		showNotice('Graph Save: layout shuffled');
	});

	actions.prepend(saveButton, restoreButton, shuffleButton);
}

export function removeGraphActions(leaf: CustomLeaf) {
	leaf.view.containerEl.querySelector(`.${SAVE_BUTTON_CLASS}`)?.remove();
	leaf.view.containerEl.querySelector(`.${RESTORE_BUTTON_CLASS}`)?.remove();
	leaf.view.containerEl.querySelector(`.${SHUFFLE_BUTTON_CLASS}`)?.remove();
}

function createAction(icon: string, label: string, className: string, onClick: () => void) {
	const button = activeDocument.createElement('div');
	button.className = `clickable-icon view-action ${className}`;
	button.setAttribute('aria-label', label);
	setIcon(button, icon);
	button.addEventListener('click', onClick);
	return button;
}
