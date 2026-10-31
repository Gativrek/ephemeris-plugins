/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Flashcards

Turn lines of your notes into flashcards, and review them on a schedule that adapts to how well you remember each one (FSRS, the scheduler Anki uses).

## Making cards

1. **Opt the note in.** Add \`flashcards: true\` to its frontmatter. Only notes that do this have cards, so a \`::\` elsewhere is never a card.

\`\`\`\`
---
flashcards: true
---
\`\`\`\`

2. **Write cards, one per line.** There are two kinds:

| Write | Card |
|---|---|
| \`What does the Kalman gain weigh? :: The prediction against the measurement\` | Front, then back. Spaces around \`::\` are needed. |
| \`The {{prediction}} step uses the {{process model}}.\` | One card per pair of braces: the sentence with that part hidden. |

Cards can be list items, and can hold math (\`$P_k$\`), links and images: the review shows them as the note does. Lines in code blocks and display math are never cards. In the note, a cloze shows as its text, marked; the braces come back when the cursor is on it.

## Reviewing

- **Review Due Cards (This Vault)**, from the command palette: every card due in the Vault of the note you have open.
- **Review Cards in This Note**: only that note's cards.

Give either a shortcut in Settings > Keyboard. The review opens on the desk, next to your notes, with what is due per note and section; click a note's name to review only that note.

For each card, read the front and recall the answer, press **Space** to see it, then grade how well you remembered:

| Key | Grade | Meaning |
|---|---|---|
| 1 | Again | You forgot. The card comes back in a few minutes. |
| 2 | Hard | You remembered, with difficulty. |
| 3 | Good | You remembered. |
| 4 | Easy | You remembered at once. |

Each button shows when you would see the card next with that grade.

## How cards keep their history

The first time you grade a card, its line gets an ID at the end, like \`^fc-a1b2c3\`. That is the only change Flashcards ever makes to a note, and only right after you grade. The ID ties the card to its review history, so you can reword a card, move it within the note or to another note, and it keeps its schedule. Delete the ID and the card starts over as new.

The schedule itself is kept outside the notes, in the Vault's \`.vault/plugin-data/flashcards/state.json\`, so reviewing never touches your notes or their history in git.

## Settings

- **New cards per day** (20 by default): how many cards you see for the first time each day. Cards already being learned are not limited.
- **Target retention** (90% by default): how likely you should be to remember a card when it comes up. Higher means shorter intervals and more reviews.
`;
