import { describe, expect, it } from 'vitest';
import { parseLibrary, type CslItem } from './bib';
import { keysInOrder, parseCitation } from './cite';
import { authorsInText, Formatter } from './format';

const BIB = String.raw`
@book{groves2013,
  author = {Groves, Paul D.},
  title = {Principles of {GNSS}, Inertial, and Multisensor Integrated Navigation Systems},
  edition = {2},
  publisher = {Artech House},
  address = {Boston},
  year = {2013},
}
@article{kalman1960,
  author = {Kalman, Rudolf E.},
  title = {A New Approach to Linear Filtering and Prediction Problems},
  journal = {Journal of Basic Engineering},
  volume = {82},
  number = {1},
  pages = {35--45},
  year = {1960},
  doi = {10.1115/1.3662552},
}
@inproceedings{silva2020,
  author = {Silva, Ana and Souza, Bruno and Lima, Carla},
  title = {Filtro de {Kalman} para {GNSS}},
  booktitle = {Anais do Simpósio Brasileiro de Telecomunicações},
  year = {2020},
  month = mar,
}
`;

async function library(): Promise<Map<string, CslItem>> {
  const { items, errors } = await parseLibrary('refs.bib', BIB);
  expect(errors).toEqual([]);
  return new Map(items.map((i) => [i.id, i]));
}

describe('reading BibTeX', () => {
  it('maps entries to CSL-JSON', async () => {
    const lib = await library();
    expect(lib.get('kalman1960')).toMatchObject({
      type: 'article-journal',
      author: [{ family: 'Kalman', given: 'Rudolf E.' }],
      'container-title': 'Journal of Basic Engineering',
      issued: { 'date-parts': [[1960]] },
      page: '35–45',
      DOI: '10.1115/1.3662552',
    });
    expect(lib.get('groves2013')).toMatchObject({
      type: 'book',
      publisher: 'Artech House',
      'publisher-place': 'Boston',
    });
    expect(lib.get('silva2020')).toMatchObject({
      type: 'paper-conference',
      issued: { 'date-parts': [[2020, 3]] },
    });
  });
});

describe('IEEE', () => {
  it('numbers references in the order the note first cites them', async () => {
    const f = new Formatter('ieee', 'auto', await library());
    f.setOrder(keysInOrder('As [@kalman1960] showed, and [@groves2013, p. 45] explains, [@kalman1960].'));
    expect(f.citation(parseCitation('[@kalman1960]')!)).toBe('[1]');
    expect(f.citation(parseCitation('[@groves2013, p. 45]')!)).toBe('[2, p. 45]');
    expect(f.citation(parseCitation('[@kalman1960; @groves2013]')!)).toBe('[1], [2]');
    expect(f.citation(parseCitation('@groves2013')!)).toBe('Groves [2]');
    const bib = f.bibliography();
    expect(bib).toHaveLength(2);
    expect(bib[0]).toContain('Kalman');
    expect(bib[0]).toContain('35–45');
    expect(bib[1]).toContain('Artech House');
  });

  it('leaves unknown keys out', async () => {
    const f = new Formatter('ieee', 'auto', await library());
    expect(f.citation(parseCitation('[@nobody]')!)).toBe('');
    expect(f.has('nobody')).toBe(false);
  });
});

describe('ABNT', () => {
  it('cites by author and date, in Portuguese, and sorts the list by author', async () => {
    const f = new Formatter('abnt', 'auto', await library());
    f.setOrder(['silva2020', 'groves2013']);
    // NBR 10520:2023 writes authors in citations in mixed case.
    expect(f.citation(parseCitation('[@groves2013]')!)).toBe('(Groves, 2013)');
    expect(f.citation(parseCitation('[@silva2020, p. 12]')!)).toBe('(Silva; Souza; Lima, 2020, p. 12)');
    expect(f.citation(parseCitation('@groves2013')!)).toBe('Groves (2013)');
    expect(f.citation(parseCitation('[see @groves2013, ch. 3]')!)).toBe('(see Groves, 2013, cap. 3)');
    expect(f.citation(parseCitation('[-@groves2013]')!)).toBe('(2013)');
    const bib = f.bibliography();
    expect(bib[0]).toContain('GROVES, Paul D. <b>Principles of GNSS');
    expect(bib[1]).toContain('SILVA, Ana; SOUZA, Bruno; LIMA, Carla');
    // The proceedings stand in for the event, printed once, capitals kept.
    expect(bib[1]).toContain('In</i>: ANAIS DO SIMPÓSIO BRASILEIRO DE TELECOMUNICAÇÕES');
    expect(bib[1]!.match(/Anais do Simpósio/gi)).toHaveLength(1);
  });

  it('names authors in running text', async () => {
    const lib = await library();
    expect(authorsInText(lib.get('silva2020')!, 'pt-BR')).toBe('Silva et al.');
    expect(
      authorsInText({ id: 'x', type: 'book', author: [{ family: 'A' }, { family: 'B' }] }, 'pt-BR'),
    ).toBe('A e B');
  });
});
