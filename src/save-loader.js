import { parseJson5 } from './json5.js';

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
const loadCache = new WeakMap();

export function loadSaveFile(file) {
  const cached = loadCache.get(file);
  if (cached) return cached;
  const loading = loadSaveFileUncached(file);
  loadCache.set(file, loading);
  return loading;
}

async function loadSaveFileUncached(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isGzip = file.name.toLowerCase().endsWith('.gz') || hasGzipMagic(bytes);
  const textBytes = isGzip ? await decompressGzip(bytes) : bytes;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(textBytes);

  return {
    fileName: file.name,
    byteSize: bytes.byteLength,
    format: isGzip ? 'gzip-json5' : 'json5',
    root: parseJson5(text),
  };
}

export function hasGzipMagic(bytes) {
  return bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

async function decompressGzip(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser does not support local gzip decompression. Open an uncompressed save or use a current Chromium, Firefox, or Safari release.');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
