import { describe, expect, it } from 'vitest';
import type { CslItem } from './bib';
import { rowOf, search } from './picker';

const items: CslItem[] = [
  {
    id: 'groves2013',
    type: 'book',
    title: 'Principles of GNSS',
    author: [{ family: 'Groves', given: 'Paul' }],
    issued: { 'date-parts': [[2013]] },
  },
  {
    id: 'kalman1960',
    type: 'article-journal',
    title: 'A new approach to linear filtering',
    author: [{ family: 'Kálmán', given: 'Rudolf' }],
    issued: { 'date-parts': [[1960]] },
  },
  {
    id: 'silva2020',
    type: 'paper-conference',
    title: 'Filtro de Kalman para GNSS',
    author: [{ family: 'Silva' }],
    issued: { 'date-parts': [[2020]] },
  },
];
const rows = items.map(rowOf);
const ids = (q: string) => search(rows, q).map((r) => r.item.id);

describe('searching references', () => {
  it('matches every word against key, authors, title and year, ignoring accents', () => {
    expect(ids('kalman')).toEqual(['kalman1960', 'silva2020']);
    expect(ids('gnss 2013')).toEqual(['groves2013']);
    expect(ids('filtering kalman')).toEqual(['kalman1960']);
    expect(ids('nothing here')).toEqual([]);
  });

  it('puts key matches first, then newer references', () => {
    expect(ids('')).toEqual(['silva2020', 'groves2013', 'kalman1960']);
    expect(ids('silva')[0]).toBe('silva2020');
  });
});
