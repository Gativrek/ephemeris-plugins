/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Graph view

See your notes as dots and their links as lines: clusters, the notes many others link to, and the ones nothing links to. Backlinks in the outline are still the quickest way between notes; the graph shows the shape of a Vault.

## Opening it

- **Open Graph**, from the command palette: the graph of the Vault you are in. **Scope** switches to its Domain or to all notes.
- **Open Local Graph**: the note you have open and the notes one or two links away (**Depth**). **Centre on Last Note** moves it to the note you last had open.

Give either a shortcut in Settings > Keyboard.

## Reading it

- Dots are coloured by Domain and grow with the number of notes that link to them. The note you opened the graph from has a ring.
- Faded dots are notes outside the scope that notes in it link to.
- Links to headings and blocks count as links to their note. Links that lead nowhere, or that could mean more than one note, are not drawn.
- **Notes without links** shows or hides notes nothing links to and that link nowhere. **Attachments** adds the PDFs and images notes link to, as rings.

## Moving around

- Drag the background to pan, and scroll to zoom. Names show once you zoom in, and for the dot under the pointer and its neighbours.
- Hover a dot to light it and its links; click it to open the note. Drag a dot to move it.
- **Find a note** lights the notes whose names match; Enter opens the first.
- With the graph focused: arrow keys pan, \`+\` and \`-\` zoom, \`0\` fits it to the view.

The layout is remembered for each scope, so the graph opens as you left it. It follows your links as you write.
`;
