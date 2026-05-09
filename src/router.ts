import type { BridgeConfig, SessionConfig } from './config.js'

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

  // /sessions — list all sessions
  if (lower === '/sessions' || lower === '/list') {
    const list = Object.entries(config.sessions)
      .map(([key, s]) => `${s.command} → ${s.name} (${key})`)
      .join('\n')
    return {
      action: 'list',
      message: `可用会话：\n${list}\n\n当前：[${config.sessions[currentSession]?.name ?? currentSession}]`,
    }
  }

  // /help
  if (lower === '/help') {
    return {
      action: 'list',
      message: `指令说明：
/wechat /english /quant → 切换会话
/sessions → 列出所有会话
/help → 显示帮助
当前会话：[${config.sessions[currentSession]?.name ?? currentSession}]`,
    }
  }

  // Match /xxx command (case-insensitive)
  const match = trimmed.match(/^(\/[^\s]+)/)
  if (!match) {
    return { action: 'route', targetSession: currentSession }
  }

  const command = match[1].toLowerCase()

  for (const [key, session] of Object.entries(config.sessions)) {
    if (session.command.toLowerCase() === command) {
      if (key === currentSession) {
        return {
          action: 'route',
          targetSession: key,
          message: `已在当前会话 [${session.name}]`,
        }
      }
      return {
        action: 'switch',
        targetSession: key,
        displayName: session.name,
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
