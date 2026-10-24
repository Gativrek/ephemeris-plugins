/**
 * The profile manager pane in Settings > Plugins (SPECS 13.2): list profiles, import a
 * profile folder, validate, reveal, and add the example profile. The pane is rebuilt
 * whenever the settings are re-registered, so its state (the last message, report and
 * pending replacement) lives here, not in the DOM.
 */
import { EXAMPLE_ID, exampleFiles } from './example';
import { ProfileStore, type IncomingFile, type Summary } from './profiles';
import { strings } from './strings';

const s = strings.manager;
const ID = 'text-to-image';

export interface ManagerHost {
  store: ProfileStore;
  reveal(id: string): void;
  /** After an install: clear caches, re-register settings, re-render blocks. */
  changed(): Promise<void>;
  log: { error(...a: unknown[]): void };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = `${ID}-${cls}`;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', 'button', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

interface Report {
  id: string;
  problems: string[];
}

export class ProfileManager {
  private message: string | null = null;
  private report: Report | null = null;
  private pending: { id: string; files: IncomingFile[] } | null = null;
  private redraw: (() => void) | null = null;

  constructor(private readonly host: ManagerHost) {}

  /** The `pane` passed to ctx.settings.register. */
  mount(root: HTMLElement): () => void {
    const pane = el('div', 'manager');
    root.append(pane);
    let alive = true;
    this.redraw = () => {
      void this.host.store.summaries().then((list) => {
        if (alive) this.draw(pane, list);
      });
    };
    this.redraw();
    return () => {
      alive = false;
      this.redraw = null;
    };
  }

  private say(message: string | null, report: Report | null = null): void {
    this.message = message;
    this.report = report;
    this.redraw?.();
  }

  private draw(pane: HTMLElement, list: Summary[]): void {
    pane.replaceChildren();
    pane.append(el('div', 'manager-title', s.title));
    if (!list.length) pane.append(el('p', 'manager-hint', s.empty));
    const rows = el('ul', 'profiles');
    for (const p of list) {
      const row = el('li', 'profile');
      row.dataset.profile = p.id;
      const text = el('div', 'profile-text');
      text.append(el('span', 'profile-name', p.name));
      text.append(el('span', 'profile-meta', p.problem ?? `${p.id} · ${s.tokens(p.tokens)}`));
      row.append(
        text,
        button(s.validate, () => void this.validate(p.id)),
        button(s.reveal, () => this.host.reveal(p.id)),
      );
      rows.append(row);
    }
    if (list.length) pane.append(rows);

    if (this.report) {
      const r = this.report;
      pane.append(
        el('p', 'manager-status', r.problems.length ? s.problemsIn(r.id, r.problems.length) : s.valid(r.id)),
      );
      if (r.problems.length) {
        const ul = el('ul', 'problems');
        for (const problem of r.problems) ul.append(el('li', 'problem', problem));
        pane.append(ul);
      }
    }

    if (this.pending) {
      const { id, files } = this.pending;
      const confirm = el('div', 'confirm');
      confirm.append(
        el('p', 'manager-status', s.confirmReplace(id)),
        button(s.replace, () => void this.install(id, files)),
        button(s.cancel, () => {
          this.pending = null;
          this.say(null);
        }),
      );
      pane.append(confirm);
    }

    const input = el('input', 'folder-input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.hidden = true;
    input.addEventListener('change', () => {
      const picked = [...(input.files ?? [])];
      input.value = '';
      void this.picked(picked);
    });
    const actions = el('div', 'actions');
    actions.append(
      input,
      button(s.import, () => input.click()),
      button(s.addExample, () => void this.addExample()),
    );
    pane.append(actions);
    if (this.message) pane.append(el('p', 'manager-status', this.message));
  }

  private async validate(id: string): Promise<void> {
    this.say(null, { id, problems: await this.host.store.validate(id) });
  }

  /** Files from a folder input: paths are relative to the chosen folder. */
  private async picked(files: File[]): Promise<void> {
    const incoming: IncomingFile[] = files
      .map((f) => ({ f, segs: (f.webkitRelativePath || f.name).split('/') }))
      .filter(({ segs }) => segs.length > 1)
      .map(({ f, segs }) => ({ path: segs.slice(1).join('/'), read: () => f.arrayBuffer() }));
    if (!incoming.length) return;
    try {
      const id = await ProfileStore.idOf(incoming);
      if ((await this.host.store.ids()).includes(id)) {
        this.pending = { id, files: incoming };
        this.say(null);
        return;
      }
      await this.install(id, incoming);
    } catch (err) {
      this.say(s.importFailed(err instanceof Error ? err.message : String(err)));
    }
  }

  private async install(id: string, files: IncomingFile[]): Promise<void> {
    this.pending = null;
    try {
      await this.host.store.install(id, files);
      await this.host.changed();
      this.say(s.imported(id), { id, problems: await this.host.store.validate(id) });
    } catch (err) {
      this.host.log.error('import failed', err);
      this.say(s.importFailed(err instanceof Error ? err.message : String(err)));
    }
  }

  private async addExample(): Promise<void> {
    if ((await this.host.store.ids()).includes(EXAMPLE_ID)) {
      this.say(s.exampleExists);
      return;
    }
    try {
      await this.host.store.install(EXAMPLE_ID, exampleFiles());
      await this.host.changed();
      this.say(s.exampleAdded);
    } catch (err) {
      this.host.log.error('adding the example failed', err);
      this.say(s.importFailed(err instanceof Error ? err.message : String(err)));
    }
  }

  /** Called when profiles change on disk. */
  refresh(): void {
    this.redraw?.();
  }
}
