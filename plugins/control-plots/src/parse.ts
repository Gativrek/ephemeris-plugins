/**
 * Block bodies (SPECS 13.3): one `name = value` per line. Option names are reserved;
 * every other name is a system, a rational expression in `s` (or in `z`, sampled every
 * `Ts` seconds) that may use systems from earlier lines. Errors name the line.
 */
import { add, constant, div, mul, neg, pow, S, sub } from './algebra';
import { c2d, type Method } from './discretize';
import { degree, isZero, trim, type Tf } from './poly';

export type Kind = 'bode' | 'step' | 'pzmap';

/** A transfer function and its sample time in seconds (null: continuous). */
export interface Sys {
  tf: Tf;
  ts: number | null;
}

export interface System extends Sys {
  name: string;
  line: number;
}

export interface Options {
  /** Frequency range in the display unit. */
  w: [number, number] | null;
  t: number | null;
  grid: boolean;
  title: string | null;
  hz: boolean;
  margins: boolean;
  /** The sample time of systems written in z. */
  ts: number | null;
}

export interface Block {
  /** In plotting order. */
  systems: System[];
  options: Options;
}

export const MAX_SYSTEMS = 6;
const OPTIONS = new Set(['w', 't', 'grid', 'title', 'units', 'margins', 'show', 'Ts']);
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED = new Set(['s', 'z', 'tf', 'c2d']);

export class BlockError extends Error {}
const fail = (line: number, message: string): never => {
  throw new BlockError(`Line ${line}: ${message}`);
};

/** Seconds as written back in messages and legends: 0.1, not 0.1000000001. */
export const seconds = (ts: number): string => String(Number(ts.toPrecision(6)));

// ---- Expressions -------------------------------------------------------------

type Token =
  | { kind: 'num'; value: number; at: number }
  | { kind: 'name'; value: string; at: number }
  | { kind: 'op'; value: string; at: number };

const NUMBER = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;

