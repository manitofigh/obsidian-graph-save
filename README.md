# Graph Save

`obsidian-graph-save` is an Obsidian plugin. Its marketplace name is **Graph Save**.

It saves and restores graph layouts for people who want to use the graph as a spatial map.

I find the spatial map very powerful, but the fact that Obsidian re-renders the nodes 
into  

Graph Save is inspired by [obsidian-persistent-graph](https://github.com/Sanqui/obsidian-persistent-graph). It focuses on autosave, progressive restore, snapshots, and reshuffling the layout when you want a new graph layout.

## Features

- autosaves graph node positions at the autosave interval
- restores the graph layout based on the latest autosave
- the restoration is a smooth animation of nodes moving to their previous location
- can take "snapshots" of various graph layouts and switch between them
- restoring, renmaing, and deleting snapshots
- "shuffling" to try out a new layout, until you like one that you are satisfied with
- optional (not enabled by default): it can save graph filters, groups, display, and forces
- optional (not enabled by default): can save one graph layout per Obsidian Workspaces layout

## Notes

If you had taken a snapshot from an old layout, have changed layouts since, added/removed nodes, and 
now want to restore the older snapshot/layout, doing so will not lose/delete newer nodes/notes.

Obsidian does not expose a public API for graph node positions. 
Graph Save uses private graph internals, so an Obsidian update may require a plugin update.

# Install 

## Community Plugins

Working on it...

## Install Manually

Download these files from the repo:

- `main.js`
- `manifest.json`
- `styles.css`

Put them in:

```text
<vault>/.obsidian/plugins/graph-save/
```

Then enable **Graph Save** from Obsidian's Community plugins settings.

## Local Development

```bash
npm install
npm run build
mkdir -p "<vault>/.obsidian/plugins"
ln -sfn "/path/to/obsidian-graph-save" "<vault>/.obsidian/plugins/graph-save"
```

Use `npm run dev` for rebuilds while editing.

```bash
npm run check
npm run build
```
