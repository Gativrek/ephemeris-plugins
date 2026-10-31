/** The plugin's help page, in Settings > Help under the plugin's name. */
export const HELP = `# Citations

Cite references from your reference manager with Pandoc's syntax, and get them formatted in IEEE or ABNT, with a reference list where you want it.

## Getting started

1. **Export your library.** In Zotero with Better BibTeX: right-click the library or a collection, **Export…**, choose **Better BibTeX** (or **Better CSL JSON**), tick **Keep updated**, and save it inside your library folder, for example \`References/library.bib\`. Zotero then rewrites the file whenever you change a reference, and the notes follow.
2. **Point the plugin at it.** In **Settings > Plugins > Citations**, choose the file as **Library**, and pick a **Citation style**.
3. **Cite.** Write \`[@groves2013]\` in a note, using the citation key from Zotero (Better BibTeX shows it at the top of each item). It turns into \`[1]\` (IEEE) or \`(Groves, 2013)\` (ABNT) when the cursor leaves it. Hover over it to see the reference.
4. **List the references.** Where the list goes, usually at the end, add a \`bibliography\` block: type three backticks and \`bib\`, and pick **bibliography** (or press \`Ctrl+Shift+C\`).

\`\`\`\`
## References

\`\`\`bibliography
\`\`\`
\`\`\`\`

## Writing citations

| Write | IEEE | ABNT |
|---|---|---|
| \`[@groves2013]\` | [1] | (Groves, 2013) |
| \`[@groves2013, p. 45]\` | [1, p. 45] | (Groves, 2013, p. 45) |
| \`[@groves2013; @kalman1960]\` | [1], [2] | (Groves, 2013; Kalman, 1960) |
| \`[see @groves2013, ch. 3]\` | [see 1, Ch. 3] | (see Groves, 2013, cap. 3) |
| \`@groves2013 says\` | Groves [1] says | Groves (2013) says |
| \`[-@groves2013]\` | [1] | (2013) |

- **Locators** follow a comma: \`p.\`, \`pp.\`, \`ch.\`, \`sec.\` (or \`§\`), \`fig.\`, \`vol.\`, \`para.\`, \`l.\` (line), \`n.\` (note), \`col.\`. A bare number is a page: \`[@groves2013, 45]\`.
- **Prefixes and suffixes:** text before the \`@\` is a prefix (\`[see @a]\`), and text after the locator is a suffix (\`[@a, p. 3, emphasis added]\`).
- **\`-@key\`** leaves the author out, for when the sentence already names them.
- **Keys** are letters, digits and \`_\`, with \`:\` \`.\` \`-\` \`/\` and similar inside, as Better BibTeX makes them.
- **Not citations:** \`@eq:\`, \`@fig:\` and \`@tbl:\` are equation and figure references, never citations. An e-mail address is never a citation either.
- **Unknown keys:** a bracketed citation of a key that is not in the library shows dashed, like a missing link. A plain \`@word\` that is not a key stays text.

IEEE numbers references in the order the note first cites them, and the numbers follow as you edit. ABNT lists references alphabetically by author.

## More than one library

Add other files under **More libraries** in Settings, or give a note its own, in its frontmatter, as Pandoc does:

\`\`\`\`
---
bibliography: thesis-refs.bib
---
\`\`\`\`

A path is relative to the note's folder, or to the Vault's root when it starts with \`/\`. A note can cite from the Settings libraries and its own; when both have a key, the note's entry wins.

## The reference card

Hovering a citation shows each reference: its authors, title, where it was published, the year, a link to its DOI or URL, and the notes in this Vault that cite it.

## Styles and languages

- **IEEE:** numbered, in English by default.
- **ABNT** (NBR 6023 and 10520, author and year): in Portuguese by default.
- **Language:** **Language** in Settings changes it for either style; this affects words like "et al.", "p." and "Disponível em".

The styles are the Citation Style Language's own (\`ieee.csl\` and \`associacao-brasileira-de-normas-tecnicas.csl\`), formatted by citeproc-js, the engine Zotero uses.
`;
