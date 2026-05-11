/**
 * Push Server — HTTP interface for external services (e.g. market-watch)
 * to push text + image messages into WeChat.
 *
 * Harness Engineering principles applied:
 *   Constrain  — auth token, rate limit, size caps, schema validation
 *   Externalize state — push log written to disk
 *   Verify     — JSON schema validation on every request
 *   Fail locally — per-push error isolation, image fallback, retry
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { appendFileSync } from 'node:fs'
import type { WeChatBot } from '@wechatbot/wechatbot'

// ── Types ───────────────────────────────────────────────────────────

export interface PushServerConfig {
  enabled: boolean
  port: number
  host: string
  /** Shared secret — caller must include in Authorization header */
  authToken?: string
  /** Max text length per push (WeChat limit ~2048, leave margin) */
  maxTextLength: number
  /** Max images per push */
  maxImages: number
  /** Max pushes per minute (rate limit) */
  maxPushesPerMinute: number
  /** Path to push log file (Harness: externalize state) */
  logPath: string
}

export interface ImagePayload {
  /** base64-encoded image data (without data: URL prefix) */
  data: string
  /** e.g. "image/png", "image/jpeg" */
  mimeType: string
}

export interface PushRequest {
  text?: string
  images?: ImagePayload[]
}

interface PushLogEntry {
  ts: string
  text: string
  imageCount: number
  success: boolean
  error?: string
}

// ── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_PUSH_CONFIG: PushServerConfig = {
  enabled: false,
  port: 9876,
  host: '127.0.0.1',
  maxTextLength: 2000,
  maxImages: 3,
  maxPushesPerMinute: 10,
  logPath: '',
}

// ── Validation ──────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
])

class PushValidationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
  ) {
    super(message)
    this.name = 'PushValidationError'
  }
}

/**
 * Validate and normalize a push request body against the schema.
 * Throws PushValidationError on failure.
 */
