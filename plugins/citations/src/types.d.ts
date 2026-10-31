/** citeproc-js ships without types: the part of its API the plugin uses. */
declare module 'citeproc' {
  export interface CiteprocSys {
    retrieveLocale(lang: string): string;
    retrieveItem(id: string): unknown;
  }
  export interface CitationItem {
    id: string;
    locator?: string;
    label?: string;
    prefix?: string;
    suffix?: string;
    'suppress-author'?: boolean;
    'author-only'?: boolean;
  }
  export class Engine {
    constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean);
    setOutputFormat(format: 'html' | 'text'): void;
    updateItems(ids: string[]): void;
    makeCitationCluster(items: CitationItem[]): string;
    makeBibliography(): [{ entry_ids: string[][] } & Record<string, unknown>, string[]] | false;
  }
  const CSL: { Engine: typeof Engine };
  export default CSL;
}

declare module '*.csl' {
  const text: string;
  export default text;
}
declare module '*.xml' {
  const text: string;
  export default text;
}
