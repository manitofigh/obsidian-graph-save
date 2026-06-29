# Graph Save

`obsidian-graph-save` is an Obsidian plugin. Its marketplace name is **Graph Save**.

It saves and restores graph layouts for people who want to use the graph as a spatial map.

I find the spatial map very powerful, but the fact that Obsidian re-renders the nodes 
at random locations every time, makes this feature less practical/usable. 
This plugin aims to address that gap.

Graph Save is inspired by [obsidian-persistent-graph](https://github.com/Sanqui/obsidian-persistent-graph). 
It tries to fix some of its papercuts though: 
Graph Save offers auto save/restore, snapshots of various graph layouts, 
taking into account graph filters/groups/etc, being able to have 
different layouts per workspace, and some more features.

## list of features

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

This is implementation detail-related for anyone who's interested in 
the inner workings of the plugin: the relatively smooth animation 
that restores the position of the nodes, works by constantly moving 
the position of the nodes, as Obsidian loads them, towards their final 
"resting" position where they stay in place. Obsidian keeps 
re-rendering the graph window as these nodes are being moved by 
the plugin, giving them a little animation similar to how Obsidian 
moves the nodes into random spots by default.

# Install 

## Community Plugins

https://community.obsidian.md/plugins/graph-save

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
