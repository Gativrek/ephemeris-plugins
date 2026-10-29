/** The plugin's help page (SPECS 13.1): the Mermaid quick tutorial, with live examples. */
export const HELP = `# Mermaid quick tutorial

Diagrams draws flowcharts and control block diagrams from \`mermaid\` blocks. Write them as text, or draw them with the mouse and let the plugin write the text.

## Your first diagram

1. On an empty line, type three backticks and \`mer\`, then pick **mermaid** from the suggestions with Enter. This writes a small flowchart, selected.
2. Click outside the block. The text turns into the diagram.
3. To change it, hover over the diagram and click **Edit** to draw on the canvas, or double-click the diagram to edit the text.

\`\`\`\`
\`\`\`mermaid
flowchart LR
  A[Start] --> B{Ready?}
  B -->|yes| C[Done]
\`\`\`
\`\`\`\`

\`\`\`mermaid
flowchart LR
  A[Start] --> B{Ready?}
  B -->|yes| C[Done]
\`\`\`

## Writing flowcharts

The first line is \`flowchart\` and a direction: \`LR\` (left to right), \`RL\`, \`TD\` (top down), or \`BT\`. Then one node or one arrow per line.

| Write | Draws |
|---|---|
| \`A[Text]\` | A rectangle |
| \`A((Text))\` | A circle |
| \`A{Text}\` | A diamond, for a decision |
| \`A --> B\` | An arrow from A to B |
| \`A --- B\` | A line without an arrowhead |

To label an arrow, put the label between pipes after it: \`A -->|yes| B\`. \`A\` and \`B\` are names you choose: letters, digits and \`_\`, starting with a letter. A name used in an arrow before it is defined becomes a rectangle showing its name. Quote a label that has brackets, braces or a pipe in it: \`A["f(x) [1]"]\`.

\`\`\`mermaid
flowchart TD
  A[Read the sensor] --> B{Value in range?}
  B -->|yes| C[Log it]
  B -->|no| D[Raise an alarm]
  D --> A
  %% @pos A 160 40
  %% @pos B 160 136
  %% @pos C 160 240
  %% @pos D 340 136
\`\`\`

## Drawing on the canvas

**Edit** opens the canvas. Its tools, with their keys:

| Tool | Key | Does |
|---|---|---|
| Select | V | Click to select, drag to move. A selected node shows four handles: drag one onto another node to connect them. |
| Rectangle, Circle, Diamond | R, C, D | Click to place a node, then type its label. |
| Junction, Branch | J, B | Click to place a summing junction or a branch point. |
| Text | T | Click to place a label with no outline, such as a signal name. |
| Connect | L | Drag from one node to another. |

Double-click a node or a label to rename it. Delete removes the selection. Drag the empty canvas (or hold Space, or use the middle button) to pan, and use the wheel to zoom. G turns the 8px snap grid on and off, and the arrow keys nudge the selected node. Ctrl+Z and Ctrl+Shift+Z undo and redo while the canvas is open.

**Done** writes the diagram back into the note as one change, so Ctrl+Z in the note undoes the whole edit. Closing with changes asks whether to apply them.

Positions are saved as comments, one per node: \`%% @pos A 160 40\` puts A's centre at (160, 40). Other apps, such as Obsidian or GitHub, ignore these comments and lay out the same graph themselves, so the diagram looks different there but says the same thing. A diagram with no positions is laid out by Mermaid; the canvas starts from that layout.

## Control block diagrams

Control diagrams use three more shapes and math labels. They are standard Mermaid, so other apps draw them too.

| Write | Draws |
|---|---|
| \`e@{ shape: cross-circ }\` | A summing junction |
| \`b@{ shape: f-circ }\` | A branch point, where a signal splits |
| \`r@{ shape: text, label: "r" }\` | A label with no outline, for inputs and outputs |
| \`G["$$G(s)$$"]\` | Math in a label, between \`$$\` and \`$$\` |

The sign of a junction input is the arrow's label: \`b -->|-| e\` draws a − beside the arrowhead, and \`|+|\` a +.

Edges run horizontally and vertically. An edge that runs against the flow, such as a feedback path, goes underneath the nodes it passes (on the right in a top-down chart) and enters its target from below, as on paper. On the canvas, a new edge into a junction gets a + sign; double-click the sign to flip it.

\`\`\`\`
\`\`\`mermaid
flowchart LR
  r@{ shape: text, label: "r" }
  e@{ shape: cross-circ }
  C["$$C(s)$$"]
  G["$$G(s)$$"]
  b@{ shape: f-circ }
  y@{ shape: text, label: "y" }
  r -->|+| e
  e -->|e| C
  C -->|u| G
  G --- b
  b --> y
  b -->|-| e
\`\`\`
\`\`\`\`

With positions added on the canvas, it draws like this:

\`\`\`mermaid
flowchart LR
  r@{ shape: text, label: "r" }
  e@{ shape: cross-circ }
  C["$$C(s)$$"]
  G["$$G(s)$$"]
  b@{ shape: f-circ }
  y@{ shape: text, label: "y" }
  r -->|+| e
  e -->|e| C
  C -->|u| G
  G --- b
  b --> y
  b -->|-| e
  %% @pos r 40 64
  %% @pos e 112 64
  %% @pos C 216 64
  %% @pos G 352 64
  %% @pos b 448 64
  %% @pos y 512 64
\`\`\`

## What the canvas does not edit

Mermaid has much more: rounded and other shapes, dotted and thick arrows, \`A -- text --> B\`, chains like \`A --> B --> C\`, subgraphs, styles and other diagram types. A block that uses any of these still renders, through Mermaid, but the canvas only shows it, with the line it cannot edit.

Two of the other diagram types, as a taste:

\`\`\`mermaid
sequenceDiagram
  Sensor->>Filter: measurement
  Filter->>Controller: estimate
  Controller-->>Sensor: next sample
\`\`\`

\`\`\`mermaid
stateDiagram-v2
  [*] --> Idle
  Idle --> Running: start
  Running --> Idle: stop
\`\`\`

The full syntax is in the Mermaid documentation at mermaid.js.org.
`;
