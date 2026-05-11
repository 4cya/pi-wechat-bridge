/**
 * Pi Agent adapter — creates and manages Pi Agent sessions via the SDK.
 *
 * This is the default adapter. To support other agents (Claude Code, Codex, etc.),
 * implement the PiSessionFactory interface and swap this adapter.
 */

import { access } from 'node:fs/promises'
import type { PiSession, PiSessionFactory } from './session-pool.js'
import { DEFAULT_CONFIG_PATH, loadConfig } from './config.js'

// Lazy import — Pi SDK must be installed globally or locally
let createAgentSession: any = null
let SessionManager: any = null
let AuthStorage: any = null
let ModelRegistry: any = null

async function ensurePiSdk(): Promise<void> {
  if (createAgentSession) return

  // Try multiple possible package names (ecosystem variants)
  const tryPaths = [
    '@earendil-works/pi-coding-agent',
    '@mariozechner/pi-coding-agent',
    'pi-coding-agent',
  ]

  for (const pkg of tryPaths) {
    try {
      const mod = await import(pkg)
      createAgentSession = mod.createAgentSession
      SessionManager = mod.SessionManager
      AuthStorage = mod.AuthStorage
      ModelRegistry = mod.ModelRegistry
      console.log(`✓ Pi SDK loaded: ${pkg}`)
      return
    } catch {
      // try next
    }
  }

  throw new Error(
    'Pi Agent SDK not found. Install it:\n' +
    '  npm install -g @earendil-works/pi-coding-agent\n' +
    'Or set NODE_PATH to point to the global node_modules.',
  )
}

export class PiAgentAdapter implements PiSessionFactory {
  private authStorage: any
  private modelRegistry: any
  private initialized = false
  private configPath: string

  constructor(configPath?: string) {
    this.configPath = configPath ?? DEFAULT_CONFIG_PATH
  }

  async init(): Promise<void> {
    await ensurePiSdk()
    if (!this.initialized) {
      this.authStorage = AuthStorage.create()
      this.modelRegistry = ModelRegistry.create(this.authStorage)
      this.initialized = true
    }
  }

  async create(cwd: string, sessionKey: string): Promise<PiSession> {
    await this.init()

    return {
      prompt: async (text, images) => {
        const config = await loadConfig(this.configPath)
        const sessionCfg = config.sessions[sessionKey]
        const sessionFile = sessionCfg?.binding?.sessionFile

        if (!sessionFile) {
          throw new Error(`session [${sessionKey}] is not bound`)
        }

        await access(sessionFile)

        const sessionMgr = SessionManager.open(sessionFile)
        const { session } = await createAgentSession({
          sessionManager: sessionMgr,
          authStorage: this.authStorage,
          modelRegistry: this.modelRegistry,
          cwd,
        })

        return new Promise<string>((resolve, reject) => {
          let responseText = ''
          let resolved = false

          const finish = (value: string, isError = false) => {
            if (resolved) return
            resolved = true
            unsubscribe()
            try {
              session.dispose()
            } catch {
              // ignore
            }
            if (isError) {
              reject(new Error(value))
            } else {
              resolve(value)
            }
          }

          const unsubscribe = session.subscribe((event: any) => {
            try {
              if (event.type === 'message_update') {
                const ame = event.assistantMessageEvent
                if (ame?.type === 'text_delta') {
                  responseText += ame.delta ?? ''
                }
              }

              if (event.type === 'agent_end') {
                if (!responseText.trim() && event.messages) {
                  for (const msg of event.messages) {
                    if (msg.role === 'assistant') {
                      for (const block of msg.content) {
                        if (block.type === 'text') responseText += block.text
                      }
                    }
                  }
                }
                finish(responseText)
              }

              if (event.type === 'agent_error') {
                finish(event.error?.message ?? 'Agent error', true)
              }
            } catch (e) {
              finish(e instanceof Error ? e.message : String(e), true)
            }
          })

          const promptOptions: any = {}
          if (images && images.length > 0) {
            promptOptions.images = images.map((img) => ({
              type: 'image',
              source: {
                type: 'base64',
                mediaType: img.mimeType,
                data: img.data,
              },
            }))
          }

          session.prompt(text, promptOptions).catch((err: any) => {
            finish(err instanceof Error ? err.message : String(err), true)
          })

          setTimeout(() => {
            finish(responseText || '[No response — timeout]')
          }, 5 * 60 * 1000)
        })
      },

      dispose: () => {
        // No long-lived session kept in memory.
      },
    }
  }
}