function tokenize(text: string, line: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const num = NUMBER.exec(text.slice(i));
    if (num) {
      out.push({ kind: 'num', value: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(text.slice(i));
    if (name) {
      out.push({ kind: 'name', value: name[0], at: i });
      i += name[0].length;
      continue;
    }
    if ('+-*/^()[],\'"'.includes(c)) {
      out.push({ kind: 'op', value: c, at: i });
      i++;
      continue;
    }
    fail(line, `unexpected '${c}'`);
  }
  return out;
}

/**
 * Where a value lives: continuous (ts null) or sampled every ts seconds, with the name
 * that made it so, for messages. A plain number has none and combines with either.
 */
type Domain = { ts: number | null; who: string } | null;

interface Val {
  tf: Tf;
  d: Domain;
}

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly line: number,
    private readonly scope: Map<string, Sys>,
    private readonly blockTs: number | null,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.kind === 'op' && t.value === v;
  }
  private expect(v: string): void {
    if (!this.isOp(v)) this.unexpected(`'${v}'`);
    this.i++;
  }
  private unexpected(wanted?: string): never {
    const t = this.peek();
    if (!t) return fail(this.line, wanted ? `expected ${wanted} at the end` : 'unexpected end of line');
    return fail(this.line, wanted ? `expected ${wanted}, found '${t.value}'` : `unexpected '${t.value}'`);
  }

  parse(): Sys {
    if (!this.tokens.length) fail(this.line, 'empty expression');
    const e = this.expr();
    if (this.i < this.tokens.length) this.unexpected();
    return { tf: e.tf, ts: e.d?.ts ?? null };
  }

  /** Continuous and discrete systems do not mix, and discrete ones must share Ts. */
  private join(a: Domain, b: Domain): Domain {
    if (!a) return b;
    if (!b) return a;
    if (a.ts === b.ts) return a;
    if (a.ts !== null && b.ts !== null)
      return fail(
        this.line,
        `${a.who} and ${b.who} have different sample times (${seconds(a.ts)} s and ${seconds(b.ts)} s)`,
      );
    const [disc, cont] = a.ts !== null ? [a, b] : [b, a];
    if (cont.who === 's') return fail(this.line, 'a discrete system is written in z, not s');
    return fail(
      this.line,
      `${disc.who} is discrete and ${cont.who} is continuous; discretize ${cont.who} with c2d first`,
    );
  }

  private combine(a: Val, b: Val, op: (x: Tf, y: Tf) => Tf): Val {
    const d = this.join(a.d, b.d);
    return { tf: op(a.tf, b.tf), d };
  }

  private expr(): Val {
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.tokens[this.i++]!.value;
      const right = this.term();
      left = this.combine(left, right, op === '+' ? add : sub);
    }
    return left;
  }

  /** Starts an atom, so juxtaposition means multiplication: 2s, 10(s+1). */
  private startsAtom(): boolean {
    const t = this.peek();
    return !!t && (t.kind === 'num' || t.kind === 'name' || (t.kind === 'op' && t.value === '('));
  }

  private term(): Val {
    let left = this.juxtaposed();
    for (;;) {
      if (this.isOp('*')) {
        this.i++;
        left = this.combine(left, this.juxtaposed(), mul);
      } else if (this.isOp('/')) {
        this.i++;
        const right = this.juxtaposed();
        try {
          left = this.combine(left, right, div);
        } catch (err) {
          if (err instanceof BlockError) throw err;
          fail(this.line, 'division by zero');
        }
      } else return left;
    }
  }

  /** Juxtaposition binds tighter than * and /: 10/(s+1)(s+2) is 10/((s+1)(s+2)). */
  private juxtaposed(): Val {
    let left = this.unary();
    while (this.startsAtom()) left = this.combine(left, this.power(), mul);
    return left;
  }

  private unary(): Val {
    if (this.isOp('-')) {
      this.i++;
      const v = this.unary();
      return { tf: neg(v.tf), d: v.d };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Val {
    const base = this.atom();
    if (!this.isOp('^')) return base;
    this.i++;
    const t = this.peek();
    if (t?.kind !== 'num' || !Number.isInteger(t.value))
      fail(this.line, 'exponents must be whole numbers (s^2, (s+1)^3)');
    this.i++;
    return { tf: pow(base.tf, (t as { value: number }).value), d: base.d };
  }

  private atom(): Val {
    const t = this.peek();
    if (!t) return this.unexpected();
    if (t.kind === 'num') {
      this.i++;
      return { tf: constant(t.value), d: null };
    }
    if (t.kind === 'op' && t.value === '(') {
      this.i++;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.kind === 'name') {
      this.i++;
      if (t.value === 's') return { tf: S, d: { ts: null, who: 's' } };
      if (t.value === 'z') {
        if (this.blockTs === null) fail(this.line, 'a system in z needs Ts = … (the sample time in seconds)');
        return { tf: S, d: { ts: this.blockTs, who: 'z' } };
      }
      if (t.value === 'tf') return this.tf();
      if (t.value === 'c2d') return this.c2d();
      const sys = this.scope.get(t.value);
      if (sys) {
        // A plain gain (K = 5) fits continuous and discrete systems alike.
        const gain = sys.ts === null && degree(sys.tf.num) === 0 && degree(sys.tf.den) === 0;
        return { tf: sys.tf, d: gain ? null : { ts: sys.ts, who: t.value } };
      }
      return fail(this.line, `unknown name '${t.value}' (systems must be defined on an earlier line)`);
    }
    return this.unexpected();
  }

  /** tf(num, den) with coefficient vectors, highest power first; tf(num, den, Ts) is discrete. */
  private tf(): Val {
    this.expect('(');
    const num = this.vector();
    this.expect(',');
    const den = this.vector();
    let ts: number | null = null;
    if (this.isOp(',')) {
      this.i++;
      ts = this.sampleTime('tf(num, den, Ts)');
    }
    this.expect(')');
    if (isZero(den)) fail(this.line, 'the denominator of tf() is zero');
    return { tf: { num: trim(num), den: trim(den) }, d: { ts, who: 'tf(…)' } };
  }

  /** c2d(G, Ts) samples a continuous system with a zero-order hold; c2d(G, Ts, tustin) bilinearly. */
  private c2d(): Val {
    this.expect('(');
    const sys = this.expr();
    this.expect(',');
    const ts = this.sampleTime('c2d(G, Ts)');
    let method: Method = 'zoh';
    if (this.isOp(',')) {
      this.i++;
      const quote = this.isOp("'") ? "'" : this.isOp('"') ? '"' : null;
      if (quote) this.i++;
      const t = this.peek();
      const name = t?.kind === 'name' ? t.value.toLowerCase() : null;
      if (name !== 'zoh' && name !== 'tustin') fail(this.line, 'the c2d method must be zoh or tustin');
      method = name as Method;
      this.i++;
      if (quote) this.expect(quote);
    }
    this.expect(')');
    if (sys.d?.ts != null) fail(this.line, `c2d needs a continuous system, and ${sys.d.who} is discrete`);
    if (degree(sys.tf.num) > degree(sys.tf.den))
      fail(this.line, 'c2d needs a proper system (no more zeros than poles)');
    return { tf: c2d(sys.tf, ts, method), d: { ts, who: 'c2d(…)' } };
  }

  private sampleTime(form: string): number {
    const v = this.signedNumber();
    if (!(v > 0) || !Number.isFinite(v)) fail(this.line, `the sample time in ${form} must be above 0`);
    return v;
  }

  private vector(): number[] {
    if (!this.isOp('[')) return [this.signedNumber()];
    this.i++;
    const out: number[] = [];
    while (!this.isOp(']')) {
      if (!this.peek()) this.unexpected("']'");
      out.push(this.signedNumber());
      if (this.isOp(',')) this.i++;
    }
    this.i++;
    if (!out.length) fail(this.line, 'empty coefficient vector');
    return out;
  }

  private signedNumber(): number {
    let sign = 1;
    while (this.isOp('-') || this.isOp('+')) if (this.tokens[this.i++]!.value === '-') sign = -sign;
    const t = this.peek();
    if (t?.kind !== 'num') return this.unexpected('a number');
    this.i++;
    return sign * t.value;
  }
}

export function parseSystem(
  text: string,
  scope: Map<string, Sys> = new Map(),
  line = 1,
  ts: number | null = null,
): Sys {
  return new Parser(tokenize(text, line), line, scope, ts).parse();
}

/** The transfer function alone (tests and continuous use). */
export const parseExpression = (
  text: string,
  scope: Map<string, Sys> = new Map(),
  line = 1,
  ts: number | null = null,
): Tf => parseSystem(text, scope, line, ts).tf;

// ---- Block -------------------------------------------------------------------

function range(v: string, line: number, what: string): [number, number] {
  const parts = v.split('..');
  const num = (s: string | undefined) => (s !== undefined && s.trim() !== '' ? Number(s) : NaN);
  const a = parts.length === 2 ? num(parts[0]) : NaN;
  const b = parts.length === 2 ? num(parts[1]) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a >= b)
    fail(line, `${what} must be a range like 0.01..100`);
  return [a, b];
}

