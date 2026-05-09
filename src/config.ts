import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface SessionConfig {
  name: string
  cwd: string
  command: string
}

export interface BridgeConfig {
  defaultSession: string
  replyPrefix: boolean
  sessions: Record<string, SessionConfig>
}

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function loadConfig(configPath?: string): Promise<BridgeConfig> {
  const path = configPath ?? resolve(process.cwd(), 'sessions.json')
  let raw: string

  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    console.error(`Config file not found: ${path}`)
    console.error('Create a sessions.json file (see sessions.example.json)')
    process.exit(1)
  }

  const config: BridgeConfig = JSON.parse(raw)
  validateConfig(config)
  return config
}

function validateConfig(config: BridgeConfig): void {
  if (!config.sessions || Object.keys(config.sessions).length === 0) {
    console.error('sessions.json must define at least one session')
    process.exit(1)
  }

  const commands = new Set<string>()

  for (const [key, session] of Object.entries(config.sessions)) {
    if (!session.cwd) {
      console.error(`Session "${key}" missing "cwd"`)
      process.exit(1)
    }
    if (!session.command) {
      console.error(`Session "${key}" missing "command"`)
      process.exit(1)
    }
    if (!session.name) {
      session.name = key
    }
    if (!session.command.startsWith('#')) {
      session.command = '#' + session.command
    }
    if (commands.has(session.command)) {
      console.error(`Duplicate command: ${session.command}`)
      process.exit(1)
    }
    commands.add(session.command)
  }

  if (!config.defaultSession || !config.sessions[config.defaultSession]) {
    // Use first session as default
    config.defaultSession = Object.keys(config.sessions)[0]
  }

  config.replyPrefix = config.replyPrefix !== false // default true
}
