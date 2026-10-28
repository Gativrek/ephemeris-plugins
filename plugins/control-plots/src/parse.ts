/**
 * Block bodies (SPECS 13.3): one `name = value` per line. Option names are reserved;
 * every other name is a system, a rational expression in `s` that may use systems
 * from earlier lines. Errors name the line.
 */
import { add, constant, div, mul, neg, pow, S, sub } from './algebra';
import { isZero, trim, type Tf } from './poly';

export type Kind = 'bode' | 'step' | 'pzmap';

export interface System {
  name: string;
  tf: Tf;
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
}

export interface Block {
  /** In plotting order. */
  systems: System[];
  options: Options;
}

export const MAX_SYSTEMS = 6;
const OPTIONS = new Set(['w', 't', 'grid', 'title', 'units', 'margins', 'show']);
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED = new Set(['s', 'tf']);

export class BlockError extends Error {}
const fail = (line: number, message: string): never => {
  throw new BlockError(`Line ${line}: ${message}`);
};

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
    if ('+-*/^()[],'.includes(c)) {
      out.push({ kind: 'op', value: c, at: i });
      i++;
      continue;
    }
    fail(line, `unexpected '${c}'`);
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly line: number,
    private readonly scope: Map<string, Tf>,
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

  parse(): Tf {
    if (!this.tokens.length) fail(this.line, 'empty expression');
    const e = this.expr();
    if (this.i < this.tokens.length) this.unexpected();
    return e;
  }

  private expr(): Tf {
    let left = this.term();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.tokens[this.i++]!.value;
      const right = this.term();
      left = op === '+' ? add(left, right) : sub(left, right);
    }
    return left;
  }

  /** Starts an atom, so juxtaposition means multiplication: 2s, 10(s+1). */
  private startsAtom(): boolean {
    const t = this.peek();
    return !!t && (t.kind === 'num' || t.kind === 'name' || (t.kind === 'op' && t.value === '('));
  }

  private term(): Tf {
    let left = this.juxtaposed();
    for (;;) {
      if (this.isOp('*')) {
        this.i++;
        left = mul(left, this.juxtaposed());
      } else if (this.isOp('/')) {
        this.i++;
        const right = this.juxtaposed();
        try {
          left = div(left, right);
        } catch {
          fail(this.line, 'division by zero');
        }
      } else return left;
    }
  }

  /** Juxtaposition binds tighter than * and /: 10/(s+1)(s+2) is 10/((s+1)(s+2)). */
  private juxtaposed(): Tf {
    let left = this.unary();
    while (this.startsAtom()) left = mul(left, this.power());
    return left;
  }

  private unary(): Tf {
    if (this.isOp('-')) {
      this.i++;
      return neg(this.unary());
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Tf {
    const base = this.atom();
    if (!this.isOp('^')) return base;
    this.i++;
    const t = this.peek();
    if (t?.kind !== 'num' || !Number.isInteger(t.value))
      fail(this.line, 'exponents must be whole numbers (s^2, (s+1)^3)');
    this.i++;
    return pow(base, (t as { value: number }).value);
  }

  private atom(): Tf {
    const t = this.peek();
    if (!t) return this.unexpected();
    if (t.kind === 'num') {
      this.i++;
      return constant(t.value);
    }
    if (t.kind === 'op' && t.value === '(') {
      this.i++;
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.kind === 'name') {
      this.i++;
      if (t.value === 's') return S;
      if (t.value === 'tf') return this.tf();
      const sys = this.scope.get(t.value);
      if (sys) return sys;
      return fail(this.line, `unknown name '${t.value}' (systems must be defined on an earlier line)`);
    }
    return this.unexpected();
  }

  /** tf(num, den) with coefficient vectors, highest power first. */
  private tf(): Tf {
    this.expect('(');
    const num = this.vector();
    this.expect(',');
    const den = this.vector();
    this.expect(')');
    if (isZero(den)) fail(this.line, 'the denominator of tf() is zero');
    return { num: trim(num), den: trim(den) };
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

export function parseExpression(text: string, scope: Map<string, Tf> = new Map(), line = 1): Tf {
  return new Parser(tokenize(text, line), line, scope).parse();
}

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

/** Options a block type does not use (w in a step block) are ignored, so blocks can be copied between types. */
export function parseBlock(source: string): Block {
  const options: Options = { w: null, t: null, grid: true, title: null, hz: false, margins: false };
  const scope = new Map<string, Tf>();
  const systems: System[] = [];
  let show: Array<{ name: string; line: number }> | null = null;
  source.split('\n').forEach((raw, idx) => {
    const line = idx + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#') || text.startsWith('%')) return;
    const eq = text.indexOf('=');
    if (eq < 0) fail(line, 'expected name = value');
    const key = text.slice(0, eq).trim();
    const value = text.slice(eq + 1).trim();
    if (!NAME.test(key)) fail(line, `'${key}' is not a valid name`);
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
      return;
    }
    if (RESERVED.has(key)) fail(line, `'${key}' cannot name a system`);
    if (scope.has(key)) fail(line, `${key} is already defined`);
    const tf = parseExpression(value, scope, line);
    if (isZero(tf.den)) fail(line, `${key} has a zero denominator`);
    scope.set(key, tf);
    systems.push({ name: key, tf, line });
  });
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
