/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Tasks

Keep tasks in any note, give them due dates, and list them across your notes.

## Writing tasks

A task is a list item with a checkbox, as you already write them. Add a due date with \`due:\` and the date as year-month-day:

\`\`\`\`
- [ ] Send the quarterly report due:2026-11-14 #work
- [ ] Book the dentist
- [x] Renew the passport
\`\`\`\`

- The due date shows as a chip: the date, **Today**, or **Overdue**. Put the cursor on it to edit it.
- Tags (\`#work\`) work as everywhere else in Ephemeris; use one such as \`#urgent\` for priority.
- Tick a task in the note by clicking its box, or with **Toggle Task** (Ctrl+Shift+X).
- Tasks inside code blocks and display math are not tasks.

## Listing tasks

A \`tasks\` block lists tasks from across your notes. Empty, it shows the open tasks of this Vault, the earliest due first:

\`\`\`\`
\`\`\`tasks
\`\`\`
\`\`\`\`

Add one \`key: value\` per line to choose what it lists:

| Key | Values | Default |
|---|---|---|
| \`scope\` | \`vault\`, \`domain\` or \`all\` (every Vault) | \`vault\` |
| \`status\` | \`open\`, \`done\` or \`all\` | \`open\` |
| \`due\` | \`overdue\`, \`today\`, \`week\` (today and the next 6 days), \`none\` (no date), \`any\`, \`before 2026-12-01\`, \`after 2026-12-01\` | \`any\` |
| \`tag\` | a tag such as \`#work\`; \`#work\` also lists \`#work/acme\` | |
| \`path\` | a folder, such as \`Projects\` or \`Work/Acme/Projects\` | |
| \`sort\` | \`due\` (dated first, earliest first) or \`note\` (in note order) | \`due\` |
| \`group\` | \`note\` (a heading per note) or \`none\` | \`none\` |
| \`limit\` | how many to show; the rest are counted below | \`200\` |

For example, what is due this week at work, grouped by note:

\`\`\`\`
\`\`\`tasks
scope: domain
due: week
tag: #work
group: note
\`\`\`
\`\`\`\`

A line the block does not understand is named above the list; the other lines still apply.

## Ticking from the list

Click a task's box in the list to tick it: the plugin writes \`[x]\` into the task's own note, as if you had ticked it there (Ctrl+Z in that note undoes it). If the note changed meanwhile, it checks the task is still there first. Click a task's note name to open the note at that task.

## The Tasks view

**Show Open Tasks (This Vault)** and **Show Open Tasks (All Vaults)**, from the command palette, open a list on the desk with its filters as controls, so you need no note to see your tasks. Give either a shortcut in Settings > Keyboard.
`;
