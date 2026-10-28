/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Control Plots

Bode plots, step responses and pole-zero maps from transfer functions. Each block holds one \`name = value\` per line: systems and options.

\`\`\`bode
G1 = tf([1 2], [1 3 2])
G2 = 10*(s + 1)/(s^2 + 0.4*s + 4)
w = 0.01..1000
\`\`\`

Hover a plot to read exact values. Type three backticks and \`bo\`, \`st\` or \`pz\` to start a block from the suggestions.

## Systems

A system is any name that is not an option: \`G\`, \`C\`, \`L\`, \`T1\`. Write it either way:

- MATLAB style, \`tf(num, den)\`, with coefficient vectors highest power first, separated by spaces or commas: \`tf([1 2], [1 3 2])\` is (s + 2)/(s² + 3s + 2).
- As an expression in \`s\`, with \`+ - * /\`, \`^\` and a whole-number power, parentheses and numbers like \`0.5\` or \`1e-3\`. Writing things side by side multiplies them, and binds tighter than \`/\`: \`10/(s+1)(s+2)\` is 10 / ((s + 1)(s + 2)).

A system can use the ones defined above it, so loop shaping reads as it does on paper:

\`\`\`step
G = 1/(s(s+1))
C = 10(s+1)/(s+10)
L = C*G
T = L/(1+L)
show = T
\`\`\`

\`L/(1+L)\` gives the closed loop directly, as MATLAB's \`feedback(L, 1)\` does. Nothing else is cancelled, just as with MATLAB's \`tf\`. Up to six systems share a plot; \`show = …\` picks which ones to draw.

A line starting with \`#\` or \`%\` is a comment.

## Options

| Option | Blocks | Meaning |
|---|---|---|
| \`w = 0.01..1000\` | bode | Frequency range. Without it: two decades beyond the poles and zeros. |
| \`units = Hz\` | bode | Frequency in Hz instead of rad/s; \`w\` is then in Hz too. |
| \`margins = on\` | bode | Gain and phase margins, marked and written under the plot, as MATLAB's \`margin\` reports them. |
| \`t = 0..20\` | step | Time window. Without it: 6 / (the slowest stable pole's decay rate). |
| \`grid = off\` | all | Hides the gridlines. |
| \`title = …\` | all | A title above the plot. |

Options a block does not use are ignored, so a block can change type freely.

## Bode

Magnitude in dB and phase in degrees, sharing the frequency axis. The phase starts where MATLAB's \`bode\` starts it: a negative gain at 180°, 1/s² at −180°.

\`\`\`bode
L = 10/(s(s+1)(s+5))
margins = on
\`\`\`

## Step

The unit step response. Stable systems show their final value; an unstable or marginally stable system says so.

\`\`\`step
G1 = 4/(s^2 + 0.4s + 4)
G2 = 4/(s^2 + 2s + 4)
\`\`\`

## Pole-zero map

Poles are ×, zeros ○, on equal axes with the imaginary axis drawn. The poles and zeros are also listed under the plot.

\`\`\`pzmap
G = (s + 3)/((s + 1)(s^2 + 2s + 5))
\`\`\`

## Accuracy

The plugin's tests compare it with MATLAB's \`bode\`, \`step\`, \`pole\`, \`zero\` and \`margin\` on fourteen systems: magnitude within 0.01 dB, phase within 0.1°, step samples within 1e-4 and roots within 1e-6. The step response is exact for a step input (a zero-order hold through the matrix exponential).

Continuous time only.
`;
