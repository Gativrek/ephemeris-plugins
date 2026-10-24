/** The build bundles SVG files as their text (esbuild's text loader). */
declare module '*.svg' {
  const text: string;
  export default text;
}
