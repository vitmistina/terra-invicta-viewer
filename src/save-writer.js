const POSITIVE_INFINITY_SENTINEL = '__TI_SAVE_POSITIVE_INFINITY_7a8928f5__';
const NEGATIVE_INFINITY_SENTINEL = '__TI_SAVE_NEGATIVE_INFINITY_7a8928f5__';
const NAN_SENTINEL = '__TI_SAVE_NAN_7a8928f5__';

export function serializeTerraInvictaSave(root) {
  const json = JSON.stringify(root, (_key, value) => {
    if (typeof value !== 'number' || Number.isFinite(value)) return value;
    if (Number.isNaN(value)) return NAN_SENTINEL;
    return value > 0 ? POSITIVE_INFINITY_SENTINEL : NEGATIVE_INFINITY_SENTINEL;
  });

  return `\ufeff${json}`
    .replaceAll(`"${POSITIVE_INFINITY_SENTINEL}"`, 'Infinity')
    .replaceAll(`"${NEGATIVE_INFINITY_SENTINEL}"`, '-Infinity')
    .replaceAll(`"${NAN_SENTINEL}"`, 'NaN');
}

export async function buildModifiedSave(loadedSave, root) {
  const text = serializeTerraInvictaSave(root);
  const wantsGzip = String(loadedSave?.format ?? '').startsWith('gzip') || String(loadedSave?.fileName ?? '').toLowerCase().endsWith('.gz');
  const originalName = loadedSave?.fileName || 'terra-invicta-save.json';

  if (wantsGzip && typeof CompressionStream !== 'undefined') {
    const compressed = await compressGzip(new TextEncoder().encode(text));
    return {
      blob: new Blob([compressed], { type: 'application/gzip' }),
      fileName: cheatFileName(originalName, true),
      format: 'gzip-json5',
    };
  }

  return {
    blob: new Blob([text], { type: 'application/json;charset=utf-8' }),
    fileName: cheatFileName(originalName, false),
    format: wantsGzip ? 'json5-fallback' : 'json5',
  };
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function cheatFileName(fileName, gzip) {
  const name = String(fileName || 'terra-invicta-save');
  if (gzip) {
    const base = name.toLowerCase().endsWith('.gz') ? name.slice(0, -3) : name;
    return `${base}-cheat.gz`;
  }
  const extensionMatch = name.match(/(\.json5?|\.tisave)$/i);
  if (extensionMatch) return `${name.slice(0, -extensionMatch[0].length)}-cheat${extensionMatch[0]}`;
  if (name.toLowerCase().endsWith('.gz')) return `${name.slice(0, -3)}-cheat.json`;
  return `${name}-cheat.json`;
}

async function compressGzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
