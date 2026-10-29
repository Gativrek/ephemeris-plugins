/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Data Plot

Plots columns of a CSV file, such as a run exported from MATLAB, next to your notes. The plot redraws when the file changes.

## Your first plot

1. Put a CSV file in the Vault, for example \`data/run3.csv\` next to the note. The first row names the columns.
2. In the note, type three backticks and \`plo\`, then pick **plot** with Enter (or press \`Ctrl+Shift+C\` and type \`plo\`). This writes a small example plot.
3. Replace the example with the file and the columns to plot:

\`\`\`\`
\`\`\`plot
file: data/run3.csv
x: t
y: [roll, pitch, yaw]
\`\`\`
\`\`\`\`

4. Click outside the block to see the plot. Hover over it to read the values.

## Data in the block

Small tables can live in the block itself: write the options, a line with \`---\`, then the CSV.

\`\`\`plot
x: t
y: [roll, pitch]
title: Attitude, run 3
xlabel: Time (s)
ylabel: Angle (deg)
---
t, roll, pitch
0, 0.0, 1.0
1, 2.1, 0.8
2, 3.9, 0.3
3, 4.6, -0.4
4, 4.1, -0.9
5, 2.8, -1.1
6, 1.2, -0.8
\`\`\`

## Options

One per line, as \`option: value\`. Only one of \`file\` and the \`---\` rows is needed.

| Option | Meaning |
|---|---|
| \`file: data/run3.csv\` | The CSV, relative to the note's folder. Start with \`/\` for the Vault's root: \`/data/run3.csv\`. |
| \`x: t\` | The x column. Without it: the first column. |
| \`y: [roll, pitch]\` | The columns to plot, up to six. One column needs no brackets. Without it: every other column. |
| \`kind: line\` | \`line\`, \`scatter\` or \`step\`. |
| \`title: …\` | A title above the plot. |
| \`xlabel: Time (s)\` | The x axis label. Without it: the x column's name. |
| \`ylabel: …\` | The y axis label. Without it: the column's name when there is one. |
| \`logx: true\` | A logarithmic x axis; \`logy\` for y. Values at or below zero are left out, and the plot says how many. |
| \`grid: off\` | Hides the gridlines. |
| \`delimiter: ;\` | \`,\`, \`;\` or \`tab\`. Without it: whichever the first line uses. |
| \`decimal: ,\` | Decimal commas (\`3,14\`), as Excel writes them in Brazilian Portuguese. Detected when the delimiter is \`;\` or tab. |

Columns can be named or numbered from 1: \`y: [2, 3]\`. A file whose first row is all numbers (MATLAB's \`writematrix\`) has no header, so its columns are numbered. A line starting with \`#\` is a comment.

## Kinds

\`\`\`plot
kind: scatter
x: voltage
y: current
---
voltage, current
0.5, 0.11
1.0, 0.19
1.5, 0.32
2.0, 0.41
2.5, 0.48
3.0, 0.62
\`\`\`

\`\`\`plot
kind: step
x: k
y: u
---
k, u
0, 0
1, 1
2, 1
3, 0.5
4, 0.5
5, 0
\`\`\`

## Long files and changes

- **Long files:** lines longer than 5,000 samples are drawn from 5,000 of them, chosen to keep the line's shape (largest-triangle downsampling). Hover still reads every sample, and the plot says so.
- **Gaps:** an empty cell leaves a gap in the line.
- **Changes:** when the file changes on disk, for example when MATLAB writes a new run with \`writetable\`, the plot reads it again.
- **Problems:** a missing file, an unknown column or a cell that is not a number shows an error that names it.
`;
