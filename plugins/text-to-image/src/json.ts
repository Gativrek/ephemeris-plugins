/**
 * Duplicate keys in a JSON document. `JSON.parse` keeps the last of two equal keys
 * without a word, so the profile validator walks the text itself. Call it only on text
 * that `JSON.parse` accepted.
 */
/** A UTF-8 byte-order mark, as profiles saved by some editors begin with one. */
export const BOM = String.fromCharCode(0xfeff);

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

export function duplicateKeys(source: string): string[] {
  const text = stripBom(source);
  const out: string[] = [];
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++;
  };
  const str = (): string => {
    let raw = '';
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        raw += text.slice(i, i + 2);
        i += 2;
      } else raw += text[i++];
    }
    i++;
    return JSON.parse(`"${raw}"`) as string;
  };
  const join = (path: string, key: string) => (path ? `${path}.${key}` : key);
  const value = (path: string): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') {
        i++;
        return;
      }
      const seen = new Set<string>();
      for (;;) {
        ws();
        const key = str();
        if (seen.has(key)) out.push(join(path, key));
        seen.add(key);
        ws();
        i++; // ':'
        value(join(path, key));
        ws();
        if (text[i++] !== ',') return;
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        value(`${path}[${n}]`);
        ws();
        if (text[i++] !== ',') return;
      }
    }
    if (c === '"') {
      str();
      return;
    }
    while (i < text.length && !',}] \t\n\r'.includes(text[i]!)) i++;
  };
  value('');
  return out;
}
