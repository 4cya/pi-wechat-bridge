#!/usr/bin/env node
/**
 * pi-wechat-bridge — WeChat ↔ Pi Agent multi-session bridge
 *
 * Usage:
 *   npx pi-wechat-bridge [--config sessions.json] [--force-login]
 *
 * Features:
 *   - /work /english /quant to switch Pi sessions (case-insensitive)
 *   - Image buffering (wait for text before sending to AI)
 *   - Per-session queue (non-blocking across sessions)
 *   - Reply prefix [session-name] for each AI response
 */

import { WeChatBot, stripMarkdown } from '@wechatbot/wechatbot'
import type { IncomingMessage } from '@wechatbot/wechatbot'
import { loadConfig, getSessionKeyword, isBoundSession } from './config.js'
import { parseRoute, extractPayload } from './router.js'
import { SessionPool } from './session-pool.js'
import { ImageBuffer, type ImageEntry } from './image-buffer.js'
import { PiAgentAdapter } from './pi-adapter.js'
import { PushServer } from './push-server.js'

// ── Parse CLI args ──────────────────────────────────────────────────

const args = process.argv.slice(2)
const configIndex = args.indexOf('--config')
const configPath = configIndex >= 0 ? args[configIndex + 1] : undefined
const forceLogin = args.includes('--force-login')

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════╗')
  console.log('║   pi-wechat-bridge v0.1.0           ║')
  console.log('╚══════════════════════════════════════╝\n')

  // 1. Load config
  let config = await loadConfig(configPath)
  console.log(`✓ Config loaded: ${Object.keys(config.sessions).length} sessions`)
  for (const [key, s] of Object.entries(config.sessions)) {
    console.log(`  /${getSessionKeyword(key)} (${s.cwd})${isBoundSession(s) ? '' : ' [unbound]'}`)
  }
  console.log(`  Default: ${config.defaultSession}`)

  // 2. Initialize Pi adapter
  const adapter = new PiAgentAdapter(configPath)
  console.log('\n⏳ Initializing Pi sessions...')

  // 3. Initialize WeChat bot
  const bot = new WeChatBot({ storage: 'file', logLevel: 'warn' })

  // 4. Per-session image buffers
  const imageBuffers = new Map<string, ImageBuffer>()
  const getBuffer = (key: string) => {
    if (!imageBuffers.has(key)) {
      imageBuffers.set(key, new ImageBuffer(5 * 60 * 1000))
    }
    return imageBuffers.get(key)!
  }

  // 5. Create session pool
  let currentSession = config.defaultSession

  const pool = new SessionPool(config, adapter, (sessionKey, sessionName, text) => {
    // Clean markdown for WeChat
    const clean = stripMarkdown(text)

    const keyword = getSessionKeyword(sessionKey)
    const prefix = config.replyPrefix ? `————[${keyword}]————\n\n` : ''
    const final = prefix + clean

    // Send to WeChat — note: we don't have the original msg here,
    // but we can send to the active user. The bot keeps track.
    // For simplicity, we use activeUserId stored during message handling.
    const userId = activeUserId
    if (userId && bot) {
      // We don't have context_token from original msg, so use send() with userId
      try {
        bot.send(userId, final).catch((e: Error) => {
          console.error(`Send error: ${e.message}`)
        })
      } catch (e) {
        console.error(`Send error:`, e)
      }
    }
  })

  await pool.init()

  // 6. Track active WeChat user
  let activeUserId: string | null = null

  // 6b. Initialize Push Server (independent of session logic)
  const pushServer = new PushServer(
    bot,
    config.pushServer,
    () => activeUserId,  // resolves target user at push time
  )
  pushServer.start()

  // 7. WeChat login
  console.log('\n⏳ Connecting to WeChat...')

  const creds = await bot.login({
    force: forceLogin,
    callbacks: {
      onQrUrl: (url) => {
        console.log('\n╔══════════════════════════════════════╗')
        console.log('║  Scan this QR code in WeChat:       ║')
        console.log('╚══════════════════════════════════════╝')
        console.log(url)
        console.log()
      },
      onScanned: () => console.log('✓ QR scanned — confirm in WeChat'),
      onExpired: () => console.log('✗ QR expired — requesting new one...'),
    },
  })

  console.log(`\n✓ Connected: ${creds.accountId}`)
  console.log(`  User: ${creds.userId}`)
  console.log('─'.repeat(50))
  console.log('Listening for WeChat messages...\n')

  // 8. Handle incoming WeChat messages
  bot.onMessage(async (msg: IncomingMessage) => {
    activeUserId = msg.userId
    config = await loadConfig(configPath)
    if (!config.sessions[currentSession]) {
      currentSession = config.defaultSession
    }

    try {
      await bot.sendTyping(msg.userId)
    } catch {
      // typing failure shouldn't block
    }

    // Build text and images from WeChat message
    const { text, images } = await extractMessageContent(msg, bot)

    if (!text && images.length === 0) {
      return // empty message
    }

    // Route the message
    const route = parseRoute(text ?? '', config, currentSession)

    switch (route.action) {
      case 'switch': {
        const newKey = route.targetSession!
        currentSession = newKey
        pool.switchTo(currentSession)
        // Clear image buffer on session switch
        getBuffer(currentSession).clear()

        // Extract payload after the command (e.g., "/English how are you" → "how are you")
        const sessionCfg = config.sessions[newKey]
        const payload = extractPayload(text!, sessionCfg.command!)
        const keyword = getSessionKeyword(newKey)

        if (payload) {
          console.log(`[${newKey}] → ${payload.slice(0, 80)}`)
          await sendReply(bot, msg, `已切换到 [${keyword}]`)
          await pool.send(payload, undefined, newKey)
        } else {
          await sendReply(bot, msg, `已切换到 [${keyword}]`)
        }
        return
      }

      case 'list': {
        await sendReply(bot, msg, route.message!)
        return
      }

      case 'route': {
        const sessionKey = route.targetSession!
        const sessionCfg = config.sessions[sessionKey]
        const buffer = getBuffer(sessionKey)
        const hasText = !!text
        const hasImages = images.length > 0

        if (!isBoundSession(sessionCfg)) {
          buffer.clear()
          await sendReply(bot, msg, `会话 [${getSessionKeyword(sessionKey)}] 未绑定，仅保留 push`)
          return
        }

        // Check expired buffer
        if (buffer.isExpired()) {
          buffer.clear()
          await sendReply(bot, msg, `会话 [${getSessionKeyword(sessionKey)}] 图片已过期，请重新发送`)
          return
        }

        // Only images, no text → cache
        if (hasImages && !hasText) {
          for (const img of images) {
            buffer.add(img)
          }
          console.log(`[${sessionKey}] Cached ${buffer.count} image(s), waiting for text...`)
          // Don't reply — wait for text
          return
        }

        // Text present → merge with buffered images, then send
        const allImages = [...buffer.flush(), ...images]
        const payload = extractPayload(text!, sessionCfg.command!)

        if (payload === null && allImages.length === 0) {
          // Pure switch command with no extra text — already handled above
          return
        }

        const finalText = payload ?? text ?? ''

        console.log(`[${sessionKey}] → ${finalText.slice(0, 80)}${allImages.length ? ` + ${allImages.length} image(s)` : ''}`)

        await pool.send(
          finalText,
          allImages.length > 0 ? allImages.map((i) => ({ data: i.data, mimeType: i.mimeType })) : undefined,
          sessionKey,
        )

        return
      }
    }
  })

  // 9. Bot lifecycle events
  bot.on('session:expired', () => {
    console.log('\n⚠ Session expired — re-login will happen automatically')
  })
  bot.on('session:restored', (c) => {
    console.log(`✓ Session restored: ${c.accountId}`)
  })
  bot.on('error', (err) => {
    console.error('⚠ Error:', err instanceof Error ? err.message : String(err))
  })

  // 10. Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...')
    await pushServer.stop()
    bot.stop()
    await pool.dispose()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...')
    await pushServer.stop()
    bot.stop()
    await pool.dispose()
    process.exit(0)
  })

  // 11. Start polling
  console.log('─'.repeat(50))
  bot.start().catch((e: Error) => {
    console.error('Poll error:', e.message)
  })
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

