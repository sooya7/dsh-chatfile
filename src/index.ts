/**
 * dsh-chatfile host plugin: two webServer routes.
 *
 * - POST /chatfile/upload — accepts { sessionId, name, size, mime, base64 },
 *   writes the decoded bytes into `<session workspace>/uploads/` (deduped
 *   file names), and returns { ok, absPath, relPath, name, size, mime,
 *   downloadUrl }. The workspace root is resolved through the sandbox policy
 *   with the calling session, so the file always lands inside that session's
 *   workspace boundary.
 * - GET /chatfile/download/<token> — serves a previously uploaded file by an
 *   unguessable token (no path input, no traversal surface).
 *
 * The browser half ships in the same package (`./client`); the web server
 * serves it under /plugins/dsh-chatfile/client.js.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'dsh-chatfile'

/** Services required before load: the in-memory session store, the sandbox-policy owner, and the HTTP carrier. */
export const inject = ['sessions', 'sandboxPolicy', 'webServer']

/** Single-file upload cap: 50 MiB (base64 wire payload ~67 MiB). */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Request-body cap for the upload endpoint (base64 inflation + JSON envelope). */
const MAX_BODY_BYTES = 70 * 1024 * 1024

interface UploadRecord {
  absPath: string
  name: string
  mime: string
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let name = raw.replace(/\\/g, '/').split('/').pop() ?? ''
  name = name.replace(/[\u0000-\u001f\u007f]/g, '')
  name = name.replace(/^\.+/, '')
  name = name.trim().slice(0, 150)
  if (name === '' || name === '.' || name === '..') return ''
  return name
}

function safeMime(raw: unknown): string {
  if (typeof raw !== 'string') return 'application/octet-stream'
  const mime = raw.replace(/[\u0000-\u001f\u007f\r\n]/g, '').trim().slice(0, 120)
  return mime === '' ? 'application/octet-stream' : mime
}

function randomToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const arr = new Uint8Array(16)
      crypto.getRandomValues(arr)
      let hex = ''
      for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0')
      return hex
    }
  } catch {
    // fall through to Math.random
  }
  let hex = ''
  for (let i = 0; i < 24; i++) hex += Math.floor(Math.random() * 16).toString(16)
  return hex
}

async function readBody(req: unknown, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req as AsyncIterable<Uint8Array>) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) throw new Error('请求体超过大小上限')
    chunks.push(buf)
  }
  return Buffer.concat(chunks)
}

function sendJson(res: unknown, status: number, body: unknown): void {
  const response = res as {
    writeHead(code: number, headers: Record<string, string>): void
    end(payload: string): void
  }
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(payload)),
    'Cache-Control': 'no-store',
  })
  response.end(payload)
}

/** Pick a file name in `dir` that does not collide with an existing entry (suffix -1, -2, …). */
async function pickFreeName(dir: string, base: string): Promise<string> {
  const dot = base.lastIndexOf('.')
  let candidate = base
  for (let i = 1; i < 2000; i++) {
    try {
      await stat(`${dir}/${candidate}`)
    } catch {
      return candidate
    }
    candidate = dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

/**
 * Compose the upload/download surface.
 * @param ctx - host root context.
 */
export function apply(ctx: Context): void {
  const downloads = new Map<string, UploadRecord>()

  const webServer = ctx.webServer
  const sessions = ctx.sessions
  const sandboxPolicy = ctx.sandboxPolicy

  webServer.register({
    kind: 'exact',
    path: '/chatfile/upload',
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('method not allowed')
          return
        }
        const body = await readBody(req, MAX_BODY_BYTES)
        const input = JSON.parse(body.toString('utf8') || '{}') as Record<string, unknown>

        const base64 = input.base64
        const size = input.size
        if (typeof base64 !== 'string' || base64.length === 0) {
          sendJson(res, 400, { ok: false, error: '文件数据为空' })
          return
        }
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
          sendJson(res, 400, { ok: false, error: '文件大小无效' })
          return
        }
        if (size > MAX_UPLOAD_BYTES) {
          sendJson(res, 400, { ok: false, error: '文件超过 50MB 上限' })
          return
        }
        const safeName = sanitizeName(input.name)
        if (safeName === '') {
          sendJson(res, 400, { ok: false, error: '文件名无效' })
          return
        }
        const expected = Math.ceil(size / 3) * 4
        if (base64.length < expected - 8 || base64.length > expected + 16) {
          sendJson(res, 400, { ok: false, error: '文件数据不完整' })
          return
        }

        const session = typeof input.sessionId === 'string' ? sessions.get(input.sessionId) : undefined
        const policy = sandboxPolicy.resolve(session !== undefined ? { session } : {})
        const uploadsDir = `${policy.workspaceRoot}/uploads`

        await mkdir(uploadsDir, { recursive: true })
        const fileName = await pickFreeName(uploadsDir, safeName)
        const absPath = `${uploadsDir}/${fileName}`

        await writeFile(absPath, Buffer.from(base64, 'base64'))
        const written = await stat(absPath)
        if (written.size !== size) {
          await rm(absPath, { force: true })
          sendJson(res, 400, { ok: false, error: '文件写入校验失败' })
          return
        }

        const mime = safeMime(input.mime)
        const token = randomToken()
        downloads.set(token, { absPath, name: safeName, mime })
        sendJson(res, 200, {
          ok: true,
          absPath,
          relPath: `uploads/${fileName}`,
          name: safeName,
          size,
          mime,
          downloadUrl: `/chatfile/download/${token}`,
        })
      } catch (err) {
        sendJson(res, 400, { ok: false, error: errorMessage(err) })
      }
    },
  })

  webServer.register({
    kind: 'prefix',
    path: '/chatfile/download',
    handler: async (req, res) => {
      try {
        const raw = (req.url ?? '').split('?')[0]
        const parts = raw.split('/').filter((part) => part.length > 0)
        const token = parts[parts.length - 1] ?? ''
        const record = downloads.get(token)
        if (record === undefined) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }
        const bytes = await readFile(record.absPath)
        const inline = /^image\//.test(record.mime) || record.mime === 'application/pdf'
        res.writeHead(200, {
          'Content-Type': record.mime,
          'Content-Length': String(bytes.byteLength),
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(record.name)}`,
          'Cache-Control': 'no-store',
        })
        res.end(bytes)
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('internal error')
      }
    },
  })
}
