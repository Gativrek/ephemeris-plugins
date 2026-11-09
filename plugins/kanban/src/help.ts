/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Kanban

Show a note as a board: columns of cards you move by dragging. The note stays plain Markdown, and you can keep editing it as text.

## A board note

Add \`kanban: true\` to the frontmatter. Headings are columns; the list items under each heading are its cards:

\`\`\`\`
---
kanban: true
---
## To do
- [ ] Record the intro take due:2026-11-20
- [ ] Draw the orbit diagram
  - from the M3 lecture notes

## Doing
- [ ] Edit the combo section #guide

## Done
- [x] Write the script
\`\`\`\`

- Lines indented under a card belong to it, and move with it ("+1 line" on the card).
- Cards can be task items (\`- [ ]\`, with a checkbox) or plain items (\`- text\`).
- \`due:\` dates show as chips, as in the Tasks plugin.
- Anything else in the note (a paragraph, a deeper heading) stays where it is and is not shown on the board.
- Boards made with Obsidian's Kanban plugin open too.

## Opening the board

**Open as Board**, from the command palette or the button at the end of the note, opens the board on the desk, beside the note.

## Working on the board

- **Move a card** by dragging it, or focus it and press **Alt+Arrow** keys: left and right between columns, up and down within one. The arrow keys alone move between cards.
- **Add a card** with **+ Add a card** at the foot of a column: type, then Enter (Escape cancels).
- **Tick a card** with its checkbox. Moving a card to Done does not tick it.
- **Edit a card or a column** in the note: click a card, or press Enter on it, to open the note at its line. Columns are the note's headings: rename, add or reorder them there.

Each change edits the note itself (Ctrl+Z in the note undoes it), moving the card's own lines and nothing else. The board follows the note as you edit it.
`;
