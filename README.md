<div align="center">

# cue

**Открытый AI-помощник для Windows и macOS: видит ваш экран, слышит разговоры и помогает во время созвонов.**

Бесплатная self-hosted альтернатива Cluely. Работает с вашим API-ключом OpenAI, Anthropic, Google Gemini, NVIDIA или совместимого сервиса.

### [⬇ Скачать Cue для Windows](../../releases/latest) · [⬇ Скачать Cue для macOS](../../releases/latest)

[Все релизы](../../releases) · Версия исходников: **0.1.17** · Windows 10 (2004+) / Windows 11 · macOS (Intel и Apple Silicon)

<img src="docs/tutorial.png" width="620" alt="cue first-run tutorial" />

</div>

---

> [!IMPORTANT]
> **Please read this first.** cue tries to stay out of screen recordings/shares, but this is **best-effort, not guaranteed** — on macOS 15.4+ Apple can let modern capture tools see it anyway, and a phone camera always can. Using a hidden assistant during a **proctored exam, job interview, or recorded meeting** may break that platform's rules and, in some places, consent laws. cue is built for legitimate uses — your own notes, studying, accessibility, and practice. **You are responsible for how you use it.**
>
> On Zoom specifically, whether cue is hidden depends on one setting — **Settings → Share Screen → Screen capture mode → "Advanced capture with window filtering."**
>
> <img src="docs/zoom-capture-mode.png" width="560" alt="Zoom Settings → Share Screen → Screen capture mode set to Advanced capture with window filtering" />

---

## What it does

cue floats a small glass panel on top of everything. It takes **three separate inputs** — your **screen**, your **microphone**, and your **meeting audio** (what the other person says) — and uses an AI model to help you in real time.

Панели можно независимо переносить между мониторами; `Shift` перемещает всю видимую группу. Экран для анализа выбирается отдельно в заголовке чата. Расшифровка сворачивается в строку, показывает компактный конспект или раскрывается до поля ввода. В ответах ИИ указаны модель и режим. [Поведение окон, расшифровки и автоматических подписей говорящих](docs/WORKSPACE.md).

Во время записи в панели доступен живой конспект с каналами «Вы» и «Собеседник». «Помоги» даёт разовый ответ; отдельная «Автопомощь» предлагает ответы на вопросы собеседника автоматически. «Что ответить?» отвечает на последний неразрешённый вопрос любого участника. Текст в поле ввода имеет приоритет при нажатии быстрых действий. «Что спросить дальше?» предлагает вопросы. «Краткое резюме» во время записи показывает промежуточный итог в чате и оставляет встречу активной.

После остановки Cue сохраняет RAW, затем формирует итог по полной расшифровке без скриншота рабочего стола и сохраняет его в `A:\Cue Documents\*.md`. «Сохранить RAW» завершает запись без запроса к AI. При сбое итог можно повторить через «Итог» в незавершённых встречах. Продолжение записи обновляет RAW при следующем сохранении. На Windows Cue запускается вместе с системой.

Ответы для созвона используют короткие абзацы: прямой ответ, конкретный механизм и одно полезное пояснение или пример. Жёсткого лимита слов нет. В резюме сохраняются все существенные темы, решения, задачи и открытые вопросы без ограничения числа пунктов.

| Feature | How to trigger | What it uses |
|---|---|---|
| **Assist** | `⌘` `↵` or the *Assist* button | your screen + recent conversation |
| **What should I say?** | button | meeting audio + your mic |
| **Follow-up questions** | button | the whole conversation |
| **Recap** | button | the whole conversation |
| **Ask anything** | type + `↵` | your screen + conversation |
| **Solve a coding problem** | `⌘` `H` | your screen only |
| **Smart** toggle | pill in the box | switches to a smarter (slower) model |

It's a copilot for **live meetings** ("what do I say to that?") and **coding problems** (screenshot → full solution), and it's designed to be **invisible in screen shares** so it stays your private assistant.

---

## Install

### Windows 10 (2004+) and Windows 11

Download the latest installer from [Releases](../../releases), run `cue-0.1.0-windows-x64.exe`, and follow the setup wizard. The installer is currently unsigned, so Windows may show a SmartScreen warning.

To run from source:

```powershell
git clone https://github.com/amoorkie/cue-for-windows.git
Set-Location cue-for-windows
npm ci
npm start
```

Build the installer with `npm run dist:win`. The result is written to `dist\cue-<version>-windows-<arch>.exe`. See the full [Windows setup and troubleshooting guide](docs/WINDOWS.md).

### macOS

There are two ways to install cue on macOS. **If you're not a developer, use Option A.**

### Option A — Download the app (easiest)

