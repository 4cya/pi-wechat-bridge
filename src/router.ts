import type { BridgeConfig } from './config.js'
import { getSessionCommand, getSessionKeyword } from './config.js'

export interface RouteResult {
  action: 'switch' | 'route' | 'list' | 'unknown'
  targetSession?: string
  displayName?: string
  message?: string    // for unknown commands or list
}

/**
 * Parse incoming WeChat message for /xxx routing commands (case-insensitive).
 */
export function parseRoute(
  text: string,
  config: BridgeConfig,
  currentSession: string,
): RouteResult {
  const trimmed = text.trim()

  const lower = trimmed.toLowerCase()

  // /list — list bound sessions only
  if (lower === '/list') {
    const list = Object.keys(config.sessions)
      .filter((key) => !!config.sessions[key]?.binding?.sessionFile)
      .map((key) => getSessionCommand(key))
      .join('\n')
    return {
      action: 'list',
      message: list
        ? `已绑定的会话列表：\n${list}`
        : '已绑定的会话列表：\n暂无',
    }
  }

  // /sessions — list all sessions
  if (lower === '/sessions') {
    const list = Object.keys(config.sessions)
      .map((key) => getSessionCommand(key))
      .join('\n')
    return {
      action: 'list',
      message: `所有会话：\n${list}\n当前：[${getSessionKeyword(currentSession)}]`,
    }
  }

  // /help
  if (lower === '/help') {
    const commands = Object.keys(config.sessions)
      .map((key) => getSessionCommand(key))
      .join(' ')
    return {
      action: 'list',
      message: `指令说明：\n${commands} → 切换会话\n/sessions → 列出所有会话\n/help → 显示帮助\n当前会话：[${getSessionKeyword(currentSession)}]`,
    }
  }

  // Match /xxx command (case-insensitive)
  const match = trimmed.match(/^(\/[^\s]+)/)
  if (!match) {
    return { action: 'route', targetSession: currentSession }
  }

  const command = match[1].toLowerCase()

  for (const [key] of Object.entries(config.sessions)) {
    if (getSessionCommand(key) === command) {
      if (key === currentSession) {
        return {
          action: 'route',
          targetSession: key,
          message: `已在当前会话 [${getSessionKeyword(key)}]`,
        }
      }
      return {
        action: 'switch',
        targetSession: key,
        displayName: getSessionKeyword(key),
      }
    }
  }

  // Unknown /command — treat as regular message
  return { action: 'route', targetSession: currentSession }
}

/**
 * Strip the routing command from the message, returning the payload to send to AI.
 * If the whole message is just a switch command, returns null.
 */
export function extractPayload(text: string, command: string): string | null {
  const trimmed = text.trim()

  // If the whole message is just the command (e.g., "/work"), return null
  if (trimmed.toLowerCase() === command.toLowerCase()) {
    return null
  }

  // If the command is followed by text, strip the command prefix
  if (trimmed.toLowerCase().startsWith(command.toLowerCase())) {
    const rest = trimmed.slice(command.length).trim()
    return rest || null
  }

  return trimmed
}