async function extractMessageContent(
  msg: IncomingMessage,
  bot: WeChatBot,
): Promise<{ text: string | null; images: ImageEntry[] }> {
  const images: ImageEntry[] = []

  switch (msg.type) {
    case 'text':
      return { text: msg.text, images: [] }

    case 'image': {
      try {
        const media = await bot.download(msg)
        if (media) {
          images.push({
            data: media.data.toString('base64'),
            mimeType: 'image/jpeg',
            receivedAt: Date.now(),
          })
        }
      } catch (e) {
        console.error('Image download error:', e)
      }
      // Image without text: return empty text, images cached
      const isTextCaption = msg.text && msg.text !== '[image]'
      return { text: isTextCaption ? msg.text! : null, images }
    }

    case 'voice': {
      const voice = msg.voices?.[0]
      if (voice?.text) {
        return { text: `[语音消息] ${voice.text}`, images: [] }
      }
      return { text: '[语音消息 — 无法识别]', images: [] }
    }

    case 'video': {
      const video = msg.videos?.[0]
      const duration = video?.durationMs
        ? ` (${Math.round(video.durationMs / 1000)}秒)`
        : ''
      return { text: `[视频消息${duration} — 暂不支持处理]`, images: [] }
    }

    case 'file': {
      const file = msg.files?.[0]
      const fileName = file?.fileName ?? 'unknown'
      const fileSize = file?.size ? ` (${formatFileSize(file.size)})` : ''
      return { text: `[文件: ${fileName}${fileSize} — 暂不支持处理]`, images: [] }
    }

    default:
      return { text: `[不支持的消息类型: ${msg.type}]`, images: [] }
  }
}

async function sendReply(bot: WeChatBot, msg: IncomingMessage, text: string): Promise<void> {
  try {
    await bot.reply(msg, text)
  } catch (e) {
    console.error('Reply error:', e instanceof Error ? e.message : e)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
