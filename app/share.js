// Shareable links: the bill travels in the URL fragment.
//
// The fragment is deliberate. Browsers never transmit it to a server, so a link
// carrying someone's draft text can be pasted around without the text itself
// being logged by whatever host is serving these static files. It also keeps the
// app backend-free — there is nothing to store and nothing to expire.
//
// Only extracted text is ever encoded, never the source PDF: a PDF would be
// hundreds of kilobytes of base64 and would carry along whatever metadata the
// drafter's tooling embedded in it.

const PREFIX_DEFLATE = 'z';
const PREFIX_RAW = 'r';

// Past this, most chat clients, mail gateways and issue trackers start wrapping
// or truncating a URL. We still produce the link — it works if pasted intact —
// but the UI says so rather than handing over something that breaks silently.
export const SAFE_URL_LENGTH = 8000;

// --------------------------------------------------------------- base64url
function toBase64Url(bytes) {
  let binary = '';
  // Chunked: String.fromCharCode(...big array) blows the argument limit, and a
  // 120 KB bill is comfortably big enough to hit it.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ------------------------------------------------------------- compression
const hasCompression =
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function pipe(bytes, stream) {
  const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

/** Encode bill text into a fragment payload. Bill text deflates ~5×. */
export async function encodeBill(text) {
  const bytes = new TextEncoder().encode(text);
  if (!hasCompression) return PREFIX_RAW + toBase64Url(bytes);
  const packed = await pipe(bytes, new CompressionStream('deflate-raw'));
  return PREFIX_DEFLATE + toBase64Url(packed);
}

/** Decode a fragment payload back to bill text. Throws if it is not readable. */
export async function decodeBill(payload) {
  const kind = payload[0];
  const body = payload.slice(1);
  const bytes = fromBase64Url(body);
  if (kind === PREFIX_RAW) return new TextDecoder().decode(bytes);
  if (kind !== PREFIX_DEFLATE) throw new Error('unrecognised link format');
  if (!hasCompression) throw new Error('this browser cannot decompress shared links');
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')));
}

// ------------------------------------------------------------------- URLs
/** Build a full shareable URL for the given bill text. */
export async function buildShareUrl(text, base = location.href) {
  const url = new URL(base);
  url.hash = `t=${await encodeBill(text)}`;
  return url.toString();
}

/** Read a shared bill out of a location hash, or null if there isn't one. */
export async function readSharedBill(hash = location.hash) {
  const m = /(?:^#|&)t=([A-Za-z0-9\-_]+)/.exec(hash || '');
  if (!m) return null;
  return decodeBill(m[1]);
}