function validatePushBody(body: unknown): PushRequest {
  if (!body || typeof body !== 'object') {
    throw new PushValidationError('Body must be a JSON object')
  }

  const obj = body as Record<string, unknown>

  const result: PushRequest = {}

  // text: optional, but if present must be a non-empty string
  if (obj.text !== undefined) {
    if (typeof obj.text !== 'string' || obj.text.trim().length === 0) {
      throw new PushValidationError('"text" must be a non-empty string when provided')
    }
    result.text = obj.text.trim()
  }

  // images: optional array
  if (obj.images !== undefined) {
    if (!Array.isArray(obj.images)) {
      throw new PushValidationError('"images" must be an array')
    }
    for (let i = 0; i < obj.images.length; i++) {
      const img = obj.images[i]
      if (!img || typeof img !== 'object') {
        throw new PushValidationError(`images[${i}] must be an object`)
      }
      const imgObj = img as Record<string, unknown>
      if (typeof imgObj.data !== 'string' || imgObj.data.length === 0) {
        throw new PushValidationError(`images[${i}].data is required and must be non-empty`)
      }
      if (typeof imgObj.mimeType !== 'string') {
        throw new PushValidationError(`images[${i}].mimeType is required`)
      }
      if (!ALLOWED_MIME_TYPES.has(imgObj.mimeType)) {
        throw new PushValidationError(
          `images[${i}].mimeType "${imgObj.mimeType}" is not allowed. Supported: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
        )
      }
      // Basic base64 format check
      if (!/^[A-Za-z0-9+/=]+$/.test(imgObj.data)) {
        throw new PushValidationError(`images[${i}].data is not valid base64`)
      }
    }
    result.images = obj.images as ImagePayload[]
  }

  return result
}

// ── Push Server ─────────────────────────────────────────────────────

/**
 * Lightweight HTTP server that receives push requests and forwards
 * them to WeChat via the bot instance.
 *
 * Does NOT interact with Pi sessions — pure WeChat message delivery.
 */
export class PushServer {
  private server: Server | null = null
  private bot: WeChatBot
  private config: PushServerConfig
  private getUserId: () => string | null
  private pushTimestamps: number[] = []

  constructor(
    bot: WeChatBot,
    config: PushServerConfig,
    getUserId: () => string | null,
  ) {
    this.bot = bot
    this.config = config
    this.getUserId = getUserId
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  start(): void {
    if (!this.config.enabled) {
      console.log('  Push Server: disabled')
      return
    }

    this.server = createServer((req, res) => {
      this.handleRequest(req, res)
    })

    this.server.listen(this.config.port, this.config.host, () => {
      console.log(`  Push Server: http://${this.config.host}:${this.config.port}/push`)
      if (this.config.authToken) {
        console.log(`  Push Server: auth enabled (token)`)
      }
    })

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`  Push Server: port ${this.config.port} already in use — disabled`)
        this.server = null
      } else {
        console.error(`  Push Server error:`, err.message)
      }
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve())
      })
    }
  }

  // ── Request handling ───────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Only POST /push
    if (req.method !== 'POST' || req.url !== '/push') {
      this.jsonReply(res, 404, { error: 'Not found. Use POST /push' })
      return
    }

    // ── Harness: Constrain — Auth check ────────────────────────
    if (this.config.authToken) {
      const auth = req.headers['authorization']
      const expected = `Bearer ${this.config.authToken}`
      if (!auth || auth !== expected) {
        this.jsonReply(res, 401, { error: 'Unauthorized. Provide Authorization: Bearer <token>' })
        return
      }
    }

    // ── Harness: Constrain — Rate limit ────────────────────────
    if (!this.checkRateLimit()) {
      this.jsonReply(res, 429, { error: 'Rate limit exceeded. Max 10 pushes per minute.' })
      return
    }

    // ── Read body ──────────────────────────────────────────────
    let rawBody = ''
    try {
      rawBody = await readRequestBody(req, 128 * 1024) // 128KB max
    } catch {
      this.jsonReply(res, 413, { error: 'Request body too large' })
      return
    }

    // ── Parse JSON ─────────────────────────────────────────────
    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      this.jsonReply(res, 400, { error: 'Invalid JSON' })
      return
    }

    // ── Harness: Verify — Schema validation ────────────────────
    let pushReq: PushRequest
    try {
      pushReq = validatePushBody(body)
    } catch (e) {
      const err = e as PushValidationError
      this.jsonReply(res, err.statusCode, { error: err.message })
      return
    }

    // ── Harness: Constrain — Size caps ─────────────────────────
    if (pushReq.text && pushReq.text.length > this.config.maxTextLength) {
      this.jsonReply(res, 400, {
        error: `Text too long (${pushReq.text.length} chars). Max: ${this.config.maxTextLength}`,
      })
      return
    }
    if (pushReq.images && pushReq.images.length > this.config.maxImages) {
      this.jsonReply(res, 400, {
        error: `Too many images (${pushReq.images.length}). Max: ${this.config.maxImages}`,
      })
      return
    }

    // ── Resolve target user ────────────────────────────────────
    const userId = this.getUserId()
    if (!userId) {
      this.logPush({ ts: new Date().toISOString(), text: pushReq.text ?? '', imageCount: pushReq.images?.length ?? 0, success: false, error: 'No active WeChat user. Send a message to the bot first.' })
      this.jsonReply(res, 503, {
        error: 'No active WeChat user. Send a message to the bot first, then retry.',
      })
      return
    }

    // ── Execute push ───────────────────────────────────────────
    const results = await this.executePush(userId, pushReq)

    this.jsonReply(res, 200, results)
  }

  // ── Core push logic ────────────────────────────────────────────

  /**
   * Send text + optional images to WeChat.
   * Harness: Fail locally — image failure doesn't block text.
   */
  private async executePush(userId: string, req: PushRequest): Promise<{
    ok: boolean
    textSent: boolean
    imagesSent: number
    imageErrors: string[]
  }> {
    const imageErrors: string[] = []
    let textSent = false
    let imagesSent = 0

    const text = req.text?.trim()

    // 1. Send text if present
    if (text) {
      try {
        await this.bot.send(userId, text)
        textSent = true
        console.log(`[push] Text sent to ${userId}: ${text.slice(0, 60)}...`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[push] Text send failed:`, msg)
        this.logPush({ ts: new Date().toISOString(), text, imageCount: req.images?.length ?? 0, success: false, error: msg })
        return { ok: false, textSent: false, imagesSent: 0, imageErrors: [msg] }
      }
    }

    // 2. Send images (best-effort with fallback)
    if (req.images && req.images.length > 0) {
      for (let i = 0; i < req.images.length; i++) {
        const img = req.images[i]
        try {
          const ok = await this.sendImage(userId, img)
          if (ok) {
            imagesSent++
            console.log(`[push] Image ${i + 1}/${req.images.length} sent (${img.mimeType})`)
          } else {
            const err = `Image ${i + 1}: sendImage not available or failed`
            imageErrors.push(err)
            console.warn(`[push] ${err}`)
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          imageErrors.push(`Image ${i + 1}: ${msg}`)
          console.error(`[push] Image ${i + 1} send error:`, msg)
        }
      }
    }

    const ok = textSent || imagesSent > 0
    this.logPush({ ts: new Date().toISOString(), text: text ?? '', imageCount: imagesSent, success: ok, error: imageErrors.length > 0 ? imageErrors.join('; ') : undefined })

    return { ok, textSent, imagesSent, imageErrors }
  }

  /**
   * Send a single image to WeChat using the documented wechatbot content format.
   * Returns true if successful, false otherwise.
   */
  private async sendImage(userId: string, image: ImagePayload): Promise<boolean> {
    try {
      await this.bot.send(userId, {
        image: Buffer.from(image.data, 'base64'),
      })
      return true
    } catch (e) {
      console.warn(`[push] image send failed:`, e instanceof Error ? e.message : String(e))
      return false
    }
  }

  // ── Harness: Constrain — Rate limiting ──────────────────────────

  private checkRateLimit(): boolean {
    const now = Date.now()
    const window = now - 60000 // 1 minute window
    this.pushTimestamps = this.pushTimestamps.filter((t) => t > window)
    if (this.pushTimestamps.length >= this.config.maxPushesPerMinute) {
      return false
    }
    this.pushTimestamps.push(now)
    return true
  }

  // ── Harness: Externalize state — Logging ────────────────────────

  private logPush(entry: PushLogEntry): void {
    if (!this.config.logPath) return
    try {
      appendFileSync(this.config.logPath, JSON.stringify(entry) + '\n', 'utf-8')
    } catch {
      // log write failure shouldn't crash
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private jsonReply(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    })
    res.end(json)
  }
}

// ── Utility ─────────────────────────────────────────────────────────

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })

    req.on('error', reject)
  })
}
