// Serves bounce audio and release art to the renderer (SPEC section 7a). The renderer asks by id,
// never by path, and only files the library knows about are served.
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'

export const BOUNCE_SCHEME = 'bounce'
export const ART_SCHEME = 'art'

const CONTENT_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  wav: 'audio/wav',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif'
}

// Must run before the app is ready. `stream` lets <audio> seek with range requests.
export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: BOUNCE_SCHEME, privileges: { stream: true, supportFetchAPI: true } },
    { scheme: ART_SCHEME, privileges: { supportFetchAPI: true } }
  ])
}

// Parses "bytes=start-end" (either side may be missing). Null = ignore the header.
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || (match[1] === '' && match[2] === '')) return null
  let start: number
  let end: number
  if (match[1] === '') {
    // Suffix range: the last N bytes.
    start = Math.max(0, size - Number(match[2]))
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  return start <= end && start < size ? { start, end } : null
}

async function serveFile(path: string, request: Request): Promise<Response> {
  const type = CONTENT_TYPES[extname(path).slice(1).toLowerCase()] ?? 'application/octet-stream'
  let size: number
  try {
    size = (await fs.stat(path)).size
  } catch {
    return new Response('Not found', { status: 404 })
  }
  const header = request.headers.get('range')
  const range = parseRange(header, size)
  if (header && !range) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const body = size === 0 ? null : (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream)
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {})
    }
  })
}

// Last path segment of a custom-scheme URL, e.g. bounce://file/<id> → <id>.
function lastSegment(url: string): string {
  return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
}

export function handleMediaSchemes(resolveBounce: (id: string) => string | null, artDir: string): void {
  protocol.handle(BOUNCE_SCHEME, async (request) => {
    const known = resolveBounce(lastSegment(request.url))
    if (!known) return new Response('Not found', { status: 404 })
    // The scan never follows symlinks; a file replaced by one since then is refused too.
    try {
      if (!(await fs.lstat(known)).isFile()) return new Response('Forbidden', { status: 403 })
    } catch {
      return new Response('Not found', { status: 404 })
    }
    return serveFile(known, request)
  })

  protocol.handle(ART_SCHEME, (request) => {
    const name = lastSegment(request.url)
    // Art files are named by the app (<uuid>.<ext>); anything else is refused.
    if (!/^[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif)$/.test(name)) {
      return new Response('Not found', { status: 404 })
    }
    return serveFile(join(artDir, name), request)
  })
}
