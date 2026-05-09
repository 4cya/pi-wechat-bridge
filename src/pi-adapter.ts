/**
 * Pi Agent adapter — creates and manages Pi Agent sessions via the SDK.
 *
 * This is the default adapter. To support other agents (Claude Code, Codex, etc.),
 * implement the PiSessionFactory interface and swap this adapter.
 */

import type { PiSession, PiSessionFactory } from './session-pool.js'

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

  async init(): Promise<void> {
    await ensurePiSdk()
    if (!this.initialized) {
      this.authStorage = AuthStorage.create()
      this.modelRegistry = ModelRegistry.create(this.authStorage)
      this.initialized = true
    }
  }

  async create(cwd: string, _sessionKey: string): Promise<PiSession> {
    await this.init()

    const sessionMgr = SessionManager.inMemory()

    const { session } = await createAgentSession({
      sessionManager: sessionMgr,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      cwd,
    })

    return {
      prompt: async (text, images) => {
        return new Promise<string>((resolve, reject) => {
          let responseText = ''
          let resolved = false

          const unsubscribe = session.subscribe((event: any) => {
            try {
              if (event.type === 'message_update') {
                const ame = event.assistantMessageEvent
                if (ame?.type === 'text_delta') {
                  responseText += ame.delta ?? ''
                }
              }

              if (event.type === 'agent_end') {
                if (!resolved) {
                  resolved = true
                  unsubscribe()
                  // Also collect from messages array as fallback
                  if (!responseText.trim() && event.messages) {
                    for (const msg of event.messages) {
                      if (msg.role === 'assistant') {
                        for (const block of msg.content) {
                          if (block.type === 'text') responseText += block.text
                        }
                      }
                    }
                  }
                  resolve(responseText)
                }
              }

              if (event.type === 'agent_error') {
                if (!resolved) {
                  resolved = true
                  unsubscribe()
                  reject(new Error(event.error?.message ?? 'Agent error'))
                }
              }
            } catch (e) {
              if (!resolved) {
                resolved = true
                unsubscribe()
                reject(e)
              }
            }
          })

          // Send the prompt
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
            if (!resolved) {
              resolved = true
              unsubscribe()
              reject(err)
            }
          })

          // Timeout after 5 minutes
          setTimeout(() => {
            if (!resolved) {
              resolved = true
              unsubscribe()
              resolve(responseText || '[No response — timeout]')
            }
          }, 5 * 60 * 1000)
        })
      },

      dispose: () => {
        try {
          session.dispose()
        } catch {
          // ignore
        }
      },
    }
  }
}
