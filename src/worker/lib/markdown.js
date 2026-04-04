// ── Markdown-to-HTML wrapper for Cloudflare Workers ─────────────────────────
//
// markdown-wasm's ES module tries to fetch() the .wasm file at runtime,
// which doesn't work in Cloudflare Workers (no local filesystem).
//
// Wrangler supports direct .wasm imports in ES module workers — the import
// gives us a compiled WebAssembly.Module that we can instantiate ourselves.
//
// This wrapper manually instantiates the wasm module using the same ABI
// that markdown-wasm's emscripten glue expects, and exposes a simple
// parse(source, options?) function.
//
// Reference: markdown-wasm v1.2.0, md4c-based CommonMark parser.
// ─────────────────────────────────────────────────────────────────────────────

import wasmModule from '../../../node_modules/markdown-wasm/dist/markdown.wasm';

const PAGE_SIZE = 65536;
const INITIAL_PAGES = 256; // 16 MB

let memory;
let instance;
let ready = false;

// Views — rebuilt after memory growth
let HEAP8, HEAPU8, HEAP32, HEAPU32;

function updateViews() {
  const buf = memory.buffer;
  HEAP8 = new Int8Array(buf);
  HEAPU8 = new Uint8Array(buf);
  HEAP32 = new Int32Array(buf);
  HEAPU32 = new Uint32Array(buf);
}

// The wasm module imports — only a memory-grow function
const imports = {
  a: {
    a(requestedBytes) {
      const oldPages = memory.buffer.byteLength / PAGE_SIZE;
      const neededPages = Math.ceil((requestedBytes - memory.buffer.byteLength + PAGE_SIZE) / PAGE_SIZE);
      if (neededPages <= 0) return true;
      try {
        memory.grow(neededPages);
        updateViews();
        return true;
      } catch {
        return false;
      }
    },
  },
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Exported wasm functions (bound after instantiation)
let _parseUTF8, _wrealloc, _wfree, _WErrGetCode, _WErrGetMsg, _WErrClear;
let _table; // function table for onCodeBlock callback (unused for now)
let outPtr; // 4-byte scratch for output pointer

async function init() {
  if (ready) return;

  memory = new WebAssembly.Memory({ initial: INITIAL_PAGES });
  updateViews();
  imports.a.b = memory; // some builds expect memory as import

  // Cloudflare Workers: wasmModule is already a compiled WebAssembly.Module
  instance = await WebAssembly.instantiate(wasmModule, imports);

  const ex = instance.exports;

  // Bind to the same export names that markdown-wasm uses
  memory = ex.b || memory; // wasm may export its own memory
  updateViews();

  _parseUTF8 = ex.j;
  _wrealloc = ex.d;
  _wfree = ex.e;
  _WErrGetCode = ex.f;
  _WErrGetMsg = ex.g;
  _WErrClear = ex.h;
  _table = ex.i;

  // Call __wasm_call_ctors (initialization)
  if (ex.c) ex.c();

  // Allocate scratch space for the output pointer (4 bytes)
  outPtr = _wrealloc(0, 4);

  ready = true;
}

// Copy bytes into wasm memory, return pointer
function allocBytes(bytes) {
  const ptr = _wrealloc(0, bytes.length);
  HEAPU8.set(bytes, ptr);
  return ptr;
}

// Parse flags — matching markdown-wasm's ParseFlags
const ParseFlags = {
  COLLAPSE_WHITESPACE: 0x0001,
  PERMISSIVE_ATX_HEADERS: 0x0002,
  PERMISSIVE_URL_AUTO_LINKS: 0x0004,
  PERMISSIVE_EMAIL_AUTO_LINKS: 0x0008,
  NO_INDENTED_CODE_BLOCKS: 0x0010,
  NO_HTML_BLOCKS: 0x0020,
  NO_HTML_SPANS: 0x0040,
  TABLES: 0x0100,
  STRIKETHROUGH: 0x0200,
  PERMISSIVE_WWW_AUTOLINKS: 0x0400,
  TASK_LISTS: 0x0800,
  LATEX_MATH_SPANS: 0x1000,
  WIKI_LINKS: 0x2000,
  UNDERLINE: 0x4000,
  // DEFAULT = COLLAPSE_WHITESPACE | PERMISSIVE_ATX_HEADERS | PERMISSIVE_URL_AUTO_LINKS
  //         | TABLES | STRIKETHROUGH | TASK_LISTS
  DEFAULT: 0x0001 | 0x0002 | 0x0004 | 0x0100 | 0x0200 | 0x0800,
  NO_HTML: 0x0020 | 0x0040,
};

const RenderFlags = { HTML: 1, XHTML: 2, AllowJSURI: 4 };

/**
 * Parse markdown source to HTML.
 *
 * @param {string} source  Markdown source text
 * @param {object} [opts]  Options: { parseFlags, format }
 * @returns {string}       Rendered HTML
 */
export async function parse(source, opts = {}) {
  await init();

  const parseFlags = opts.parseFlags ?? ParseFlags.DEFAULT;
  let renderFlags = RenderFlags.HTML;
  if (opts.format === 'xhtml') renderFlags |= RenderFlags.XHTML;

  const srcBytes = encoder.encode(source);
  const srcPtr = allocBytes(srcBytes);

  const outLen = _parseUTF8(srcPtr, srcBytes.length, parseFlags, renderFlags, outPtr, 0);

  _wfree(srcPtr);

  if (_WErrGetCode() !== 0) {
    const errMsg = 'markdown parse error';
    _WErrClear();
    throw new Error(errMsg);
  }

  // Read output pointer from scratch space
  const resultPtr = HEAP32[outPtr >> 2];
  if (!resultPtr || outLen === 0) return '';

  const html = decoder.decode(HEAPU8.slice(resultPtr, resultPtr + outLen));

  // Free the output buffer
  _wfree(resultPtr);

  return html;
}

export { ParseFlags };
