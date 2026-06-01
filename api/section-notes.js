import { del, get, list, put } from '@vercel/blob';

const STORE_PREFIX = 'sweet-honey-farm/section-notes/v2';
const MAX_NOTE_LENGTH = 4000;
const MAX_AUTHOR_LENGTH = 120;
const MAX_SECTION_KEY_LENGTH = 240;
const MAX_NOTES_PER_SECTION = 500;

function sendJson(response, payload, status = 200) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(payload));
}

function normalizeText(value, maxLength) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeBody(value) {
  return String(value || '').trim().slice(0, MAX_NOTE_LENGTH);
}

function normalizePosition(value) {
  if (!value || typeof value !== 'object') return null;
  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.max(1, Math.min(99, x)),
    y: Math.max(1, Math.min(99, y)),
  };
}

function hueForName(name) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return (hash + 22) % 360;
}

function blobSafe(value) {
  return Buffer.from(String(value), 'utf8')
    .toString('base64url')
    .replace(/=+$/, '');
}

function notePath(sectionKey, id) {
  return `${STORE_PREFIX}/${blobSafe(sectionKey)}/${blobSafe(id)}.json`;
}

function hasBlobToken() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function blobText(blob) {
  if (!blob) return null;
  if (typeof blob.text === 'function') return blob.text();
  if (blob.stream) return new Response(blob.stream).text();
  return null;
}

async function readNote(pathname) {
  const blob = await get(pathname, { access: 'private', useCache: false });
  const text = await blobText(blob);
  if (!text) return null;
  const note = JSON.parse(text);
  if (!note || typeof note !== 'object' || !note.id) return null;
  return note;
}

async function writeNote(sectionKey, note) {
  await put(notePath(sectionKey, note.id), JSON.stringify(note, null, 2), {
    access: 'private',
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
    cacheControlMaxAge: 0,
  });
}

async function readSectionNotes(sectionKey) {
  const prefix = `${STORE_PREFIX}/${blobSafe(sectionKey)}/`;
  const notes = [];
  let cursor;

  do {
    const page = await list({
      prefix,
      cursor,
      limit: 1000,
    });

    for (const blob of page.blobs || []) {
      try {
        const note = await readNote(blob.url);
        if (note) notes.push(note);
      } catch {
        // Ignore a malformed note object so one bad record does not break the page.
      }
    }

    cursor = page.cursor;
  } while (cursor);

  return notes.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}

async function readSelectedNotes(keys) {
  const selected = {};

  for (const key of keys) {
    selected[key] = await readSectionNotes(key);
  }

  return selected;
}

async function readJsonBody(request) {
  const parseText = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };

  if (request.body) {
    if (typeof request.body === 'string') {
      return parseText(request.body);
    }

    if (Buffer.isBuffer(request.body)) {
      return parseText(request.body.toString('utf8'));
    }

    if (
      typeof request.body === 'object'
      && typeof request.body.pipe !== 'function'
      && typeof request.body[Symbol.asyncIterator] !== 'function'
    ) {
      return request.body;
    }
  }

  const chunks = [];
  const stream = request.body && typeof request.body[Symbol.asyncIterator] === 'function'
    ? request.body
    : request;

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};

  return parseText(Buffer.concat(chunks).toString('utf8'));
}

export default async function handler(request, response) {
  const url = new URL(request.url || '/', `https://${request.headers.host || 'localhost'}`);

  if (!hasBlobToken()) {
    return sendJson(response, {
      ok: false,
      error: 'Shared comments are not configured yet. Add BLOB_READ_WRITE_TOKEN in Vercel.',
    }, 503);
  }

  if (request.method === 'GET') {
    const keys = (url.searchParams.get('keys') || '')
      .split(',')
      .map((key) => normalizeText(key, MAX_SECTION_KEY_LENGTH))
      .filter(Boolean);

    return sendJson(response, { ok: true, notes: await readSelectedNotes(keys) });
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const sectionKey = normalizeText(body.sectionKey, MAX_SECTION_KEY_LENGTH);
    const author = normalizeText(body.author, MAX_AUTHOR_LENGTH);
    const text = normalizeBody(body.text);
    const position = normalizePosition(body.position);

    if (!sectionKey || !author || !text) {
      return sendJson(response, { ok: false, error: 'Missing sectionKey, author, or text.' }, 400);
    }

    const notes = await readSectionNotes(sectionKey);
    if (notes.length >= MAX_NOTES_PER_SECTION) {
      return sendJson(response, { ok: false, error: 'This section has reached the note limit.' }, 400);
    }

    const note = {
      id: `${Date.now()}-${crypto.randomUUID()}`,
      author,
      hue: Number.isFinite(body.hue) ? body.hue : hueForName(author),
      text,
      position,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };

    await writeNote(sectionKey, note);
    return sendJson(response, { ok: true, note });
  }

  if (request.method === 'PATCH') {
    const body = await readJsonBody(request);
    const sectionKey = normalizeText(body.sectionKey, MAX_SECTION_KEY_LENGTH);
    const id = normalizeText(body.id, 160);
    const text = normalizeBody(body.text);
    const author = normalizeText(body.author, MAX_AUTHOR_LENGTH);
    const hasText = Object.prototype.hasOwnProperty.call(body, 'text');
    const hasPosition = Object.prototype.hasOwnProperty.call(body, 'position');

    if (!sectionKey || !id || (hasText && !text) || (!hasText && !hasPosition)) {
      return sendJson(response, { ok: false, error: 'Missing note or replacement text.' }, 400);
    }

    const note = await readNote(notePath(sectionKey, id));
    if (!note) {
      return sendJson(response, { ok: false, error: 'Missing note or replacement text.' }, 400);
    }

    if (hasText) note.text = text;
    if (author) {
      note.author = author;
      note.hue = Number.isFinite(body.hue) ? body.hue : hueForName(author);
    }
    if (hasPosition) {
      note.position = normalizePosition(body.position);
    }
    note.updatedAt = new Date().toISOString();
    await writeNote(sectionKey, note);
    return sendJson(response, { ok: true, note });
  }

  if (request.method === 'DELETE') {
    const body = await readJsonBody(request);
    const sectionKey = normalizeText(body.sectionKey, MAX_SECTION_KEY_LENGTH);
    const id = normalizeText(body.id, 160);

    if (!sectionKey || !id) {
      return sendJson(response, { ok: false, error: 'Missing sectionKey or id.' }, 400);
    }

    await del(notePath(sectionKey, id));
    return sendJson(response, { ok: true });
  }

  return sendJson(response, { ok: false, error: 'Method not allowed.' }, 405);
}
