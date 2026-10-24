/**
 * Text to Image (SPECS 13.2): renders ```combo blocks through data-only profiles. The
 * profile comes from the info string, then the note's `combo-profile`, then the default
 * in settings. Blocks re-render when settings or a profile's files change.
 */
import type {
  BlockHost,
  BlockInfo,
  BlockView,
  Disposable,
  Plugin,
  PluginContext,
  PluginFactory,
} from '@ephemeris-notes/plugin-api';
import { HELP } from './help';
import { ProfileManager } from './manager';
import { ProfileStore, type Summary } from './profiles';
import { renderNotice, renderRows, renderSource } from './render';
import { strings } from './strings';

const ID = 'text-to-image';
type Display = 'images' | 'text';

interface Mounted {
  el: HTMLElement;
  info: BlockInfo;
  signal: AbortSignal;
  /** Bumped per draw, so a slow profile load cannot overwrite a newer draw. */
  drawn: number;
}

class TextToImage implements Plugin {
  private ctx!: PluginContext;
  private store!: ProfileStore;
  private manager!: ProfileManager;
  private readonly mounted = new Set<Mounted>();
  private settingsReg: Disposable | null = null;
  private profileKey = '';
  private changeTimer: ReturnType<typeof setTimeout> | null = null;

  async onload(ctx: PluginContext): Promise<void> {
    this.ctx = ctx;
    this.store = new ProfileStore(ctx.storage.library);
    this.manager = new ProfileManager({
      store: this.store,
      reveal: (id) => ctx.ui.revealInFolder(`${this.store.root}/${id}`),
      changed: () => this.changed(),
      log: ctx.log,
    });
    this.registerSettings(await this.store.summaries());

    ctx.blocks.register('combo', {
      render: (el, info, host) => this.render(el, info, host),
    });
    ctx.help.register([{ id: 'guide', title: 'Text to Image guide', markdown: HELP }]);
    ctx.settings.onChange(() => this.redrawAll());
    // Profiles synced or edited outside the app.
    ctx.vault.watch(this.store.root, () => {
      if (this.changeTimer) clearTimeout(this.changeTimer);
      this.changeTimer = setTimeout(() => {
        this.changeTimer = null;
        void this.changed();
      }, 200);
    });
  }

  onunload(): void {
    if (this.changeTimer) clearTimeout(this.changeTimer);
    this.mounted.clear();
  }

  /** The default-profile options list the installed profiles, so it is re-registered when they change. */
  private registerSettings(profiles: Summary[]): void {
    this.profileKey = JSON.stringify(profiles.map((p) => [p.id, p.name]));
    this.settingsReg?.dispose();
    const st = strings.settings;
    this.settingsReg = this.ctx.settings.register({
      fields: [
        {
          key: 'defaultProfile',
          type: 'select',
          label: st.defaultProfile,
          default: '',
          options: [
            { value: '', label: st.none },
            ...profiles.filter((p) => !p.problem).map((p) => ({ value: p.id, label: p.name })),
          ],
        },
        {
          key: 'display',
          type: 'select',
          label: st.display,
          default: 'images',
          options: [
            { value: 'images', label: st.images },
            { value: 'text', label: st.notation },
          ],
        },
      ],
      pane: (el) => this.manager.mount(el),
    });
  }

  private async changed(): Promise<void> {
    this.store.invalidate();
    const profiles = await this.store.summaries();
    if (JSON.stringify(profiles.map((p) => [p.id, p.name])) !== this.profileKey)
      this.registerSettings(profiles);
    else this.manager.refresh();
    this.redrawAll();
  }

  private redrawAll(): void {
    for (const m of this.mounted) void this.draw(m);
  }

  private async render(el: HTMLElement, info: BlockInfo, host: BlockHost): Promise<BlockView> {
    const m: Mounted = { el, info, signal: host.signal, drawn: 0 };
    this.mounted.add(m);
    await this.draw(m);
    return {
      update: (next) => {
        m.info = next;
        void this.draw(m);
        return true;
      },
      dispose: () => {
        this.mounted.delete(m);
      },
    };
  }

  private profileFor(info: BlockInfo): string {
    const fromInfo = info.args.positional[0];
    if (fromInfo) return fromInfo;
    const fromNote = info.note.frontmatter['combo-profile'];
    if (typeof fromNote === 'string' && fromNote.trim()) return fromNote.trim();
    return this.ctx.settings.get<string>('defaultProfile') ?? '';
  }

  private async draw(m: Mounted): Promise<void> {
    const n = ++m.drawn;
    const { info } = m;
    const box = document.createElement('div');
    box.className = `${ID}-block`;
    const display = this.ctx.settings.get<Display>('display');
    const wanted = this.profileFor(info);
    if (display === 'text') renderSource(box, info.source);
    else if (!wanted) renderNotice(box, strings.notice.noProfile, info.source);
    else {
      const loaded = await this.store.get(wanted);
      if (n !== m.drawn || m.signal.aborted) return;
      if (loaded.status === 'missing') renderNotice(box, strings.notice.notFound(wanted), info.source);
      else if (loaded.status === 'invalid')
        renderNotice(box, strings.notice.invalid(wanted, loaded.problem), info.source);
      else {
        const { profile, matcher } = loaded;
        renderRows(box, matcher.rows(info.source), profile, {
          url: (path) => this.store.imageUrl(profile.id, path),
          mask: (path) => this.store.maskUrl(profile.id, path),
        });
      }
    }
    // The block's title="…" (SPECS 12.5): the outline's label, and the caption here.
    const title = info.args.named.title?.trim();
    if (title) {
      const caption = document.createElement('p');
      caption.className = 'vx-plugin-block__caption';
      caption.textContent = title;
      box.append(caption);
    }
    if (n === m.drawn && !m.signal.aborted) m.el.replaceChildren(box);
  }
}

const factory: PluginFactory = () => new TextToImage();
export default factory;
