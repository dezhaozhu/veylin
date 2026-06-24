/**
 * ESM shim for assistant-stream's `import sjson from "secure-json-parse"`.
 * The upstream package is CJS-only; Vite dev cannot default-import it directly.
 */

function parse(text: string, reviver?: (key: string, value: unknown) => unknown) {
  return JSON.parse(text, reviver);
}

function safeParse(text: string, reviver?: (key: string, value: unknown) => unknown) {
  try {
    return parse(text, reviver);
  } catch {
    return undefined;
  }
}

const parser = Object.assign(parse, { parse, safeParse });

export default parser;
export { parse, safeParse };
