/** Every string the plugin shows, in English (sentence case; Title Case for buttons and titles). */
export const strings = {
  notice: {
    noProfile: 'No profile selected',
    notFound: (id: string) => `Profile ${id} not found`,
    invalid: (id: string, problem: string) => `Profile ${id} is invalid: ${problem}`,
  },
  unknown: (id: string) => `Not in profile ${id}`,
  missingImage: (path: string) => `Image not found: ${path}`,

  problems: {
    notJson: (message: string) => `profile.json is not valid JSON (${message}).`,
    missingFile: 'profile.json is missing.',
    notObject: 'profile.json must hold an object.',
    schema: '"schema" must be 1.',
    id: 'The "id" must match ^[a-z0-9][a-z0-9_-]{0,63}$.',
    idMismatch: (id: string, folder: string) => `The id "${id}" does not match its folder "${folder}".`,
    name: '"name" must be a string.',
    caseSensitive: '"caseSensitive" must be true or false.',
    monochrome: '"monochrome" must be true or false.',
    imageHeight: (v: string) => `"imageHeight" ${v} is not a length in em, rem or px; using 1.4em.`,
    tokens: '"tokens" must be an object.',
    aliases: '"aliases" must be an object.',
    emptyKey: 'A token key is empty.',
    spaceKey: (key: string) =>
      `Token "${key}" contains a space; notation is split on spaces, so it never matches.`,
    entry: (key: string) => `Token "${key}" needs exactly one of "image", "text" or "render": "none".`,
    render: (key: string) => `Token "${key}": "render" can only be "none".`,
    alt: (key: string) => `Token "${key}": "alt" must be a string.`,
    imagePath: (key: string, path: string) =>
      `Token "${key}": image "${path}" must be a png, jpg, webp, gif, avif or svg path inside the profile folder.`,
    missingImage: (key: string, path: string) => `Token "${key}": image "${path}" is missing.`,
    duplicate: (path: string) => `"${path}" appears twice; only the last one counts.`,
    sameKey: (a: string, b: string) => `"${a}" and "${b}" are the same key when "caseSensitive" is false.`,
    aliasTarget: (alias: string, target: string) =>
      `Alias "${alias}" points to "${target}", which is not a token.`,
    aliasIsToken: (alias: string) => `Alias "${alias}" is also a token key.`,
  },

  settings: {
    defaultProfile: 'Default profile',
    none: 'None',
    display: 'Display',
    images: 'Images',
    notation: 'Notation text',
  },

  manager: {
    title: 'Profiles',
    empty: 'No profiles yet. Import a profile folder, or add the example profile to try the plugin.',
    tokens: (n: number) => (n === 1 ? '1 token' : `${n} tokens`),
    import: 'Import Profile Folder…',
    addExample: 'Add Example Profile',
    validate: 'Validate',
    reveal: 'Show in File Manager',
    replace: 'Replace',
    cancel: 'Cancel',
    confirmReplace: (id: string) =>
      `A profile named ${id} is already installed. Replace it? The old folder goes to the trash.`,
    imported: (id: string) => `Imported ${id}.`,
    exampleAdded: 'Added the Numpad example profile.',
    exampleExists: 'The Numpad example profile is already installed.',
    noProfileJson: 'The chosen folder has no profile.json at its top level.',
    importFailed: (message: string) => `Import failed: ${message}`,
    valid: (id: string) => `${id}: no problems found.`,
    problemsIn: (id: string, n: number) => `${id}: ${n === 1 ? '1 problem' : `${n} problems`}.`,
  },
};
