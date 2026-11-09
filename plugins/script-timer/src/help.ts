/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Script timer

How long a narration script takes to read aloud: per heading in the outline, and in total at the end of the note.

## Turning it on

Add \`script: true\` to the note's frontmatter. Other notes are left alone.

\`\`\`\`
---
script: true
wpm: 160
---
\`\`\`\`

Each heading in the outline then shows its time, for everything under it until the next heading of the same or a higher level: a chapter shows its whole length, its sections their own. The end of the note shows the total: "Script: 1,234 words · 8:14 at 150 wpm". Times follow your typing.

## Speaking rate

**Speaking rate** in Settings > Plugins > Script timer is in words per minute, 150 by default (narration usually runs 140 to 160). A note's own \`wpm:\` wins over it, for a slower tutorial or a faster trailer.

## What counts as narration

Counted: the words of paragraphs and list items, links by the text they show, and numbers.

Not counted, because they are not read aloud:

- headings (titles of sections), frontmatter, tags and block IDs
- code blocks, math, tables, images and embeds
- comments: \`%% a note to self %%\` and \`<!-- … -->\`
- **block quotes, which hold directions**: \`> B-roll: the orbit animation\`, \`> Cut to the screen recording\`
`;
