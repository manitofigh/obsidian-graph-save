import { CustomLeaf, GraphWorker, GraphWorkerMessage } from './types';
import GraphSavePlugin from './main';

export class PinManager {
	private pinnedNodes: Set<string>;
	private lockedNodes = new WeakMap<CustomLeaf, Set<string>>();
	private originalPostMessages = new WeakMap<GraphWorker, (message: GraphWorkerMessage) => void>();

	constructor(private plugin: GraphSavePlugin) {
		if (!this.plugin.settings.pinnedNodes) {
			this.plugin.settings.pinnedNodes = [];
		}
		this.pinnedNodes = new Set(this.plugin.settings.pinnedNodes);
	}

	isPinned(nodeId: string): boolean {
		return this.pinnedNodes.has(nodeId);
	}

	async pinNode(nodeId: string, graphLeaf: CustomLeaf) {
		if (!this.plugin.settings.pinnedNodes) this.plugin.settings.pinnedNodes = [];

		if (!this.isPinned(nodeId)) {
			this.plugin.settings.pinnedNodes.push(nodeId);
			this.pinnedNodes.add(nodeId);
			await this.plugin.saveSettings();
		}

		const graph = this.getGraphParts(graphLeaf);
		const node = graph?.nodes.find((n) => n.id === nodeId);
		if (!graph || !node) return;

		graph.worker.postMessage({
			forceNode: { id: node.id, x: node.x, y: node.y }
		});
	}

	async unpinNode(nodeId: string, graphLeaf: CustomLeaf) {
		if (!this.plugin.settings.pinnedNodes) return;

		if (this.isPinned(nodeId)) {
			this.plugin.settings.pinnedNodes = this.plugin.settings.pinnedNodes.filter(id => id !== nodeId);
			this.pinnedNodes.delete(nodeId);
			await this.plugin.saveSettings();
		}

		const graph = this.getGraphParts(graphLeaf);
		if (!graph) return;

		graph.worker.postMessage({
			forceNode: { id: nodeId, x: null, y: null }
		});
	}

	lockNodes(graphLeaf: CustomLeaf, nodeIds: string[]) {
		this.lockedNodes.set(graphLeaf, new Set(nodeIds));
	}

	unlockNodes(graphLeaf: CustomLeaf) {
		this.lockedNodes.delete(graphLeaf);
	}

	patchWorker(graphLeaf: CustomLeaf) {
		const worker = this.getGraphParts(graphLeaf)?.worker;
		if (!worker || worker.__graphSavePinPatched) return;

		const originalPostMessage = worker.postMessage.bind(worker);
		this.originalPostMessages.set(worker, originalPostMessage);

		worker.postMessage = (message: GraphWorkerMessage) => {
			if (message?.forceNode?.x === null && message?.forceNode?.y === null) {
				if (this.isPinned(message.forceNode.id) || this.isLocked(graphLeaf, message.forceNode.id)) {
					this.forceCurrentNode(message.forceNode.id, graphLeaf);
					return;
				}
			}
			originalPostMessage(message);
		};

		worker.__graphSavePinPatched = true;
	}

	unpatchWorker(graphLeaf: CustomLeaf) {
		const worker = this.getGraphParts(graphLeaf)?.worker;
		const originalPostMessage = worker ? this.originalPostMessages.get(worker) : null;
		if (!worker || !originalPostMessage) return;

		worker.postMessage = originalPostMessage;
		worker.__graphSavePinPatched = false;
		this.originalPostMessages.delete(worker);
	}

	private getGraphParts(graphLeaf: CustomLeaf): { nodes: CustomLeaf['view']['renderer']['nodes']; worker: GraphWorker } | null {
		const renderer = graphLeaf.view?.renderer;
		if (!Array.isArray(renderer?.nodes)) return null;
		if (typeof renderer.worker?.postMessage !== 'function') return null;

		return {
			nodes: renderer.nodes,
			worker: renderer.worker,
		};
	}

	private isLocked(graphLeaf: CustomLeaf, nodeId: string): boolean {
		return !!this.lockedNodes.get(graphLeaf)?.has(nodeId);
	}

	private forceCurrentNode(nodeId: string, graphLeaf: CustomLeaf) {
		const graph = this.getGraphParts(graphLeaf);
		const node = graph?.nodes.find((item) => item.id === nodeId);
		if (!graph || !node) return;

		graph.worker.postMessage({
			forceNode: { id: node.id, x: node.x, y: node.y }
		});
	}

	handleRename(newPath: string, oldPath: string): boolean {
		let changed = false;
		if (!this.plugin.settings.pinnedNodes) return false;

		this.plugin.settings.pinnedNodes = this.plugin.settings.pinnedNodes.map(pNode => {
			if (pNode === oldPath) {
				changed = true;
				return newPath;
			}
			if (pNode.startsWith(oldPath + '/')) {
				changed = true;
				return newPath + pNode.substring(oldPath.length);
			}
			return pNode;
		});

		if (changed) {
			this.pinnedNodes = new Set(this.plugin.settings.pinnedNodes);
		}

		return changed;
	}

	handleDelete(deletedPath: string): boolean {
		if (!this.plugin.settings.pinnedNodes) return false;

		const nextPinnedNodes = this.plugin.settings.pinnedNodes.filter((nodeId) =>
			nodeId !== deletedPath && !nodeId.startsWith(deletedPath + '/'));
		const changed = nextPinnedNodes.length !== this.plugin.settings.pinnedNodes.length;

		if (changed) {
			this.plugin.settings.pinnedNodes = nextPinnedNodes;
			this.pinnedNodes = new Set(nextPinnedNodes);
		}

		return changed;
	}
}
