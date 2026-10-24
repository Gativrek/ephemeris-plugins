/** The plugin's help page (SPECS 13.2), shown in Settings > Help under the plugin's name. */
export const HELP = `# Text to Image

Text to Image draws notation as images. Write the notation in a \`combo\` block and name a profile; the profile says which piece of text becomes which image.

\`\`\`combo numpad
5H > 2M > 236L
j.H > c.M xx 623H
\`\`\`

The blocks on this page use the **Numpad** example profile. If they show "Profile numpad not found", add it in Settings > Plugins > Text to Image > Add Example Profile.

## Choosing the profile

The plugin looks in this order and takes the first it finds:

1. The word after \`combo\` in the block's first line: \`\`\`\`combo numpad\`\`\`\`.
2. The note's \`combo-profile\` property, so a whole note can use one profile:

\`\`\`yaml
---
combo-profile: numpad
---
\`\`\`

3. The default profile in the plugin's settings.

Without any of these the block says "No profile selected" and shows the notation as text.

## How notation is read

- Each line is a row. Spaces split a row into chunks, drawn with a small gap between them.
- Each chunk is read from left to right, always taking the **longest** token that fits. With the tokens \`2\`, \`214\` and \`H\`, the chunk \`214H\` becomes \`214\` and \`H\`, never \`2\`, \`14\`, \`H\`.
- Aliases are other spellings of a token. In Numpad, \`qcf\` means \`236\`:

\`\`\`combo numpad
qcfL dpH hcbS
\`\`\`

- Text that matches no token stays as text, underlined with dots; hover it to see which profile it is missing from. It never breaks the block:

\`\`\`combo numpad
5H ?? 236L
\`\`\`

- Selecting part of a block and copying gives back the notation as you wrote it.

In Settings, **Display** switches every block between images and the notation as plain text.

## Profiles

A profile is a folder with a \`profile.json\` file and its images. Profiles are only data, so sharing one with a friend is safe. They live in the library, in \`.ephemeris/plugin-data/text-to-image/profiles/<id>/\`, and travel with your notes.

A minimal profile to copy:

\`\`\`json
{
  "schema": 1,
  "id": "mygame",
  "name": "My Game",
  "caseSensitive": true,
  "imageHeight": "1.4em",
  "tokens": {
    "236": { "image": "motions/236.png" },
    "5":   { "render": "none" },
    "L":   { "image": "buttons/l.png", "alt": "L" },
    ">":   { "text": "›" }
  },
  "aliases": { "qcf": "236" }
}
\`\`\`

- \`id\` is the folder's name: lowercase letters, digits, \`-\` and \`_\`.
- Each token has exactly one of \`image\` (a path inside the profile folder: png, jpg, webp, gif, avif or svg), \`text\` (shown as text) or \`"render": "none"\` (read but not drawn, like the neutral \`5\`).
- \`alt\` is what screen readers say; it defaults to the token itself.
- \`caseSensitive\`: when false, \`h\` and \`H\` are the same token.
- \`imageHeight\`: the height of the images, in \`em\`, \`rem\` or \`px\`.
- \`monochrome\`: when true, images are drawn in the text colour, so one-colour glyphs follow the light and dark themes. Leave it off for coloured art.

To install a profile, choose **Import Profile Folder…** in Settings > Plugins and pick the folder that holds \`profile.json\`. **Validate** lists anything wrong: invalid JSON, missing images, keys written twice, and aliases that point nowhere.

Use only images you have the right to use. Ephemeris and this plugin ship no game art.
`;
