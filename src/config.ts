import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import type { PushServerConfig } from './push-server.js'
import { DEFAULT_PUSH_CONFIG } from './push-server.js'

export interface SessionBindingConfig {
  sessionFile?: string
}

export interface SessionConfig {
  name?: string
  cwd: string
  command?: string
  binding?: SessionBindingConfig
}

export interface BridgeConfig {
  defaultSession: string
  replyPrefix: boolean
  sessions: Record<string, SessionConfig>
  pushServer: PushServerConfig
}

export const DEFAULT_CONFIG_PATH = resolve(homedir(), '.pi', 'agent', 'pi-wechat-bridge.json')

export function getSessionKeyword(sessionKey: string): string {
  return sessionKey.toLowerCase()
}

export function getSessionCommand(sessionKey: string): string {
  return `/${getSessionKeyword(sessionKey)}`
}

export function isBoundSession(session?: SessionConfig): boolean {
  return !!session?.binding?.sessionFile
}

export async function loadConfig(configPath?: string): Promise<BridgeConfig> {
  const path = configPath ?? DEFAULT_CONFIG_PATH
  let raw: string

  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    console.error(`Config file not found: ${path}`)
    console.error('Create the bridge config file (see sessions.example.json)')
    process.exit(1)
  }

  const config: BridgeConfig = JSON.parse(raw)
  validateConfig(config)
  return config
}

function validateConfig(config: BridgeConfig): void {
  if (!config.sessions || Object.keys(config.sessions).length === 0) {
    console.error('Bridge config must define at least one session')
    process.exit(1)
  }

  const normalizedSessions: Record<string, SessionConfig> = {}

  for (const [rawKey, session] of Object.entries(config.sessions)) {
    if (!/^[a-z0-9]+$/i.test(rawKey)) {
      console.error(`Session key "${rawKey}" must use only english letters or digits`)
      process.exit(1)
    }

    const key = getSessionKeyword(rawKey)
    if (normalizedSessions[key]) {
      console.error(`Duplicate session keyword: ${key}`)
      process.exit(1)
    }
    if (!session.cwd) {
      console.error(`Session "${key}" missing "cwd"`)
      process.exit(1)
    }

    normalizedSessions[key] = {
      ...session,
      name: session.name ?? key,
      command: getSessionCommand(key),
      binding: session.binding ?? {},
    }
  }

  config.sessions = normalizedSessions

  const normalizedDefault = config.defaultSession
    ? getSessionKeyword(config.defaultSession)
    : Object.keys(config.sessions)[0]

  if (!normalizedDefault || !config.sessions[normalizedDefault]) {
    config.defaultSession = Object.keys(config.sessions)[0]
  } else {
    config.defaultSession = normalizedDefault
  }

  config.replyPrefix = config.replyPrefix !== false // default true

  config.pushServer = {
    ...DEFAULT_PUSH_CONFIG,
    ...(config.pushServer ?? {}),
  }
}
