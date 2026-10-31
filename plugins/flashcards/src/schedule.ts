/**
 * Scheduling with FSRS (ts-fsrs), SPECS 13.6. Card state lives outside the notes, in the
 * Vault's plugin storage (`state.json`), keyed by card key. Grades are Again, Hard, Good
 * and Easy (keys 1–4).
 */
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { CardDef } from './cards';

export const GRADES: Array<{ grade: Grade; label: string; key: string }> = [
  { grade: Rating.Again, label: 'Again', key: '1' },
  { grade: Rating.Hard, label: 'Hard', key: '2' },
  { grade: Rating.Good, label: 'Good', key: '3' },
  { grade: Rating.Easy, label: 'Easy', key: '4' },
];

/** A card's FSRS state as JSON: dates as ISO strings. */
export type Saved = Omit<Card, 'due' | 'last_review'> & { due: string; last_review?: string };

export interface VaultState {
  version: 1;
  cards: Record<string, Saved>;
  /** New cards started on a day, for the daily limit. */
  newDay: { date: string; count: number };
}

export const emptyState = (): VaultState => ({ version: 1, cards: {}, newDay: { date: '', count: 0 } });

export const save = ({ due, last_review, ...rest }: Card): Saved => ({
  ...rest,
  due: due.toISOString(),
  ...(last_review ? { last_review: last_review.toISOString() } : {}),
});
export const load = ({ due, last_review, ...rest }: Saved): Card => ({
  ...rest,
  due: new Date(due),
  ...(last_review ? { last_review: new Date(last_review) } : {}),
});

/** "1 min", "10 min", "3 h", "4 d", "2 mo", "1.5 y": a next interval, for the grade buttons. */
export function intervalLabel(from: Date, to: Date): string {
  const min = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)} d`;
  if (d < 365) return `${Math.round(d / 30)} mo`;
  return `${Number((d / 365).toFixed(1))} y`;
}

export const dayOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export class Scheduler {
  private readonly f;

  constructor(retention = 0.9) {
    this.f = fsrs({ request_retention: retention, enable_fuzz: true });
  }

  /** The state after a grade. */
  grade(saved: Saved | undefined, grade: Grade, now: Date): Saved {
    const card = saved ? load(saved) : createEmptyCard(now);
    return save(this.f.next(card, now, grade).card);
  }

  /** The next interval for each grade, as labels. */
  preview(saved: Saved | undefined, now: Date): Record<Grade, string> {
    const card = saved ? load(saved) : createEmptyCard(now);
    const r = this.f.repeat(card, now);
    const out = {} as Record<Grade, string>;
    for (const { grade } of GRADES) out[grade] = intervalLabel(now, r[grade].card.due);
    return out;
  }
}

export interface Due {
  /** Cards seen before and due now, soonest first. */
  review: CardDef[];
  /** Cards never reviewed, in note order, up to today's limit. */
  fresh: CardDef[];
  /** New cards beyond today's limit. */
  heldBack: number;
  /** When the next card not due now comes due. */
  next: Date | null;
}

/** What to review now. A card's state is found by its key; cards without one are new. */
export function dueCards(cards: CardDef[], state: VaultState, now: Date, newPerDay: number): Due {
  const review: Array<{ card: CardDef; due: Date }> = [];
  const fresh: CardDef[] = [];
  let next: Date | null = null;
  for (const card of cards) {
    const s = state.cards[card.key];
    if (!s || s.state === State.New) {
      fresh.push(card);
      continue;
    }
    const due = new Date(s.due);
    if (due <= now) review.push({ card, due });
    else if (!next || due < next) next = due;
  }
  review.sort((a, b) => a.due.getTime() - b.due.getTime());
  const used = state.newDay.date === dayOf(now) ? state.newDay.count : 0;
  const room = Math.max(0, newPerDay - used);
  return {
    review: review.map((r) => r.card),
    fresh: fresh.slice(0, room),
    heldBack: Math.max(0, fresh.length - room),
    next,
  };
}
