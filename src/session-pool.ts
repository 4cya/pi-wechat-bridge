import type { SessionConfig, BridgeConfig } from './config.js'
import { getSessionCommand, getSessionKeyword } from './config.js'
import type { ImageEntry } from './image-buffer.js'

// ── Pi Session abstraction ─────────────────────────────────────────

export interface PiSession {
  /** Send a prompt and get the AI response */
  prompt(text: string, images?: { data: string; mimeType: string }[]): Promise<string>
  /** Clean up resources */
  dispose(): void
}

export interface PiSessionFactory {
  create(cwd: string, sessionKey: string): Promise<PiSession>
}

// ── Session entry with queue ────────────────────────────────────────

interface SessionEntry {
  config: SessionConfig
  key: string
  pi: PiSession
  processing: Promise<void>
}

export class SessionPool {
  private sessions = new Map<string, SessionEntry>()
  private currentKey: string
  private config: BridgeConfig
  private factory: PiSessionFactory
  private onResponse: (sessionKey: string, sessionName: string, text: string) => void

  constructor(
    config: BridgeConfig,
    factory: PiSessionFactory,
    onResponse: (sessionKey: string, sessionName: string, text: string) => void,
  ) {
    this.config = config
    this.factory = factory
    this.currentKey = config.defaultSession
    this.onResponse = onResponse
  }

  /** Initialize all sessions */
  async init(): Promise<void> {
    const entries = await Promise.all(
      Object.entries(this.config.sessions).map(async ([key, session]) => {
        const pi = await this.factory.create(session.cwd, key)
        return [key, { config: session, key, pi, processing: Promise.resolve() }] as const
      }),
    )
    for (const [key, entry] of entries) {
      this.sessions.set(key, entry)
    }
    console.log(`✓ ${this.sessions.size} sessions initialized`)
  }

  get current(): string {
    return this.currentKey
  }

  getSessionName(key: string): string {
    return getSessionKeyword(key)
  }

  getAvailableCommands(): string {
    return Object.keys(this.config.sessions)
      .map((key) => getSessionCommand(key))
      .join(' ')
  }

  switchTo(key: string): string {
    if (!this.sessions.has(key)) {
      return `未知会话 "${key}"，可用：${this.getAvailableCommands()}`
    }
    this.currentKey = key
    return `已切换到 [${getSessionKeyword(key)}]`
  }

  /** Queue a prompt to the current session. Returns immediately, response via callback. */
  async send(
    text: string,
    images?: { data: string; mimeType: string }[],
    sessionKey?: string,
  ): Promise<void> {
    const key = sessionKey ?? this.currentKey
    const entry = this.sessions.get(key)
    if (!entry) {
      this.onResponse(key, key, `会话 "${key}" 未配置`)
      return
    }

    const sessionName = getSessionKeyword(key)

    // Chain: wait for previous processing to finish, then run this one
    const prev = entry.processing
    entry.processing = prev.then(async () => {
      try {
        const response = await entry.pi.prompt(text, images)
        if (response.trim()) {
          this.onResponse(key, sessionName, response)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[${key}] Prompt error:`, msg)
        this.onResponse(key, sessionName, `处理出错：${msg}`)
      }
    })

    // Don't await — return immediately so multiple sessions can process concurrently
  }

  /** Dispose all sessions */
  async dispose(): Promise<void> {
    for (const [key, entry] of this.sessions) {
      try {
        entry.pi.dispose()
      } catch {
        // ignore
      }
    }
    this.sessions.clear()
  }
}