function onOff(v: string, line: number, key: string): boolean {
  const s = v.trim().toLowerCase();
  if (s === 'on') return true;
  if (s === 'off') return false;
  return fail(line, `${key} must be on or off`);
}

interface Line {
  line: number;
  key: string;
  value: string;
}

/** Options a block type does not use (w in a step block) are ignored, so blocks can be copied between types. */
export function parseBlock(source: string): Block {
  const options: Options = { w: null, t: null, grid: true, title: null, hz: false, margins: false, ts: null };
  const lines: Line[] = [];
  source.split('\n').forEach((raw, idx) => {
    const line = idx + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#') || text.startsWith('%')) return;
    const eq = text.indexOf('=');
    if (eq < 0) fail(line, 'expected name = value');
    const key = text.slice(0, eq).trim();
    if (!NAME.test(key)) fail(line, `'${key}' is not a valid name`);
    lines.push({ line, key, value: text.slice(eq + 1).trim() });
  });
  // Ts first: systems in z may come before it.
  for (const { line, key, value } of lines) {
    if (key !== 'Ts') continue;
    const ts = Number(value);
    if (!value || !(ts > 0) || !Number.isFinite(ts))
      fail(line, 'Ts must be a sample time in seconds, like 0.1');
    options.ts = ts;
  }

  const scope = new Map<string, Sys>();
  const systems: System[] = [];
  let show: Array<{ name: string; line: number }> | null = null;
  for (const { line, key, value } of lines) {
    if (OPTIONS.has(key)) {
      if (key === 'title') options.title = value || null;
      else if (key === 'grid') options.grid = onOff(value, line, key);
      else if (key === 'margins') options.margins = onOff(value, line, key);
      else if (key === 'units') {
        const u = value.toLowerCase();
        if (u !== 'rad/s' && u !== 'hz') fail(line, 'units must be rad/s or Hz');
        options.hz = u === 'hz';
      } else if (key === 'w') {
        const r = range(value, line, 'w');
        if (r[0] <= 0) fail(line, 'w must be above 0 (the axis is logarithmic)');
        options.w = r;
      } else if (key === 't') {
        const t = /\.\./.test(value) ? range(value, line, 't') : [0, Number(value)];
        if (t[0] !== 0 || !(t[1]! > 0) || !Number.isFinite(t[1])) fail(line, 't must be a range like 0..10');
        options.t = t[1]!;
      } else if (key === 'show') {
        show = value
          .split(/[\s,]+/)
          .filter(Boolean)
          .map((name) => ({ name, line }));
      }
      continue;
    }
    if (RESERVED.has(key)) fail(line, `'${key}' cannot name a system`);
    if (scope.has(key)) fail(line, `${key} is already defined`);
    const sys = parseSystem(value, scope, line, options.ts);
    if (isZero(sys.tf.den)) fail(line, `${key} has a zero denominator`);
    scope.set(key, sys);
    systems.push({ name: key, ...sys, line });
  }
  let plotted = systems;
  if (show) {
    plotted = (show as Array<{ name: string; line: number }>).map(({ name, line }) => {
      const sys = systems.find((s) => s.name === name);
      return sys ?? fail(line, `show: unknown system '${name}'`);
    });
  }
  if (!plotted.length) throw new BlockError('No system to plot: write a line like G = 1/(s+1).');
  if (plotted.length > MAX_SYSTEMS)
    throw new BlockError(`At most ${MAX_SYSTEMS} systems per plot; use show = … or split the block.`);
  return { systems: plotted, options };
}
