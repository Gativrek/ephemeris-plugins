# Ephemeris plugins

Plugins for [Ephemeris](https://github.com/Gativrek/ephemeris-notes), the desktop note app for plain Markdown notes. Each plugin lives in `plugins/<id>/` and builds into its own folder that the app installs.

| Plugin | Block | What it does |
|---|---|---|
| [Text to Image](plugins/text-to-image) | ` ```combo ` | Draws token notation, such as fighting-game combos, as images through data-only profiles. |
| [Control Plots](plugins/control-plots) | ` ```bode ` ` ```step ` ` ```pzmap ` | Bode, step and pole-zero plots from transfer functions, checked against MATLAB. |
| [Diagrams](plugins/diagrams) | ` ```mermaid ` | Mermaid flowcharts and control block diagrams, with a drag-and-drop canvas. |
| [Data Plot](plugins/data-plot) | ` ```plot ` | Line, scatter and step plots of CSV files in the Vault, redrawn when the file changes. |
| [Citations](plugins/citations) | `[@key]` and ` ```bibliography ` | Pandoc citations from BibTeX or CSL-JSON, in IEEE or ABNT, with hover cards and a reference list. |
| [Flashcards](plugins/flashcards) | `front :: back` and `{{cloze}}` lines | Cards in notes with `flashcards: true`, scheduled with FSRS and reviewed on the desk. |

Plugins use only the typed plugin API, `@ephemeris-notes/plugin-api`. They run in the app's renderer with no Node access. Plugins are trusted code: install only plugins you trust.

Control Plots and Data Plot share their plot frame (scales, panels, legend, hover and its CSS) through `packages/chart`, a workspace package each of them bundles; it sets each plugin's own class prefix.

## Development

Requires Node.js and pnpm. The plugin API is linked from the Ephemeris repository, so check this repository out at `ephemeris-plugins/` inside an `ephemeris-notes` checkout.

```
pnpm install
pnpm build        # every plugin into plugins/<id>/dist/
pnpm test         # unit tests (Vitest)
pnpm typecheck
pnpm lint
```

To try a plugin, build it, then in Ephemeris open Settings > Plugins > Install from Folder… and pick `plugins/<id>/dist`. Reinstalling the same folder replaces the plugin.

## Text to Image

````
```combo numpad
5H > 2M > 236L
```
````

The profile comes from the word after `combo`, then the note's `combo-profile` property, then the default in the plugin's settings. Profiles are folders of JSON and images in the library (`.ephemeris/plugin-data/text-to-image/profiles/<id>/`), so they sync with the notes and are safe to share. The plugin ships one example profile, **Numpad**, with original glyphs (Settings > Plugins > Text to Image > Add Example Profile). It ships no game art; use images you have the right to use. The plugin's help page, in Settings > Help, documents the profile format.

## Control Plots

````
```bode
G = 10/(s(s+1)(s+5))
margins = on
```
````

To start one, type ` ```bo ` (or `st`, `pz`) and pick the block from the suggestions, write a line like `G = 1/(s+1)`, and leave the block. The help page, Settings > Help > Control Plots guide, walks through a first plot. Systems are `tf([num], [den])` or expressions in `s`, and may build on each other (`L = C*G`, `T = L/(1+L)`). The plugin's help page lists the options. The tests compare Bode magnitude and phase, step samples, poles, zeros and margins with MATLAB's Control System Toolbox on fourteen systems; `pnpm --filter @ephemeris-plugins/control-plots refs` regenerates the references in `plugins/control-plots/test/refs` (needs MATLAB), and the committed CSVs let the tests run without it.

Plot colours come from the design system's `viz-1` … `viz-6` tokens, with the same values built in for apps that predate them.

## Diagrams

````
```mermaid
flowchart LR
  r@{ shape: text, label: "r" } -->|+| e@{ shape: cross-circ }
  e --> G["$$G(s)$$"]
  G --- b@{ shape: f-circ }
  b --> y@{ shape: text, label: "y" }
  b -->|-| e
```
````

Any Mermaid diagram renders, through Mermaid (11.17, loaded on first use from its own chunks, so a library without diagrams does not pay for it). A flowchart in the editable subset (rectangles, circles, diamonds, summing junctions, branch points, text labels, `-->` and `---` with labels, math labels in `$$…$$`) can be drawn on a canvas from the block's Edit button. The canvas saves node positions as `%% @pos ID x y` comments, and once every node has one, the plugin draws the diagram itself, with horizontal and vertical edges and feedback paths routed underneath. Other apps ignore the comments and lay out the same graph. The help page, Settings > Help > Mermaid quick tutorial, covers the syntax and the canvas.

## Data Plot

````
```plot
file: data/run3.csv
x: t
y: [roll, pitch, yaw]
xlabel: Time (s)
```
````

The file is relative to the note (or to the Vault root with a leading `/`); small tables can follow a `---` line in the block instead. The delimiter and decimal commas are detected, a header-less file (MATLAB `writematrix`) is read by column number, and lines longer than 5,000 samples are thinned with LTTB for drawing while hover reads every sample. The help page lists the options.

## Citations

Write `[@groves2013, p. 45]` or `@groves2013` with keys from Zotero (Better BibTeX), choose the exported `.bib` or CSL-JSON file in Settings > Plugins > Citations, and put a `bibliography` block where the reference list goes. IEEE numbers references in the order the note cites them, live as you type; ABNT is author and year. A note can add its own libraries with Pandoc's `bibliography:` frontmatter. Bracketed citations need an Ephemeris build newer than 1.2.0 (the grammar change that stops `[@key]` from being read as a link).

**Licenses.** Citations bundles [citeproc-js](https://github.com/Juris-M/citeproc-js) 2.4.63, unmodified, under the CPAL-1.0 (it is also offered under the AGPL-3.0); its license is in `dist/licenses/citeproc-js.txt`. The CSL styles and locales in `plugins/citations/csl/` are the Citation Style Language projects' own, under CC BY-SA 3.0. The rest of this repository is MIT.

## Flashcards

In a note with `flashcards: true` in its frontmatter, a line `front :: back` is a card, and a line with `{{hidden}}` parts is one card per part. **Review Due Cards (This Vault)** and **Review Cards in This Note** open the review on the desk: what is due per note and section, then each card, Space to see the answer, and 1-4 to grade. Scheduling is FSRS ([ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2, MIT); the state lives in the Vault's `.vault/plugin-data/flashcards/state.json`, and the only change to a note is a block ID (`^fc-a1b2c3`) on a card's line at its first review. Needs Ephemeris 1.4 or later (plugin API 1.3).

## License

MIT. See [`LICENSE`](LICENSE).
