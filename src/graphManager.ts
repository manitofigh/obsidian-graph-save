import { TAbstractFile } from 'obsidian';
import { AppWithInternalPlugins, CustomLeaf, GraphData, GraphInternals, GraphOptions, GraphSnapshot, NodePosition } from './types';
import GraphSavePlugin from './main';
import { showNotice } from './notice';
import { PinManager } from './pinManager';

interface FindGraphLeafOptions {
	silent?: boolean;
}

interface SaveGraphDataOptions {
	silent?: boolean;
}

interface FlushAutoSaveOptions {
	allowDuringShuffle?: boolean;
}

interface RestoreGraphDataOptions {
	immediate?: boolean;
}

export type CreateSnapshotResult = 'created' | 'unchanged' | 'missing-graph';

interface NodeMigration {
	id: string;
	startX: number;
	startY: number;
	targetX: number;
	targetY: number;
	startedAt: number;
	duration: number;
}

interface RestoreRunState {
	lastNodeCount: number;
	stableIterations: number;
	totalIterations: number;
	migrations: Map<string, NodeMigration>;
	completedNodeIds: Set<string>;
	animationFrame: number | null;
	lastAnimationAt: number;
}

const RESTORE_TICK_MS = 50;
const RESTORE_STABLE_ITERATIONS = 3;
const RESTORE_MAX_ITERATIONS = 100;
const RESTORE_RELEASE_DELAY_MS = 250;
const MIGRATION_MIN_DURATION_MS = 260;
const MIGRATION_MAX_DURATION_MS = 700;
const MIGRATION_FRAME_THROTTLE_MS = 16;
const MIGRATION_SETTLE_DISTANCE = 1;
const DEFAULT_AUTO_SAVE_INTERVAL_SECONDS = 1;
const MAX_SNAPSHOTS = 20;
const SHUFFLE_RELEASE_DELAY_MS = 120;
const SHUFFLE_SIMULATION_MS = 2200;
const SHUFFLE_ALPHA_TARGET = 0.7;
const SHUFFLE_SAVE_DELAYS_MS = [2600, 4200, 6500];

export class GraphManager {
	private autoSaveInterval: number | null = null;
	private autoSaveInFlight = false;
	private autoSaveLastSignature: string | null = null;
	private autoRestoredLeaves = new WeakSet<CustomLeaf>();
	private restoringLeaves = new WeakSet<CustomLeaf>();
	private restoreRunIds = new WeakMap<CustomLeaf, number>();
	private shuffleRunIds = new WeakMap<CustomLeaf, number>();
	private shuffleSavingLeaves = new WeakSet<CustomLeaf>();
	public pinManager: PinManager;

	constructor(private plugin: GraphSavePlugin) {
		this.pinManager = new PinManager(plugin);
	}

	private get app() {
		return this.plugin.app;
	}

	private get settings() {
		return this.plugin.settings;
	}