1. Go to the [**Releases**](../../releases) page and download the matching ZIP: **`cue-<version>-mac-arm64.zip`** for Apple Silicon (M-series) or **`cue-<version>-mac-x64.zip`** for Intel Macs.
2. Open the ZIP and drag **`cue.app`** into your **Applications** folder.
3. **First open (important):** because cue is a free app without a paid Apple certificate, macOS will refuse to open it normally the first time. Do this once:
   - **Right-click** `cue.app` → **Open** → click **Open** in the dialog.
   - If macOS instead says **"cue is damaged and can't be opened,"** open the **Terminal** app and paste this line, then press Return:
     ```bash
     xattr -cr /Applications/cue.app
     ```
     Then double-click cue.app again. (This just tells macOS "yes, I trust this app I downloaded." It's safe.)

After the first approval, cue opens normally.

### Option B — Run from source (developers)

You need [Node.js](https://nodejs.org) 18+ installed. No Xcode required.

```bash
git clone https://github.com/amoorkie/cue-for-windows.git
cd cue-for-windows
npm install
npm start
```

To build your own `cue.app`:
```bash
npm run dist:mac  # creates Intel and Apple Silicon ZIP files in dist/
```
> Note: the packaged app is **ad-hoc signed** (no paid Apple certificate). macOS ties permission grants to the exact build, so **rebuilding resets the mic/screen permissions** — you'll grant them again. For everyday use, build once and keep it.

---

## First launch — the 1-minute setup

When cue opens the first time, a **built-in tutorial** walks you through everything below. You can reopen it anytime by clicking the **cue logo** (top-left of the pill). Here's the same thing in writing.

### Step 1 — Grant two macOS permissions

cue can't help until macOS lets it see and hear. When you first use a feature, macOS will prompt you — click **Allow**. If a prompt doesn't appear, add cue manually:

- **Microphone:** System Settings → **Privacy & Security** → **Microphone** → turn on **cue**.
- **Screen Recording:** System Settings → **Privacy & Security** → **Screen Recording** → turn on **cue**. (This one grant covers both screenshots *and* meeting audio.) macOS may ask you to **quit & reopen** cue — let it.

### Step 2 — Add your AI key (bring your own)

cue uses **your own** API key, so it's free to run (you only pay your AI provider for what you use). Click the **`...`** button in the input box (or press `⌘` `,`) to open **Settings**, pick a provider, and paste your key:

| Provider | Get a key | Notes |
|---|---|---|
| **OpenAI** | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) | One key does everything — **but** for the *listening* features the key must have **Whisper / audio** access (a "restricted" project key that only allows chat will give a 403 on transcription). |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | One key does chat + transcription. |
| **Custom** | Your gateway or local server | Must support both the selected chat/vision models and the configured audio transcription protocol. |

В настройках выберите расшифровку **«Через API»** или **«Локальная GigaAM»**. GigaAM обрабатывает звук на вашем ПК; ИИ-провайдер и его ключ используются для чата, подсказок и итогового анализа по распознанному тексту. Для установки GigaAM из Cue нужен Python 3.12+ и около 900 МБ для весов. Модель остаётся загруженной между фрагментами. [Настройка и ограничения локальной расшифровки](docs/LOCAL-STT.md).

В режиме API сохраняется одно подключение для расшифровки и чата. Модели, протоколы и авторизация доступны в **«Дополнительно»**. Пользовательский адрес должен поддерживать чат и, только при расшифровке через API, выбранный аудиопротокол. Перед отправкой данных на пользовательский адрес Cue требует отметить доверие к нему. HTTP разрешён только для локальных адресов компьютера; остальные адреса требуют HTTPS.

Your key is stored **only on your computer** (in `cue-data.json`) and is sent only to the official provider or custom destination you explicitly selected and trusted. cue has no server and collects nothing.

### Step 3 — The Zoom setting (only needed for Zoom)

cue is hidden from most screen-share tools automatically — **Google Meet, Microsoft Teams, and QuickTime need nothing.** **Zoom** has a specific setting that decides whether it respects cue's "don't capture me" flag:

> **Zoom → Settings → Share Screen → Advanced → Screen capture mode → choose "Advanced capture with window filtering."**

<div align="center"><img src="docs/zoom-setting.png" width="560" alt="Zoom screen capture mode setting" /></div>

**Why:** the *"...with window filtering"* modes tell Zoom to leave out windows that mark themselves as private — which is exactly what cue does. The **"Advanced capture without window filtering"** mode grabs the raw screen and **will show cue**, so avoid it.

---

## How to use it

- **`⌘` `↵` — Assist.** The do-the-smart-thing key. On a coding problem it solves it; in a conversation it tells you what to say. Works from anywhere.
- **`⌘` `H` — Solve what's on screen.** Screenshots a coding problem and returns the approach, code, and time/space complexity.
- **The Play button** (top bar) starts listening and changes to Stop. A green dot beside it means both audio inputs are live; amber means cue is still connecting or one input failed.
- **Type a question** in the box and press `↵` to ask about your screen or conversation.
- **Smart** — flip it on for a smarter, more thorough model; off for fast and cheap.
- **Hide** collapses the panel to just the top bar. Drag cue around by the **top pill**. Quit with `⌘` `⇧` `X`.

The panel is see-through and click-through — the empty space around it never blocks the app behind it.

---

## How it works (under the hood)

cue is an [Electron](https://www.electronjs.org/) app. Everything runs locally except the calls to your chosen AI provider.

**The three inputs are kept completely separate:**
- **Screen** — captured with Electron's `desktopCapturer` (full-resolution screenshots, taken only when a feature needs one).
- **Your mic ("You")** — `getUserMedia` → downsampled to 16 kHz audio → transcribed.
- **Meeting audio ("Them")** — `getDisplayMedia` loopback capture of your system's output audio, kept on its own channel so cue knows *who* said what.

Both audio streams are transcribed locally with GigaAM or through the selected audio API and fed, with an optional screenshot, to your AI model. Local mode emits short speech chunks after pauses or approximately every 4.4 seconds during continuous speech, plus inference time. Responses **stream** into the panel word-by-word. Follow-up questions retain recent chat history. Stopping a recording drains pending audio before saving RAW and requesting a final analysis.

**The invisibility** is enabled with Electron's `setContentProtection(true)`. On macOS this sets `NSWindowSharingNone`; on Windows 10 2004+ and Windows 11 it maps to `WDA_EXCLUDEFROMCAPTURE`. This asks the OS to exclude cue from compatible capture streams. It is **best-effort, not a guarantee**, so test the exact screen-sharing application and capture mode before relying on it.

```
main process ──┬─ overlay window (frameless, transparent, always-on-top, content-protected)
               ├─ screenshot capture (desktopCapturer)
               ├─ speech-to-text (Whisper / Gemini)      ── "You" + "Them" channels
               └─ LLM streaming (OpenAI / Anthropic / Gemini)
renderer ──────┴─ the glass UI + mic capture + system-audio loopback
```

---

## Troubleshooting

**"It says give access, but I already gave access."**
You probably granted an older build. Because the app is ad-hoc signed, a rebuild changes its identity and macOS stops honoring the old grant (the checkmark can linger). Toggle cue **off and on** in System Settings → Screen Recording, or remove and re-add it.

**A feature returns "403" / "no access to model."**
Your API key is restricted. Most often it's an OpenAI **project key that only allows chat models** — it works for screen/coding help but 403s on transcription (Whisper). Fix: enable audio/Whisper on the key, use an unrestricted key, or add a Gemini key (cue falls back to it for transcription).

**Listening does nothing / no transcript.**
For local transcription, use **Settings → Local GigaAM → Check**. Missing or damaged weights require installation of a complete model. No automatic cloud fallback occurs. For API transcription, check the selected audio model and key. Also check microphone/system-audio permissions.

**cue shows up in my Zoom share.**
Set Zoom's **Screen capture mode** to *"Advanced capture with window filtering"* (see Step 3). And remember: on macOS 15.4+ this can still fail — it's best-effort.

**"cue is damaged and can't be opened."**
Run `xattr -cr /Applications/cue.app` in Terminal once (see Install → Option A).

---

## Privacy

- No accounts, no servers, no telemetry. cue collects nothing.
- Your API keys live in a local file (`cue-data.json`) and are sent only to the official provider or custom destination you explicitly selected and trusted.
- In local GigaAM mode, audio is processed by a private local worker and is never sent to the chat API. Recognized text is sent when chat, assistance or final analysis runs; screenshots are used by the existing screen features. Transcripts and errors are saved in the local session journal. Raw audio is not saved.

## Contributing

Issues and PRs welcome. cue is intentionally small and readable — `main.js` (app + capture + AI), `renderer/` (the UI), `src/` (providers). No build step for the source (plain HTML/CSS/JS).

### Platform Support
- [x] **macOS** (Fully Supported)
- [x] **Windows** (Fully Supported)
- [ ] **Linux** (Untested)

### Features Open for Contribution
- [ ] Upgrade audio capture pipeline for zero-latency streaming
- [ ] Add optional Deepgram support for ultra-fast transcription

## Credits & license

Built as an open-source study of how tools like **Cluely** and **Interview Coder** work. Modeled on the open-source clones `pickle-com/glass` and `sohzm/cheating-daddy`.

**License: [GPL-3.0-or-later](LICENSE).**
