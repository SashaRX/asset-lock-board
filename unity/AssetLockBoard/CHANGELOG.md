# Changelog

## [1.0.0] - 2026-04-11

### Added
- Editor Window with full lock board (Window → Asset Lock Board)
- Project window overlay — lock/busy icons on assets (list & grid view)
- Two lock modes: 🔶 Busy (informational) and 🔒 Lock (blocks saving)
- `AssetModificationProcessor` — blocks saving files locked by others (lock mode only)
- `IsOpenForEdit` — marks locked files as read-only in Unity
- `OnOpenAsset` — warns when opening locked files with read-only option
- Context menu: Assets → Lock File / Free File
- Hotkeys: Ctrl+Alt+L (Lock), Ctrl+Alt+U (Free)
- Setup flow: connect by Telegram @username
- Firebase REST API polling (5s interval)
- UPM package support (install via git URL)
- Editor-only asmdef — never ships in builds
