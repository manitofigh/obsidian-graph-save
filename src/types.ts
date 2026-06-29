import type { App, WorkspaceLeaf } from 'obsidian';

export type GraphOptions = Record<string, unknown>;

export interface NodePosition {
	id: string;
	x: number;
	y: number;
}

export interface GraphData {
	options: GraphOptions;
	nodePositions: NodePosition[];
}

export interface GraphSnapshot {
	id: string;
	name: string;
	createdAt: number;
	workspace: string | null;
	signature: string;
	data: GraphData;
}

export interface ForceNodePosition {
	id: string;
	x: number | null;
	y: number | null;
}

export interface GraphWorkerMessage {
	forceNode?: ForceNodePosition;
	run?: boolean;
	alpha?: number;
	alphaTarget?: number;
}

export interface GraphWorker {
	postMessage(message: GraphWorkerMessage): void;
	__graphSavePinPatched?: boolean;
}

export interface GraphDataEngine {
	getOptions(): GraphOptions;
	setOptions(options: GraphOptions): void;
}

export interface GraphRenderer {
	nodes: NodePosition[];
	worker: GraphWorker;
}

export interface GraphInternals {
	containerEl: HTMLElement;
	dataEngine: GraphDataEngine;
	renderer: GraphRenderer;
}

export interface GraphLeaf {
	view: {
		containerEl: HTMLElement;
		getViewType(): string;
		renderer: GraphRenderer;
		dataEngine: GraphDataEngine;
	};
}

export type CustomLeaf = WorkspaceLeaf & GraphLeaf;

export interface Workspaces {
	instance: {
		activeWorkspace: string;
		workspaces: Record<string, unknown>;
	};
}

export type AppWithInternalPlugins = App & {
	internalPlugins?: {
		getPluginById(id: string): Workspaces | undefined;
	};
};
