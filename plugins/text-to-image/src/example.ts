/**
 * The bundled example profile, Numpad (SPECS 13.2): original glyphs drawn on the design
 * system's 24px icon grid, buttons and separators as text. No game art. Written to the
 * library only when the user clicks Add Example Profile.
 */
import d1 from './example/directions/1.svg';
import d2 from './example/directions/2.svg';
import d3 from './example/directions/3.svg';
import d4 from './example/directions/4.svg';
import d6 from './example/directions/6.svg';
import d7 from './example/directions/7.svg';
import d8 from './example/directions/8.svg';
import d9 from './example/directions/9.svg';
import m214 from './example/motions/214.svg';
import m236 from './example/motions/236.svg';
import m41236 from './example/motions/41236.svg';
import m421 from './example/motions/421.svg';
import m623 from './example/motions/623.svg';
import m63214 from './example/motions/63214.svg';
import type { IncomingFile } from './profiles';

export const EXAMPLE_ID = 'numpad';

const images: Record<string, string> = {
  'directions/1.svg': d1,
  'directions/2.svg': d2,
  'directions/3.svg': d3,
  'directions/4.svg': d4,
  'directions/6.svg': d6,
  'directions/7.svg': d7,
  'directions/8.svg': d8,
  'directions/9.svg': d9,
  'motions/236.svg': m236,
  'motions/214.svg': m214,
  'motions/623.svg': m623,
  'motions/421.svg': m421,
  'motions/41236.svg': m41236,
  'motions/63214.svg': m63214,
};

const tokens: Record<string, unknown> = {};
for (const path of Object.keys(images)) tokens[path.replace(/^.*\/|\.svg$/g, '')] = { image: path };
tokens['5'] = { render: 'none' };
for (const b of ['L', 'M', 'H', 'S', 'U']) tokens[b] = { text: b };
Object.assign(tokens, {
  '>': { text: '›' },
  ',': { text: ',' },
  xx: { text: 'xx' },
  '~': { text: '~' },
  'j.': { text: 'j.' },
  'c.': { text: 'c.' },
  'f.': { text: 'f.' },
  '(': { text: '(' },
  ')': { text: ')' },
  '[': { text: '[' },
  ']': { text: ']' },
});

export const EXAMPLE_PROFILE = {
  schema: 1,
  id: EXAMPLE_ID,
  name: 'Numpad',
  caseSensitive: true,
  imageHeight: '1.4em',
  monochrome: true,
  tokens,
  aliases: { qcf: '236', qcb: '214', dp: '623', rdp: '421', hcf: '41236', hcb: '63214' },
};

export function exampleFiles(): IncomingFile[] {
  const enc = new TextEncoder();
  const file = (path: string, text: string): IncomingFile => ({
    path,
    read: async () => enc.encode(text).buffer as ArrayBuffer,
  });
  return [
    file('profile.json', `${JSON.stringify(EXAMPLE_PROFILE, null, 2)}\n`),
    ...Object.entries(images).map(([path, svg]) => file(path, svg)),
  ];
}
