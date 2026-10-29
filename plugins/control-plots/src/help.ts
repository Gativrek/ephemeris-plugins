/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Control Plots

Draws Bode plots, step responses and pole-zero maps from transfer functions you type into a note.

## Your first plot

1. On an empty line, type three backticks and \`bo\`, then pick **bode** from the suggestions with Enter. This writes a block with an example system in it, \`G = 1/(s+1)\`, selected.
2. Type your own system to replace it, or keep the example for now. (If the block comes out empty, type \`G = 1/(s+1)\` on the empty line.)
3. Click anywhere outside the block, or move the cursor out with the arrow keys. The text turns into the plot.

Written out, the block looks like this, and draws the plot below it:

\`\`\`\`
\`\`\`bode
G = 1/(s+1)
\`\`\`
\`\`\`\`

\`\`\`bode
G = 1/(s+1)
\`\`\`

To change the plot, click it: the text comes back for editing, and the plot is redrawn when you leave the block. If something in the block is wrong, the block shows an error that names the line instead of a plot.

Hover over a plot to read exact values.

## Picking a plot

The word after the backticks picks the plot. The lines inside work the same in all three, so you can change \`bode\` to \`step\` and keep everything else.

| Block | Shows |
|---|---|
| \`bode\` | Magnitude (dB) and phase (degrees) against frequency |
| \`step\` | The response to a unit step against time |
| \`pzmap\` | Poles (×) and zeros (○) in the complex plane |

## Next steps

**Compare systems.** Put one system per line, and they share the plot, each in its own colour:

\`\`\`step
G1 = 4/(s^2 + 0.4s + 4)
G2 = 4/(s^2 + 2s + 4)
\`\`\`

**Build a loop.** A system can use the ones above it, so you can write a plant, a controller and the closed loop as you would on paper. \`show\` picks which ones to draw:

\`\`\`step
G = 1/(s(s+1))
C = 10(s+1)/(s+10)
L = C*G
T = L/(1+L)
show = T
\`\`\`

**Add options.** Options use the same \`name = value\` form. This one marks the gain and phase margins:

\`\`\`bode
L = 10/(s(s+1)(s+5))
margins = on
\`\`\`

## Writing systems

A system is a name, an equals sign and a transfer function: \`G = …\`. Any name works except the option names below, \`s\` and \`tf\`. Write the transfer function either way:

- **As an expression in \`s\`**, the way you would on paper: \`(s + 2)/(s^2 + 3s + 2)\`. You can use \`+ - * /\`, parentheses, whole-number powers (\`s^2\`, \`(s+1)^3\`) and numbers like \`0.5\` or \`1e-3\`.
- **MATLAB style**, \`tf(num, den)\`, with coefficients from the highest power down: \`tf([1 2], [1 3 2])\` is the same system.

Writing things side by side multiplies them, and this binds tighter than \`/\`: \`10/(s+1)(s+2)\` is 10 / ((s + 1)(s + 2)), and \`2s\` is 2 × s.

\`L/(1+L)\` gives the closed loop, as MATLAB's \`feedback(L, 1)\` does. Nothing else is cancelled, just as with MATLAB's \`tf\`. Up to six systems can share a plot.

A line starting with \`#\` or \`%\` is a comment. Empty lines are ignored.

## Options

| Option | Blocks | Meaning |
|---|---|---|
| \`w = 0.01..1000\` | bode | Frequency range. Without it: two decades beyond the poles and zeros. |
| \`units = Hz\` | bode | Frequency in Hz instead of rad/s; \`w\` is then in Hz too. |
| \`margins = on\` | bode | Gain and phase margins, marked and written under the plot, as MATLAB's \`margin\` reports them. |
| \`t = 0..20\` | step | Time window. Without it: 6 / (the slowest stable pole's decay rate). |
| \`show = T, L\` | all | Draws only these systems, in this order. |
| \`grid = off\` | all | Hides the gridlines. |
| \`title = …\` | all | A title above the plot. |

Options a block does not use are ignored, so a block can change type freely.

To name a block in the note's outline, add \`title="Open loop"\` after \`bode\` on the block's first line. The name is also shown as a caption under the plot.

## Reading the plots

**Bode.** Magnitude and phase share the frequency axis. The phase starts where MATLAB's \`bode\` starts it: a negative gain at 180°, 1/s² at −180°. With \`margins = on\`, the crossover frequencies are marked and the margins are written under the plot.

**Step.** Stable systems show their final value. An unstable or marginally stable system says so under the plot. A system with more zeros than poles, such as \`L = s^2 + 2s + 1\`, has no step response: it is left out and named under the plot, so a loop's building blocks can stay in the block.

**Pole-zero map.** Equal axes, with the imaginary axis drawn. The poles and zeros are also listed under the plot.

## Accuracy

The plugin's tests compare it with MATLAB's \`bode\`, \`step\`, \`pole\`, \`zero\` and \`margin\` on fourteen systems: magnitude within 0.01 dB, phase within 0.1°, step samples within 1e-4 and roots within 1e-6. The step response is exact for a step input (a zero-order hold through the matrix exponential).

Continuous time only.
`;
