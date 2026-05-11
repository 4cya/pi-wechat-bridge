# pi-wechat-bridge

<p align="center">
  <strong>在微信中管理多个 AI 编程会话</strong><br/>
  <sub>Pi Agent · Claude Code · Codex · OpenCode — 一个微信窗口全部切换</sub>
</p>

<p align="center">
  <a href="https://github.com/4cya/pi-wechat-bridge/blob/main/LICENSE"><img src="https://img.shields.io/github/license/4cya/pi-wechat-bridge?style=flat-square" alt="License"></a>
  <a href="https://github.com/4cya/pi-wechat-bridge"><img src="https://img.shields.io/github/stars/4cya/pi-wechat-bridge?style=flat-square" alt="Stars"></a>
  <a href="https://www.npmjs.com/package/pi-wechat-bridge"><img src="https://img.shields.io/npm/v/pi-wechat-bridge?style=flat-square&label=npm" alt="npm"></a>
</p>

---

[English](#english) | [中文](#中文)

## 中文

### 这是什么？

**pi-wechat-bridge** 是一个微信桥接器，让你在微信中同时管理多个 AI 编程助手会话。

你可以在一个微信聊天窗口里：
- 用 `/wechat` 切换到 `wechat`
- 用 `/english` 切换到 `english`
- 用 `/quant` 切换到 `quant`
- 指令不区分大小写：`/English` `/ENGLISH` 均可

不同会话之间**并发处理**，互不阻塞。每个会话都有自己的工作目录和规则。

### 为什么需要它？

| 痛点 | 解决方案 |
|---|---|
| 多个 AI 项目来回切终端很累 | 微信里 `/xxx` 一键切换 |
| 手机发图片给 AI，想配文字说明 | 先发图再发字，桥接自动合并 |
| 多个助手同时干活会互相等 | 不同 session 并发，不会阻塞 |
| 每个项目规则不同，不想混 | 每个 session 独立目录，`.pi/SYSTEM.md` 自治 |

### 两个仓库如何配合

- `pi-wechat-bridge`：微信桥接器，负责收消息、路由会话、push 推送。
- `pi-wechat-bridge-bind`：Pi package，负责把当前 Pi session 绑定到桥接器 keyword。
- 典型流程：先装桥接器，再在目标 Pi session 里执行 `/bind-wechat <keyword>`。

### 快速开始

```bash
# 1. 克隆
git clone https://github.com/4cya/pi-wechat-bridge.git
cd pi-wechat-bridge
npm install

# 2. 安装 Pi Agent（如果还没有）
npm install -g @earendil-works/pi-coding-agent

# 3. 创建全局配置
mkdir -p ~/.pi/agent
cp sessions.example.json ~/.pi/agent/pi-wechat-bridge.json
# 编辑 ~/.pi/agent/pi-wechat-bridge.json

# 4. 启动
npm start
# 或用 PM2 持久运行（自行创建 ecosystem.config.cjs）
```

> 微信接入基于 [@wechatbot/wechatbot](https://github.com/corespeed-io/wechatbot) — 扫码即连，支持文本、图片、语音、视频、文件。

### 会话指令

| 指令 | 作用 |
|---|---|
| `/wechat` | 切换到 wechat |
| `/english` | 切换到 english |
| `/quant` | 切换到 quant |
| `/list` | 列出已绑定的会话 |
| `/sessions` | 列出所有 keyword |
| `/help` | 显示帮助 |

### 图片缓存

1. 先发图片 → 桥接缓存（不发给 AI）
2. 再发文字 → 图片先保存到服务器临时目录，再把“图片路径 + 文字”发给 AI
3. 5 分钟无文字 → 图片过期自动清除

### 目录结构建议

```
/home/ubuntu/work/
├── AGENTS.md           ← 全局规则（所有子会话继承）
├── wechat/             ← /wechat 会话
│   └── .pi/
│       └── SYSTEM.md
├── english/            ← /english 会话
│   └── .pi/
│       └── SYSTEM.md
└── quant/              ← /quant 会话
    └── .pi/
        └── SYSTEM.md
```

### 绑定步骤示例

```bash
# 1) 安装桥接器
cd /home/ubuntu/work/pi-wechat-bridge && npm install && npm start

# 2) 安装绑定包（在你要绑定的 Pi session / 项目里）
pi install git:github.com/4cya/pi-wechat-bridge-bind@v0.1.0

# 3) 进入目标 Pi session 后执行
/bind-wechat english
```

### 兼容的 AI Agent

| Agent | 状态 |
|---|---|
| [Pi Agent](https://github.com/badlogic/pi-mono) | ✅ 原生支持 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | 🔜 适配器开发中 |
| [OpenAI Codex](https://github.com/openai/codex) | 🔜 适配器开发中 |
| [OpenCode](https://github.com/sst/opencode) | 🔜 适配器开发中 |

### 给 Agent 的安装提示

把下面这段直接发给 AI/Agent：

```text
请帮我安装并配置 pi-wechat-bridge：
1. 安装/更新桥接器仓库 git@github.com:4cya/pi-wechat-bridge.git
2. 安装 Pi package：pi install git:github.com/4cya/pi-wechat-bridge-bind@v0.1.0
3. 在目标 Pi session 中执行 /bind-wechat <keyword> 绑定当前 session
4. 如需解绑，执行 /unbind-wechat
5. 桥接器默认读取 ~/.pi/agent/pi-wechat-bridge.json，可用 PI_WECHAT_BRIDGE_CONFIG 覆盖
```

### 配置说明

默认配置文件：`~/.pi/agent/pi-wechat-bridge.json`，可用 `PI_WECHAT_BRIDGE_CONFIG` 覆盖

```json
{
  "defaultSession": "wechat",
  "replyPrefix": true,
  "sessions": {
    "wechat": {
      "cwd": "/home/ubuntu/work/wechat_assistant",
      "binding": {
        "sessionFile": "/home/ubuntu/.pi/agent/sessions/--home-ubuntu-work-wechat_assistant--/example.jsonl"
      }
    }
  }
}
```

- session key 就是 keyword，只允许英文字母/数字，命令自动生成为 `/<keyword>`
- `replyPrefix`: AI 回复第一行加 `[keyword]`，下一行开始正文（默认 true）
- `defaultSession`: 启动后默认使用的 keyword
- 只有已绑定 `binding.sessionFile` 的 session 才接收微信转发；未绑定仅保留 push
- 桥接器通过 `SessionManager.open(sessionFile)` 打开已绑定会话，回复仍通过 Pi SDK 回读

### 推送接口（外部服务 → 微信）

桥接程序启动后自动监听 HTTP 端口，外部服务（如市场监控 daemon）可通过 `/push` 端点向微信推送文字和图片消息。图片发送使用 `wechatbot` 文档中的 `bot.send(userId, { image })` 格式。**push 接口完全独立于 session 绑定系统，不受未绑定 session 限制。**

#### 配置

`~/.pi/agent/pi-wechat-bridge.json` 中 `pushServer` 字段：

```json
{
  "pushServer": {
    "enabled": true,
    "port": 9876,
    "host": "127.0.0.1",
    "authToken": "your-secret-token-change-me",
    "maxTextLength": 2000,
    "maxImages": 3,
    "maxPushesPerMinute": 10,
    "logPath": "./push-log.jsonl"
  }
}
```

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `enabled` | `false` | 是否启用推送服务器 |
| `port` | `9876` | HTTP 监听端口 |
| `host` | `127.0.0.1` | 绑定地址（建议仅本地） |
| `authToken` | — | Bearer Token 鉴权，为空则跳过鉴权 |
| `maxTextLength` | `2000` | 单次推送文本上限 |
| `maxImages` | `3` | 单次推送图片上限 |
| `maxPushesPerMinute` | `10` | 每分钟推送频率限制 |
| `logPath` | — | 推送日志文件路径 |

#### 调用示例

```bash
# 纯文字推送
curl -X POST http://127.0.0.1:9876/push \
  -H "Authorization: Bearer your-secret-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{"text": "BTC跌破65000，当前$64,800"}'

# 仅图片推送（text 可省略）
curl -X POST http://127.0.0.1:9876/push \
  -H "Authorization: Bearer your-secret-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{"images": [{"data": "iVBORw0...", "mimeType": "image/png"}]}'

# 文字 + 图片推送（图片为 base64）
curl -X POST http://127.0.0.1:9876/push \
  -H "Authorization: Bearer your-secret-token-change-me" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "BTC跌破65000",
    "images": [{"data": "iVBORw0...", "mimeType": "image/png"}]
  }'
```

#### 响应

| 状态码 | 说明 |
|--------|------|
| `200` | 推送成功 `{"ok":true,"textSent":true,"imagesSent":2}` |
| `400` | 参数校验失败（base64 格式错误、超长等） |
| `401` | 鉴权失败 |
| `429` | 频率限制 |
| `503` | 无活跃微信用户（需先向 bot 发一条消息） |

#### 与 market-watch 等监控工具对接

```python
import requests

def notify_wechat(text: str, images: list[dict] | None = None):
    return requests.post(
        "http://127.0.0.1:9876/push",
        headers={
            "Authorization": "Bearer your-secret-token",
            "Content-Type": "application/json",
        },
        json={"text": text, "images": images or []},
        timeout=10,
    ).json()
```

> ⚠️ **前置条件**: 用户须先在微信中向 bot 发送至少一条消息，桥接程序才能获取目标用户 ID 用于推送。

---

## English

### What is this?

**pi-wechat-bridge** connects WeChat to multiple AI coding agent sessions. Switch between projects, languages, and contexts — all from your phone.

### Features

- **Multi-session routing**: `/wechat` / `/english` / `/quant` — case-insensitive, instant switching
- **Persistent cwd binding**: each bridge session attaches to the latest Pi session in the same project directory
- **Concurrent processing**: each session runs independently, no blocking
- **Image buffering**: send images first, then text — merged automatically
- **Reply prefix**: first line uses `————[keyword]————`
- **Push API**: external services (e.g. market monitors) can push text + images to WeChat via HTTP
- **Pluggable adapters**: Pi Agent, Claude Code, Codex, OpenCode
- **Full WeChat media**: text, images, voice, video, files — powered by [@wechatbot/wechatbot](https://github.com/corespeed-io/wechatbot)

### Install & Run

```bash
git clone https://github.com/4cya/pi-wechat-bridge.git
cd pi-wechat-bridge && npm install
mkdir -p ~/.pi/agent
cp sessions.example.json ~/.pi/agent/pi-wechat-bridge.json
npm start
```

### PM2 (recommended for servers)

Create `ecosystem.config.cjs` with your local paths, then:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

See [PM2 documentation](https://pm2.keymetrics.io/) for more.

---

## Credits

Built on top of:
- [@wechatbot/wechatbot](https://github.com/corespeed-io/wechatbot) — WeChat iLink Bot SDK
- [Pi Agent](https://github.com/badlogic/pi-mono) — Minimal terminal coding agent

## Architecture

```
WeChat (phone)
    │
    ▼
iLink API ←── @wechatbot/wechatbot
    │
    ▼
┌──────────────────────────────────────────┐
│            pi-wechat-bridge               │
│                                           │
│  Router (/xxx)          Push Server (:9876)│
│    │                        │             │
│  Session Pool            POST /push       │
│   ├── [work]  ┌──────── external svc     │
│   ├── [english]        (market-watch,    │
│   └── [chat]            cron jobs, etc.) │
│    │                                      │
│  Pi Adapter (SDK)                        │
└──────────────────────────────────────────┘
```

## License

MIT © [4cya](https://github.com/4cya)
