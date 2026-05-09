# pi-wechat-bridge

WeChat ↔ Pi Agent multi-session bridge.  
One WeChat window, multiple Pi sessions, non-blocking concurrent processing.

## Features

- **Multi-session routing**: `#work` / `#chat` / `#english` to switch Pi sessions
- **Per-session queue**: messages within a session queue up, different sessions run concurrently
- **Image buffering**: send images first, then text — bridge merges them before sending to AI
- **Reply prefix**: each AI response prefixed with `[session-name]`
- **Pluggable agent adapter**: supports Pi Agent out of the box; Claude Code / Codex / OpenCode adapters can be added
- **All WeChat media**: text, images, voice, video, files (powered by @wechatbot/wechatbot)

## Install

```bash
git clone https://github.com/4cya/pi-wechat-bridge.git
cd pi-wechat-bridge
npm install
```

Requires Pi Agent SDK (global install):
```bash
npm install -g @earendil-works/pi-coding-agent
```

## Quick Start

### 1. Create sessions.json

```bash
cp sessions.example.json sessions.json
```

Edit `sessions.json` to define your sessions:

```json
{
  "defaultSession": "chat",
  "replyPrefix": true,
  "sessions": {
    "chat": {
      "name": "聊天",
      "cwd": "/home/ubuntu/work/wechat",
      "command": "#chat"
    },
    "work": {
      "name": "工作",
      "cwd": "/home/ubuntu/work/code",
      "command": "#work"
    }
  }
}
```

- `cwd`: Pi session working directory (loads AGENTS.md, .pi/ rules from here)
- `command`: the `#xxx` keyword to switch to this session
- `replyPrefix`: whether to prefix AI replies with `[session-name]`

### 2. Start the bridge

```bash
npm start
# or: npx tsx src/index.ts
```

### 3. Scan QR code in WeChat

The bridge prints a QR code. Scan it with WeChat to connect.

### 4. Start chatting

```
You: #work
Bot: [工作]
     已切换到 [工作]

You: 帮我看看这个 bug
Bot: [工作]
     (Pi processes in /home/ubuntu/work/code...)

You: #english
Bot: [英语]
     已切换到 [英语]

You: how to say...
Bot: [英语]
     (Pi processes in /home/ubuntu/work/english...)
```

## Session Commands

| Command | Action |
|---|---|
| `#work` | Switch to work session |
| `#chat` | Switch to chat session |
| `#english` | Switch to English session |
| `#sessions` | List all sessions |
| `#help` | Show help |

## Image Caching

1. Send images → bridge caches them (no AI response)
2. Send text → bridge merges images + text → sends to AI
3. Images expire after 5 minutes if no text follows

## Session Rules

Each session's behavior (reply style, language, constraints) is managed **in its own directory**:

```
/home/ubuntu/work/wechat/
├── .pi/
│   └── SYSTEM.md     # WeChat session rules
├── AGENTS.md         # Context file

/home/ubuntu/work/code/
├── .pi/
│   └── SYSTEM.md     # Work session rules
```

The bridge does NOT inject additional prompts — each session directory controls its own behavior.

## Multi-Agent Support

The bridge uses an adapter pattern. To add support for other agents:

```typescript
// Implement PiSessionFactory for your agent
class ClaudeCodeAdapter implements PiSessionFactory {
  async create(cwd: string, sessionKey: string): Promise<PiSession> {
    // Spawn claude CLI subprocess, manage conversation
  }
}

// Pass to SessionPool
const pool = new SessionPool(config, new ClaudeCodeAdapter(), onResponse)
```

Currently supported:
- ✅ Pi Agent (via SDK)
- 🔜 Claude Code (planned)
- 🔜 Codex (planned)

## License

MIT
