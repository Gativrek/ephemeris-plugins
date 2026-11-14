/**
 * The ```clip player (SPECS 13.8): a video held inside its segment, looping or pausing at
 * the end, with Set Start and Set End writing the block.
 */
import type { BlockHost, BlockInfo, BlockView, PluginContext } from '@ephemeris-notes/plugin-api';
import { formatLength, formatTime, parseClip, withKey, type ClipSpec } from './clip';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls
    .split(' ')
    .map((c) => `clip-${c}`)
    .join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A path relative to `dir`, with `.` and `..` applied; null when it leaves the library. */
function join(dir: string, rel: string): string | null {
  const out = dir ? dir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/** The library path of the clip's file: a link by the core rules; a path from the note's folder, then the root. */
async function locate(ctx: PluginContext, clip: ClipSpec, notePath: string): Promise<string | null> {
  const file = clip.file!;
  const dir = notePath.split('/').slice(0, -1).join('/');
  const candidates = clip.link
    ? [ctx.vault.resolve(file, notePath)]
    : [join(dir, file), join('', file), ctx.vault.resolve(file, notePath)];
  for (const c of candidates) if (c && (await ctx.vault.exists(c).catch(() => false))) return c;
  return null;
}

export function renderClip(
  ctx: PluginContext,
  root: HTMLElement,
  block: BlockInfo,
  host: BlockHost,
): BlockView {
  let { clip, problems } = parseClip(block.source);
  let version = block.version;
  let source = block.source;
  const box = el('div', 'box');
  root.append(box);
  const showProblems = (list: string[]) => {
    box.querySelectorAll('.clip-problem').forEach((p) => p.remove());
    box.prepend(...list.map((p) => el('p', 'problem', p)));
  };
  showProblems(problems);
  if (!clip.file || problems.some((p) => p.startsWith('"end"'))) return { update: () => false };

  const video = el('video', 'video');
  video.controls = true;
  video.preload = 'metadata';
  video.playsInline = true;
  video.muted = clip.muted;
  const caption = el('p', 'caption');
  const status = el('span', 'status');
  box.append(video, caption);

  let duration: number | null = null;
  let name = clip.file.split('/').pop()!;
  const end = () => clip.end ?? duration;
  const setCaption = () => {
    const e = end();
    caption.textContent =
      e === null
        ? `${name} · from ${formatTime(clip.start)}`
        : `${name} · ${formatTime(clip.start)} → ${formatTime(e)} (${formatLength(e - clip.start)})`;
  };
  setCaption();

  // ---- Playback inside the segment -----------------------------------------------------
  let frame = 0;
  const watch = () => {
    cancelAnimationFrame(frame);
    if (video.paused) return;
    const e = clip.end;
    if (e !== null && video.currentTime >= e) {
      if (clip.loop) video.currentTime = clip.start;
      else {
        video.pause();
        video.currentTime = e;
      }
    }
    frame = requestAnimationFrame(watch);
  };
  video.addEventListener('play', () => {
    // Play from the start again once the end was reached.
    const e = end();
    if (e !== null && video.currentTime >= e - 0.05) video.currentTime = clip.start;
    frame = requestAnimationFrame(watch);
  });
  video.addEventListener('pause', () => cancelAnimationFrame(frame));
  video.addEventListener('seeking', () => {
    const e = clip.end;
    if (video.currentTime < clip.start - 0.01) video.currentTime = clip.start;
    else if (e !== null && video.currentTime > e + 0.01) video.currentTime = e;
  });
  // Without `end`, the video's own end: loop from the start.
  video.addEventListener('ended', () => {
    if (!clip.loop) return;
    video.currentTime = clip.start;
    void video.play();
  });
  video.addEventListener('loadedmetadata', () => {
    duration = Number.isFinite(video.duration) ? video.duration : null;
    // Never wider than the video itself: a small clip stays sharp instead of stretched.
    if (video.videoWidth) video.style.maxWidth = `${video.videoWidth}px`;
    if (video.currentTime < clip.start) video.currentTime = clip.start;
    setCaption();
  });
  video.addEventListener('error', () => {
    const code = video.error?.code;
    const message =
      code === 3 || code === 4
        ? `Ephemeris plays MP4 (H.264) and WebM video; ${name} is in a format it cannot play.`
        : `${name} could not be played.`;
    showProblems([...problems, message]);
    noPlayer();
  });

  // ---- Set Start and Set End -------------------------------------------------------------
  if (!host.readOnly) {
    const bar = el('div', 'bar');
    const set = (key: 'start' | 'end') => {
      const b = el('button', 'button', key === 'start' ? 'Set Start' : 'Set End');
      b.type = 'button';
      b.title = key === 'start' ? 'Start the clip here' : 'End the clip here';
      b.addEventListener('click', async () => {
        const t = Math.round(video.currentTime * 100) / 100;
        if (key === 'start' && clip.end !== null && t >= clip.end)
          return say('The start must come before the end.');
        if (key === 'end' && t <= clip.start) return say('The end must come after the start.');
        const ok = await host.updateSource(withKey(source, key, formatTime(t, 2)), {
          expectedVersion: version,
        });
        say(ok ? '' : 'The note changed: try again.');
      });
      return b;
    };
    bar.append(set('start'), set('end'), status);
    box.append(bar);
  }
  function say(text: string) {
    status.textContent = text;
  }
  /** No video to play: the problem says why; no empty player or buttons under it. */
  function noPlayer() {
    video.hidden = true;
    box.querySelector('.clip-bar')?.toggleAttribute('hidden', true);
  }

  void locate(ctx, clip, block.note.path).then((path) => {
    if (host.signal.aborted) return;
    if (!path) {
      showProblems([...problems, `No video at ${clip.file}.`]);
      return noPlayer();
    }
    name = path.split('/').pop()!;
    setCaption();
    // The fragment shows the first frame of the clip before it plays.
    video.src = `${ctx.vault.assetUrl(path)}#t=${clip.start}`;
  });
  host.signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame);
    video.pause();
    video.removeAttribute('src');
    video.load();
  });

  return {
    update(next) {
      const parsed = parseClip(next.source);
      // A new file, or a block that no longer plays: draw it again.
      if (parsed.clip.file !== clip.file || parsed.clip.link !== clip.link || parsed.problems.length)
        return false;
      ({ clip, problems } = parsed);
      version = next.version;
      source = next.source;
      video.muted = clip.muted;
      showProblems(problems);
      setCaption();
      if (video.currentTime < clip.start || (clip.end !== null && video.currentTime > clip.end))
        video.currentTime = clip.start;
      return true;
    },
  };
}
