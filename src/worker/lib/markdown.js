// ── Markdown-to-HTML via markdown-wasm (Cloudflare Workers) ──────────────────
//
// markdown-wasm's ES module tries to fetch() the .wasm file at runtime,
// which doesn't work in Workers. Wrangler treats `.wasm` imports as compiled
// WebAssembly.Module objects, so we import it directly and instantiate
// it ourselves using the emscripten ABI.
//
// Emscripten ABI notes:
//   imports:  { a: { a: fn } }  — only one import: a memory-grow callback
//   exports:  b = Memory, c = __wasm_call_ctors, d = wrealloc, e = wfree,
//             f = WErrGetCode, g = WErrGetMsg, h = WErrClear, j = parseUTF8
//
// The wasm module creates and exports its own memory (export "b").
// The grow callback is a closure over `memory`, which we assign after
// instantiation — safe because grow is only called during parsing, never
// during instantiation itself.
// ─────────────────────────────────────────────────────────────────────────────

import wasmModule from '../../../node_modules/markdown-wasm/dist/markdown.wasm';

// Views are rebuilt whenever the wasm memory grows
let memory;
let HEAPU8, HEAP32;

function updateViews() {
  const buf = memory.buffer;
  HEAPU8 = new Uint8Array(buf);
  HEAP32 = new Int32Array(buf);
}

// Import object — the single grow callback closes over `memory`.
// `memory` is null until init() completes, but wasm never calls this
// during instantiation, so by the time it fires memory is always set.
const wasmImports = {
  a: {
    a(requestedBytes) {
      const current = memory.buffer.byteLength;
      if ((requestedBytes >>> 0) <= current) return true;
      const pagesNeeded = Math.ceil(((requestedBytes >>> 0) - current) / 65536);
      try {
        memory.grow(pagesNeeded);
        updateViews();
        return true;
      } catch {
        return false;
      }
    },
  },
};

let _parseUTF8, _wrealloc, _wfree, _WErrGetCode, _WErrGetMsg, _WErrClear;
let outPtr;
let ready = false;
let initPromise = null;

async function init() {
  if (ready) return;

  // Wrangler provides wasmModule as a compiled WebAssembly.Module,
  // so instantiate() returns a WebAssembly.Instance directly.
  const instance = await WebAssembly.instantiate(wasmModule, wasmImports);
  const ex = instance.exports;

  // Grab the wasm's own exported memory and set up typed views
  memory = ex.b;
  updateViews();

  // Bind exported functions
  _wrealloc    = ex.d;
  _wfree       = ex.e;
  _WErrGetCode = ex.f;
  _WErrGetMsg  = ex.g;
  _WErrClear   = ex.h;
  _parseUTF8   = ex.j;

  // Run emscripten initializers
  if (ex.c) ex.c();

  // 4-byte scratch buffer for the output pointer
  outPtr = _wrealloc(0, 4);

  ready = true;
}

// ── ParseFlags ───────────────────────────────────────────────────────────────

export const ParseFlags = {
  COLLAPSE_WHITESPACE:      0x0001,
  PERMISSIVE_ATX_HEADERS:   0x0002,
  PERMISSIVE_URL_AUTO_LINKS:0x0004,
  PERMISSIVE_EMAIL_AUTO_LINKS: 0x0008,
  NO_INDENTED_CODE_BLOCKS:  0x0010,
  NO_HTML_BLOCKS:           0x0020,
  NO_HTML_SPANS:            0x0040,
  TABLES:                   0x0100,
  STRIKETHROUGH:            0x0200,
  PERMISSIVE_WWW_AUTOLINKS: 0x0400,
  TASK_LISTS:               0x0800,
  LATEX_MATH_SPANS:         0x1000,
  WIKI_LINKS:               0x2000,
  UNDERLINE:                0x4000,
  DEFAULT: 0x0001 | 0x0002 | 0x0004 | 0x0100 | 0x0200 | 0x0800,
  NO_HTML: 0x0020 | 0x0040,
};

const RenderFlags = { HTML: 1, XHTML: 2 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── parse() ──────────────────────────────────────────────────────────────────

/**
 * Convert markdown source to an HTML string.
 *
 * @param {string} source        Markdown text
 * @param {object} [opts]
 * @param {number} [opts.parseFlags]   Defaults to ParseFlags.DEFAULT
 * @param {string} [opts.format]       "html" (default) or "xhtml"
 * @returns {Promise<string>}
 */
export async function parse(source, opts = {}) {
  // Serialize concurrent callers so WASM init only runs once
  if (!initPromise) initPromise = init();
  await initPromise;

  const parseFlags = opts.parseFlags ?? ParseFlags.DEFAULT;
  const renderFlags = opts.format === 'xhtml'
    ? RenderFlags.HTML | RenderFlags.XHTML
    : RenderFlags.HTML;

  const srcBytes = encoder.encode(source);
  const srcLen   = srcBytes.length;
  const srcPtr   = _wrealloc(0, srcLen);
  HEAPU8.set(srcBytes, srcPtr);

  const outLen = _parseUTF8(srcPtr, srcLen, parseFlags, renderFlags, outPtr, 0);
  _wfree(srcPtr);

  // Check for wasm-side errors
  if (_WErrGetCode() !== 0) {
    _WErrClear();
    throw new Error('markdown-wasm parse error');
  }

  if (outLen === 0) return '';

  const resultPtr = HEAP32[outPtr >> 2];
  const html = decoder.decode(HEAPU8.subarray(resultPtr, resultPtr + outLen));
  _wfree(resultPtr);

  return html;
}
