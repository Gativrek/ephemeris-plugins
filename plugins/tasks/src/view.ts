/**
 * The Tasks view (SPECS 13.7): the query block's list on the desk, with its filters as
 * controls. Its state (the filters) is saved with the desk.
 */
import type { Domain, PluginContext, ViewHost } from '@ephemeris-notes/plugin-api';
import { el, mountList } from './list';
import { DEFAULT_QUERY, type Scope, type Status } from './query';

type DueKind = 'any' | 'overdue' | 'today' | 'week' | 'none';

export interface TasksViewState {
  vaultPath: string | null;
  domain: Domain | null;
  scope: Scope;
  status: Status;
  due: DueKind;
  tag: string;
}

export function viewTitle(state: TasksViewState): string {
  if (state.scope === 'vault' && state.vaultPath) return `Tasks: ${state.vaultPath.split('/').pop()}`;
  if (state.scope === 'domain' && state.domain)
    return `Tasks: ${state.domain[0]!.toUpperCase()}${state.domain.slice(1)}`;
  return 'Tasks: All Vaults';
}

/** A saved state from an older version, or none, gets the defaults. */
export function normalize(raw: unknown): TasksViewState {
  const s = (raw ?? {}) as Partial<TasksViewState>;
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  return {
    vaultPath: typeof s.vaultPath === 'string' ? s.vaultPath : null,
    domain: one<Domain | ''>(s.domain, ['academic', 'work', 'personal'], '') || null,
    scope: one<Scope>(s.scope, ['vault', 'domain', 'all'], 'vault'),
    status: one<Status>(s.status, ['open', 'done', 'all'], 'open'),
    due: one<DueKind>(s.due, ['any', 'overdue', 'today', 'week', 'none'], 'any'),
    tag: typeof s.tag === 'string' ? s.tag : '',
  };
}

export function renderTasksView(ctx: PluginContext, root: HTMLElement, raw: unknown, host: ViewHost): void {
  let state = normalize(raw);
  const page = el('div', 'view');
  root.append(page);
  const title = el('h2', 'title', viewTitle(state));
  const controls = el('div', 'controls');
  const listHost = el('div', 'view-list');
  page.append(title, controls, listHost);

  const select = <T extends string>(
    label: string,
    value: T,
    options: Array<[T, string, boolean?]>,
    set: (v: T) => void,
  ) => {
    const wrap = el('label', 'control');
    wrap.append(el('span', 'control-label', label));
    const s = document.createElement('select');
    for (const [v, text, disabled] of options) {
      const o = new Option(text, v, false, v === value);
      o.disabled = disabled ?? false;
      s.append(o);
    }
    s.addEventListener('change', () => set(s.value as T));
    wrap.append(s);
    controls.append(wrap);
  };
  select<Scope>(
    'Scope',
    state.scope,
    [
      ['vault', 'This Vault', !state.vaultPath],
      ['domain', 'This Domain', !state.domain],
      ['all', 'All Vaults'],
    ],
    (scope) => change({ scope }),
  );
  select<Status>(
    'Show',
    state.status,
    [
      ['open', 'Open'],
      ['done', 'Done'],
      ['all', 'All'],
    ],
    (status) => change({ status }),
  );
  select<DueKind>(
    'Due',
    state.due,
    [
      ['any', 'Any time'],
      ['overdue', 'Overdue'],
      ['today', 'Today'],
      ['week', 'Next 7 days'],
      ['none', 'No date'],
    ],
    (due) => change({ due }),
  );
  const tagWrap = el('label', 'control');
  tagWrap.append(el('span', 'control-label', 'Tag'));
  const tag = document.createElement('input');
  tag.type = 'text';
  tag.placeholder = '#tag';
  tag.value = state.tag;
  tag.addEventListener('change', () => change({ tag: tag.value.trim() }));
  tagWrap.append(tag);
  controls.append(tagWrap);

  let list: AbortController | null = null;
  const show = () => {
    list?.abort();
    list = new AbortController();
    host.signal.addEventListener('abort', () => list?.abort(), { once: true });
    listHost.replaceChildren();
    const t = state.tag.replace(/^#/, '').toLowerCase();
    mountList(ctx, listHost, {
      query: {
        ...DEFAULT_QUERY,
        scope: state.scope,
        status: state.status,
        due: { kind: state.due },
        tag: /^[\p{L}\p{N}_/-]+$/u.test(t) ? t : null,
        limit: 1000,
      },
      from: { path: '', vaultPath: state.vaultPath, domain: state.domain },
      readOnly: false,
      signal: list.signal,
    });
  };

  const change = (next: Partial<TasksViewState>) => {
    state = { ...state, ...next };
    host.saveState(state);
    title.textContent = viewTitle(state);
    host.setTitle(viewTitle(state));
    show();
  };
  show();
}
