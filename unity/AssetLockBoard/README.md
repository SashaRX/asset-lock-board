# Asset Lock Board — Unity Package

Editor-only file locking for Unity teams (up to 10 people). Prevents merge conflicts by coordinating who is working on which files.

## Features

- **Project overlay** — lock/busy icons on assets in Project window (list & grid view)
- **Two modes** — 🔶 Busy (informational) and 🔒 Lock (blocks saving)
- **Save guard** — `AssetModificationProcessor` blocks saving files locked by others
- **Open guard** — warns when opening locked files, with read-only option
- **Context menu** — right-click any asset → Lock File / Free File
- **Hotkeys** — Ctrl+Alt+L (Lock), Ctrl+Alt+U (Free)
- **Editor Window** — Window → Asset Lock Board — full board view
- **Firebase sync** — same database as web app and Telegram bot

## Installation

**Window → Package Manager → + → Add package from git URL:**

```
https://github.com/SashaRX/asset-lock-board.git?path=unity/AssetLockBoard
```

## Setup

1. Open **Window → Asset Lock Board**
2. Enter your Telegram `@username`
3. Click **Connect** — finds your profile in Firebase

> You must log in via the [web app](https://sasharx.github.io/asset-lock-board/) at least once before connecting from Unity.

## How It Works

| Mode | Project Overlay | Open File | Save File |
|------|----------------|-----------|-----------|
| 🔶 Busy | Orange circle + name | Console log | Console warning, saves normally |
| 🔒 Lock | Red lock + name | Dialog: "Open read-only?" | **Blocked** — dialog "cannot save" |

- Files locked from web/Telegram appear in Unity within 5 seconds (polling)
- Files locked from Unity appear on web/Telegram instantly (Firebase write)

## Requirements

- Unity 2021.3+
- No dependencies — pure Editor scripts, no native plugins
- **Editor-only** — `asmdef` with `includePlatforms: ["Editor"]`, never ships in builds

## For Artists

This package is designed for artists who don't use version control GUIs. Install it, enter your username, and you'll see who's working on what directly in the Project window.

## License

MIT