	getActiveLeaf(): CustomLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		return leaf?.view.getViewType() === 'graph' ? leaf as CustomLeaf : null;
	}

	findGraphLeaf(options: FindGraphLeafOptions = {}): CustomLeaf | undefined {
		const activeLeaf = this.getActiveLeaf();
		if (activeLeaf) return activeLeaf;

		const graphLeaves = this.app.workspace.getLeavesOfType('graph');
		if (graphLeaves.length != 1) {
			if (!options.silent) {
				if (graphLeaves.length < 1) {
					showNotice('Graph Save: no graph view open');
				} else {
					showNotice('Graph Save: more than one graph view open');
				}
			}
			return;
		}
		return graphLeaves[0] as CustomLeaf;
	}

	getActiveWorkspaceName(): string | null {
		if (!this.settings.enableWorkspaces) {
			return null;
		}
		const workspaces = (this.app as AppWithInternalPlugins).internalPlugins?.getPluginById('workspaces');

		return workspaces?.instance.activeWorkspace || null;
	}

	getGraphData(): GraphData {
		const workspaceName = this.getActiveWorkspaceName();
		if (workspaceName && this.settings.workspacesGraphData[workspaceName]) {
			return this.settings.workspacesGraphData[workspaceName];
		}
		return {
			nodePositions: this.settings.nodePositions,
			options: this.settings.globalOptions || {}
		};
	}

	saveGraphData(graphLeaf?: CustomLeaf, options: SaveGraphDataOptions = {}): boolean {
		if (graphLeaf === undefined) {
			graphLeaf = this.findGraphLeaf({ silent: options.silent });
		}
		if (!graphLeaf) return false;

		const wName = this.getActiveWorkspaceName();
		const graphData = this.readGraphData(graphLeaf);
		if (!graphData) return false;

		if (wName) {
			this.settings.workspacesGraphData[wName] = graphData;
			this.markAutoSaveClean(graphLeaf);
			return true;
		}

		this.settings.nodePositions = graphData.nodePositions;
		this.settings.globalOptions = graphData.options;
		this.markAutoSaveClean(graphLeaf);

		return true;
	}

	createSnapshot(name: string, graphLeaf?: CustomLeaf): CreateSnapshotResult {
		if (graphLeaf === undefined) {
			graphLeaf = this.findGraphLeaf({ silent: true });
		}
		if (!graphLeaf) return 'missing-graph';

		const data = this.readGraphData(graphLeaf);
		if (!data) return 'missing-graph';

		const workspace = this.getActiveWorkspaceName();
		const signature = this.getGraphDataSignature(data, workspace);
		const latest = this.getSnapshots()[0];
		if (latest?.signature === signature) {
			return 'unchanged';
		}

		this.settings.snapshots.unshift({
			id: this.createSnapshotId(),
			name: name.trim() || this.createDefaultSnapshotName(),
			createdAt: Date.now(),
			workspace,
			signature,
			data,
		});
		this.trimSnapshots(workspace);

		return 'created';
	}

	getSnapshots(): GraphSnapshot[] {
		const workspace = this.getActiveWorkspaceName();
		return this.settings.snapshots
			.filter((snapshot) => snapshot.workspace === workspace)
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	restoreSnapshot(id: string, graphLeaf?: CustomLeaf): boolean {
		const snapshot = this.settings.snapshots.find((item) => item.id === id);
		if (!snapshot) return false;

		return this.restoreGraphData(snapshot.data, graphLeaf, { immediate: true });
	}

	renameSnapshot(id: string, name: string): boolean {
		const snapshot = this.settings.snapshots.find((item) => item.id === id);
		const nextName = name.trim();
		if (!snapshot || !nextName) return false;

		snapshot.name = nextName;
		return true;
	}

	deleteSnapshot(id: string): boolean {
		const nextSnapshots = this.settings.snapshots.filter((snapshot) => snapshot.id !== id);
		if (nextSnapshots.length === this.settings.snapshots.length) return false;

		this.settings.snapshots = nextSnapshots;
		return true;
	}

	shuffleLayout(graphLeaf?: CustomLeaf): boolean {
		if (graphLeaf === undefined) {
			graphLeaf = this.findGraphLeaf({ silent: true });
		}
		if (!graphLeaf) return false;

		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return false;

		this.autoRestoredLeaves.add(graphLeaf);
		this.restoreRunIds.set(graphLeaf, (this.restoreRunIds.get(graphLeaf) || 0) + 1);
		this.restoringLeaves.delete(graphLeaf);
		this.pinManager.unlockNodes(graphLeaf);
		const runId = (this.shuffleRunIds.get(graphLeaf) || 0) + 1;
		this.shuffleRunIds.set(graphLeaf, runId);
		if (this.settings.enableAutoSave) {
			this.shuffleSavingLeaves.add(graphLeaf);
		}

		this.shuffleNodes(graphLeaf, graph, runId);
		this.schedulePostShuffleSaves(graphLeaf, runId);
		return true;
	}

	queueAutoRestore(graphLeaf: CustomLeaf) {
		if (!this.settings.automaticallyRestoreNodePositions) {
			return;
		}
		if (this.autoRestoredLeaves.has(graphLeaf)) {
			return;
		}

		const saved = this.getGraphData();
		if (!saved.nodePositions?.length) {
			return;
		}

		this.autoRestoredLeaves.add(graphLeaf);

		const initOptions = this.getInitialGraphOptions(saved);
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return;

		graph.dataEngine.setOptions({
			...initOptions,
			'collapse-filter': false,
		});

		this.restoreGraphData(saved, graphLeaf);
	}

	private getInitialGraphOptions(saved: GraphData): GraphOptions {
		const { options } = saved;
		if (options && options.hasOwnProperty('search')) {
			return options;
		}
		return {};
	}

	restoreGraphData(saved: GraphData, graphLeaf?: CustomLeaf, options: RestoreGraphDataOptions = {}): boolean {
		if (graphLeaf === undefined) {
			graphLeaf = this.findGraphLeaf();
		}
		if (!graphLeaf) return false;

		const nodePositions = saved.nodePositions || [];
		if (nodePositions.length === 0) return false;

		const savedById = new Map<string, NodePosition>();
		nodePositions.forEach((node) => savedById.set(node.id, node));

		if (options.immediate) {
			return this.restoreGraphDataImmediately(saved, graphLeaf, savedById);
		}

		const runId = (this.restoreRunIds.get(graphLeaf) || 0) + 1;
		this.restoreRunIds.set(graphLeaf, runId);
		this.restoringLeaves.add(graphLeaf);
		this.pinManager.unlockNodes(graphLeaf);

		this.runIncrementalRestore(graphLeaf, savedById, runId, {
			lastNodeCount: -1,
			stableIterations: 0,
			totalIterations: 0,
			migrations: new Map(),
			completedNodeIds: new Set(),
			animationFrame: null,
			lastAnimationAt: 0,
		});
		return true;
	}

	private restoreGraphDataImmediately(saved: GraphData, graphLeaf: CustomLeaf, savedById: Map<string, NodePosition>): boolean {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return false;

		this.restoreRunIds.set(graphLeaf, (this.restoreRunIds.get(graphLeaf) || 0) + 1);
		this.restoringLeaves.add(graphLeaf);
		this.pinManager.unlockNodes(graphLeaf);

		const restoredIds: string[] = [];
		graph.renderer.nodes.forEach((node) => {
			const savedNode = savedById.get(node.id);
			if (!savedNode || !this.isFinitePosition(savedNode)) return;

			this.forceNode(graphLeaf, savedNode);
			restoredIds.push(node.id);
		});

		if (restoredIds.length === 0) {
			this.restoringLeaves.delete(graphLeaf);
			return false;
		}

		this.pinManager.lockNodes(graphLeaf, restoredIds);
		this.saveRestoredGraphData(saved, graphLeaf, savedById);
		this.restoringLeaves.delete(graphLeaf);
		this.markAutoSaveClean(graphLeaf);
		return true;
	}

	private runIncrementalRestore(
		graphLeaf: CustomLeaf,
		savedById: Map<string, NodePosition>,
		runId: number,
		state: RestoreRunState,
	) {
		if (this.restoreRunIds.get(graphLeaf) !== runId) {
			return;
		}
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) {
			this.cancelMigrationFrame(state);
			this.restoringLeaves.delete(graphLeaf);
			return;
		}

		this.startVisibleNodeMigrations(graphLeaf, savedById, runId, state);

		const currentNodeCount = graph.renderer.nodes.length;
		const stableIterations = currentNodeCount === state.lastNodeCount
			? state.stableIterations + 1
			: 0;
		const graphLoaded = !this.isObsidianGraphSearchLoading(graphLeaf);
		const hasNodes = currentNodeCount > 0;
		const restoreFinished = graphLoaded && hasNodes && stableIterations >= RESTORE_STABLE_ITERATIONS;
		const restoreTimedOut = state.totalIterations >= RESTORE_MAX_ITERATIONS;

		if (restoreFinished || restoreTimedOut) {
			this.finishRestore(graphLeaf, savedById, runId, state);
			return;
		}

		state.lastNodeCount = currentNodeCount;
		state.stableIterations = stableIterations;
		state.totalIterations++;

		window.setTimeout(() => this.runIncrementalRestore(graphLeaf, savedById, runId, state), RESTORE_TICK_MS);
	}

	private finishRestore(
		graphLeaf: CustomLeaf,
		savedById: Map<string, NodePosition>,
		runId: number,
		state: RestoreRunState,
	) {
		this.startVisibleNodeMigrations(graphLeaf, savedById, runId, state);

		window.setTimeout(() => {
			if (this.restoreRunIds.get(graphLeaf) !== runId) {
				return;
			}

			if (state.migrations.size > 0) {
				this.finishRestore(graphLeaf, savedById, runId, state);
				return;
			}

			this.restoringLeaves.delete(graphLeaf);
			this.lockRestoredNodes(graphLeaf, savedById);
			this.markAutoSaveClean(graphLeaf);
		}, RESTORE_RELEASE_DELAY_MS);
	}

	private startVisibleNodeMigrations(
		graphLeaf: CustomLeaf,
		savedById: Map<string, NodePosition>,
		runId: number,
		state: RestoreRunState,
	) {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return;

		graph.renderer.nodes.forEach((node) => {
			const savedNode = savedById.get(node.id);
			if (!savedNode) return;
			if (state.completedNodeIds.has(node.id) || state.migrations.has(node.id)) return;
			if (!this.isFinitePosition(savedNode)) return;

			const startX = Number.isFinite(node.x) ? node.x : savedNode.x;
			const startY = Number.isFinite(node.y) ? node.y : savedNode.y;
			const distance = Math.hypot(savedNode.x - startX, savedNode.y - startY);

			if (distance <= MIGRATION_SETTLE_DISTANCE) {
				this.forceNode(graphLeaf, savedNode);
				state.completedNodeIds.add(node.id);
				return;
			}

			state.migrations.set(node.id, {
				id: node.id,
				startX,
				startY,
				targetX: savedNode.x,
				targetY: savedNode.y,
				startedAt: performance.now(),
				duration: this.getMigrationDuration(distance),
			});
		});

		this.scheduleMigrationFrame(graphLeaf, runId, state);
	}

	private scheduleMigrationFrame(graphLeaf: CustomLeaf, runId: number, state: RestoreRunState) {
		if (state.migrations.size === 0 || state.animationFrame !== null) {
			return;
		}

		state.animationFrame = window.requestAnimationFrame((timestamp) => {
			state.animationFrame = null;
			this.animateMigrations(graphLeaf, runId, state, timestamp);
		});
	}

	private animateMigrations(graphLeaf: CustomLeaf, runId: number, state: RestoreRunState, timestamp: number) {
		if (this.restoreRunIds.get(graphLeaf) !== runId) {
			this.cancelMigrationFrame(state);
			return;
		}
		if (!this.getGraphInternals(graphLeaf)) {
			this.cancelMigrationFrame(state);
			this.restoringLeaves.delete(graphLeaf);
			return;
		}

		if (state.lastAnimationAt > 0 && timestamp - state.lastAnimationAt < MIGRATION_FRAME_THROTTLE_MS) {
			this.scheduleMigrationFrame(graphLeaf, runId, state);
			return;
		}
		state.lastAnimationAt = timestamp;

		const completed: string[] = [];
		state.migrations.forEach((migration) => {
			const progress = Math.min(1, (timestamp - migration.startedAt) / migration.duration);
			const easedProgress = this.easeOutCubic(progress);
			const x = migration.startX + (migration.targetX - migration.startX) * easedProgress;
			const y = migration.startY + (migration.targetY - migration.startY) * easedProgress;

			this.forceNode(graphLeaf, {
				id: migration.id,
				x,
				y,
			});

			if (progress >= 1) {
				this.forceNode(graphLeaf, {
					id: migration.id,
					x: migration.targetX,
					y: migration.targetY,
				});
				completed.push(migration.id);
			}
		});

		completed.forEach((nodeId) => {
			state.migrations.delete(nodeId);
			state.completedNodeIds.add(nodeId);
		});

		this.scheduleMigrationFrame(graphLeaf, runId, state);
	}

	private forceNode(graphLeaf: CustomLeaf, node: NodePosition) {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return;

		const renderedNode = graph.renderer.nodes.find((item) => item.id === node.id);
		if (renderedNode) {
			renderedNode.x = node.x;
			renderedNode.y = node.y;
		}

		graph.renderer.worker.postMessage({
			forceNode: node,
		});
	}

	private saveRestoredGraphData(saved: GraphData, graphLeaf: CustomLeaf, savedById: Map<string, NodePosition>) {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return;

		const visibleNodes = graph.renderer.nodes.map((node) => {
			const savedNode = savedById.get(node.id);
			return savedNode && this.isFinitePosition(savedNode)
				? { id: node.id, x: savedNode.x, y: savedNode.y }
				: { id: node.id, x: node.x, y: node.y };
		});
		const graphData = {
			nodePositions: this.mergeNodePositions(this.getGraphData().nodePositions, visibleNodes),
			options: this.settings.enableSaveOptions ? saved.options : {},
		};
		const workspaceName = this.getActiveWorkspaceName();

		if (workspaceName) {
			this.settings.workspacesGraphData[workspaceName] = graphData;
			return;
		}

		this.settings.nodePositions = graphData.nodePositions;
		this.settings.globalOptions = graphData.options;
	}

	private lockRestoredNodes(graphLeaf: CustomLeaf, savedById: Map<string, NodePosition>) {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return;

		this.pinManager.lockNodes(
			graphLeaf,
			graph.renderer.nodes
				.map((node) => node.id)
				.filter((id) => savedById.has(id)),
		);
	}

	private shuffleNodes(graphLeaf: CustomLeaf, graph: GraphInternals, runId: number) {
		const nodes = graph.renderer.nodes;
		if (nodes.length === 0) return;

		const center = this.getNodeCenter(nodes);
		const radius = Math.max(700, Math.min(5000, Math.sqrt(nodes.length) * 130));
		const nodeIds = nodes.map((node) => node.id);

		nodes.forEach((node) => {
			const angle = Math.random() * Math.PI * 2;
			const distance = radius * (0.35 + Math.sqrt(Math.random()) * 0.65);
			graph.renderer.worker.postMessage({
				forceNode: {
					id: node.id,
					x: center.x + Math.cos(angle) * distance,
					y: center.y + Math.sin(angle) * distance,
				},
			});
		});

		graph.renderer.worker.postMessage({ run: true, alpha: 1, alphaTarget: SHUFFLE_ALPHA_TARGET });
		window.setTimeout(() => {
			if (this.shuffleRunIds.get(graphLeaf) !== runId) return;

			nodeIds.forEach((id) => graph.renderer.worker.postMessage({
				forceNode: { id, x: null, y: null },
			}));
			graph.renderer.worker.postMessage({ run: true, alpha: 1, alphaTarget: SHUFFLE_ALPHA_TARGET });
		}, SHUFFLE_RELEASE_DELAY_MS);

		window.setTimeout(() => {
			if (this.shuffleRunIds.get(graphLeaf) !== runId) return;

			graph.renderer.worker.postMessage({ run: true, alphaTarget: 0 });
		}, SHUFFLE_SIMULATION_MS);
	}

	private schedulePostShuffleSaves(graphLeaf: CustomLeaf, runId: number) {
		if (!this.settings.enableAutoSave) return;

		SHUFFLE_SAVE_DELAYS_MS.forEach((delay, index) => {
			window.setTimeout(async () => {
				if (this.shuffleRunIds.get(graphLeaf) !== runId) return;

				await this.flushAutoSaveNow(graphLeaf, { allowDuringShuffle: true });
				if (index === SHUFFLE_SAVE_DELAYS_MS.length - 1) {
					this.shuffleSavingLeaves.delete(graphLeaf);
				}
			}, delay);
		});
	}

	private getNodeCenter(nodes: NodePosition[]): { x: number; y: number } {
		const sum = nodes.reduce((total, node) => ({
			x: total.x + node.x,
			y: total.y + node.y,
		}), { x: 0, y: 0 });

		return {
			x: sum.x / nodes.length,
			y: sum.y / nodes.length,
		};
	}

	private cancelMigrationFrame(state: RestoreRunState) {
		if (state.animationFrame !== null) {
			window.cancelAnimationFrame(state.animationFrame);
			state.animationFrame = null;
		}
	}

	private isFinitePosition(node: NodePosition): boolean {
		return Number.isFinite(node.x) && Number.isFinite(node.y);
	}

	private getMigrationDuration(distance: number): number {
		return Math.max(
			MIGRATION_MIN_DURATION_MS,
			Math.min(MIGRATION_MAX_DURATION_MS, MIGRATION_MIN_DURATION_MS + distance * 0.35),
		);
	}

	private easeOutCubic(progress: number): number {
		const inverse = 1 - progress;
		return 1 - inverse * inverse * inverse;
	}

	pruneSavedData() {
		let changed = false;
		const prune = (nodes: NodePosition[]) => nodes.filter((node) => this.shouldKeepSavedNode(node.id));
		const setNodes = (data: GraphData) => {
			const nextNodes = prune(data.nodePositions);
			if (nextNodes.length !== data.nodePositions.length) changed = true;
			data.nodePositions = nextNodes;
		};

		const nextGlobalNodes = prune(this.settings.nodePositions);
		if (nextGlobalNodes.length !== this.settings.nodePositions.length) changed = true;
		this.settings.nodePositions = nextGlobalNodes;

		Object.keys(this.settings.workspacesGraphData).forEach((name) => setNodes(this.settings.workspacesGraphData[name]));
		this.settings.snapshots.forEach((snapshot) => setNodes(snapshot.data));

		if (this.settings.enableWorkspaces) {
			const workspaces = (this.app as AppWithInternalPlugins).internalPlugins?.getPluginById('workspaces');
			const workspaceNames = workspaces?.instance.workspaces
				? Object.keys(workspaces.instance.workspaces)
				: null;

			if (workspaceNames) {
				Object.keys(this.settings.workspacesGraphData).forEach(name => {
					if (workspaceNames.includes(name)) return;
					delete this.settings.workspacesGraphData[name];
					changed = true;
				});
				const nextSnapshots = this.settings.snapshots.filter((snapshot) =>
					!snapshot.workspace || workspaceNames.includes(snapshot.workspace));
				if (nextSnapshots.length !== this.settings.snapshots.length) changed = true;
				this.settings.snapshots = nextSnapshots;
			}
		}

		if (changed) {
			this.refreshSnapshotSignatures();
			void this.plugin.saveSettings();
		}
	}

	startAutoSave() {
		this.stopAutoSave();
		const graphLeaf = this.findGraphLeaf({ silent: true });
		this.autoSaveLastSignature = graphLeaf ? this.getLeafSignature(graphLeaf) : null;
		const intervalMs = this.getAutoSaveIntervalMs();

		this.autoSaveInterval = window.setInterval(async () => {
			await this.flushAutoSaveNow();
		}, intervalMs);
	}

	stopAutoSave() {
		if (this.autoSaveInterval !== null) {
			window.clearInterval(this.autoSaveInterval);
			this.autoSaveInterval = null;
		}
	}

	async shutdownAutoSave() {
		this.stopAutoSave();
		await this.flushAutoSaveNow();
	}

	async flushAutoSaveNow(graphLeaf?: CustomLeaf, options: FlushAutoSaveOptions = {}) {
		if (this.autoSaveInFlight) {
			return;
		}

		if (graphLeaf === undefined) {
			graphLeaf = this.findGraphLeaf({ silent: true });
		}
		if (!graphLeaf || !this.canAutoSave(graphLeaf, options)) {
			return;
		}

		const signature = this.getLeafSignature(graphLeaf);
		if (signature === this.autoSaveLastSignature) {
			return;
		}

		this.autoSaveInFlight = true;
		try {
			if (this.saveGraphData(graphLeaf, { silent: true })) {
				await this.plugin.saveSettings();
				this.autoSaveLastSignature = signature;
			}
		} finally {
			this.autoSaveInFlight = false;
		}
	}

	private canAutoSave(graphLeaf: CustomLeaf, options: FlushAutoSaveOptions = {}): boolean {
		const graph = this.getGraphInternals(graphLeaf);
		return !!graph
			&& !this.restoringLeaves.has(graphLeaf)
			&& (options.allowDuringShuffle || !this.shuffleSavingLeaves.has(graphLeaf))
			&& !this.isObsidianGraphSearchLoading(graphLeaf)
			&& graph.renderer.nodes.length > 0;
	}

	private markAutoSaveClean(graphLeaf: CustomLeaf) {
		this.autoSaveLastSignature = this.getLeafSignature(graphLeaf);
	}

	private getAutoSaveIntervalMs(): number {
		const seconds = Number.isFinite(this.settings.autoSaveIntervalSeconds)
			? this.settings.autoSaveIntervalSeconds
			: DEFAULT_AUTO_SAVE_INTERVAL_SECONDS;
		return Math.max(1, seconds) * 1000;
	}

	private getLeafSignature(graphLeaf: CustomLeaf): string {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return '';

		return this.getGraphDataSignature({
			nodePositions: graph.renderer.nodes,
			options: this.settings.enableSaveOptions ? graph.dataEngine.getOptions() : {},
		}, this.getActiveWorkspaceName());
	}

	private readGraphData(graphLeaf: CustomLeaf): GraphData | null {
		const graph = this.getGraphInternals(graphLeaf);
		if (!graph) return null;

		const visibleNodes = graph.renderer.nodes.map((node) => ({
			id: node.id,
			x: node.x,
			y: node.y,
		}));

		return {
			nodePositions: this.mergeNodePositions(this.getGraphData().nodePositions, visibleNodes),
			options: this.settings.enableSaveOptions ? graph.dataEngine.getOptions() : {},
		};
	}

	private getGraphDataSignature(data: GraphData, workspace: string | null): string {
		const nodes = data.nodePositions
			.map((node) => ({
				id: node.id,
				x: Math.round(node.x),
				y: Math.round(node.y),
			}))
			.sort((a, b) => a.id.localeCompare(b.id));

		return JSON.stringify({
			workspace,
			nodes,
			options: this.settings.enableSaveOptions ? data.options : null,
		});
	}

	private createSnapshotId(): string {
		return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
	}

	private createDefaultSnapshotName(): string {
		return new Date().toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit',
		});
	}

	private trimSnapshots(workspace: string | null) {
		let keptInWorkspace = 0;
		this.settings.snapshots = this.settings.snapshots
			.sort((a, b) => b.createdAt - a.createdAt)
			.filter((snapshot) => {
				if (snapshot.workspace !== workspace) return true;
				keptInWorkspace++;
				return keptInWorkspace <= MAX_SNAPSHOTS;
			});
	}

	private refreshSnapshotSignatures() {
		this.settings.snapshots.forEach((snapshot) => {
			snapshot.signature = this.getGraphDataSignature(snapshot.data, snapshot.workspace);
		});
	}

	private isObsidianGraphSearchLoading(graphLeaf: CustomLeaf): boolean {
		return !!graphLeaf.view.containerEl.querySelector('.mod-search-setting')?.classList?.contains('is-loading');
	}

	private getGraphInternals(graphLeaf: CustomLeaf): GraphInternals | null {
		const view = graphLeaf.view;
		if (!view?.containerEl || !view?.renderer || !view?.dataEngine) return null;
		if (!Array.isArray(view.renderer.nodes)) return null;
		if (typeof view.renderer.worker?.postMessage !== 'function') return null;
		if (typeof view.dataEngine.getOptions !== 'function') return null;
		if (typeof view.dataEngine.setOptions !== 'function') return null;

		return {
			containerEl: view.containerEl,
			dataEngine: view.dataEngine,
			renderer: view.renderer,
		};
	}

	private mergeNodePositions(saved: NodePosition[], visible: NodePosition[]): NodePosition[] {
		const byId = new Map<string, NodePosition>();
		saved.filter((node) => this.shouldKeepSavedNode(node.id)).forEach((node) => byId.set(node.id, node));
		visible.forEach((node) => byId.set(node.id, node));
		return [...byId.values()];
	}

	private shouldKeepSavedNode(id: string): boolean {
		return !this.looksLikeVaultPath(id) || !!this.app.vault.getAbstractFileByPath(id);
	}

	private looksLikeVaultPath(id: string): boolean {
		return id.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(id);
	}

	handleRename(file: TAbstractFile, oldPath: string) {
		let changed = false;

		const updateNodeIds = (nodes: NodePosition[]) => {
			nodes.forEach(node => {
				if (node.id === oldPath) {
					node.id = file.path;
					changed = true;
				}
				else if (node.id.startsWith(oldPath + '/')) {
					node.id = file.path + node.id.substring(oldPath.length);
					changed = true;
				}
			});
		};

		if (this.settings.nodePositions) {
			updateNodeIds(this.settings.nodePositions);
		}

		if (this.settings.workspacesGraphData) {
			Object.keys(this.settings.workspacesGraphData).forEach(name => {
				const data = this.settings.workspacesGraphData[name];
				if (data.nodePositions) {
					updateNodeIds(data.nodePositions);
				}
			});
		}
		this.settings.snapshots.forEach((snapshot) => updateNodeIds(snapshot.data.nodePositions));

		if (this.pinManager.handleRename(file.path, oldPath)) changed = true;

		if (changed) {
			this.refreshSnapshotSignatures();
			void this.plugin.saveSettings();
		}
	}

	handleDelete(file: TAbstractFile) {
		let changed = false;
		const removeDeleted = (nodes: NodePosition[]) => nodes.filter((node) => {
			const keep = node.id !== file.path && !node.id.startsWith(file.path + '/');
			if (!keep) changed = true;
			return keep;
		});

		this.settings.nodePositions = removeDeleted(this.settings.nodePositions);
		Object.keys(this.settings.workspacesGraphData).forEach((name) => {
			this.settings.workspacesGraphData[name].nodePositions = removeDeleted(this.settings.workspacesGraphData[name].nodePositions);
		});
		this.settings.snapshots.forEach((snapshot) => {
			snapshot.data.nodePositions = removeDeleted(snapshot.data.nodePositions);
		});

		if (this.pinManager.handleDelete(file.path)) changed = true;
		if (changed) {
			this.refreshSnapshotSignatures();
			void this.plugin.saveSettings();
		}
	}
}
