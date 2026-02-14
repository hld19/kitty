![Kitty banner](top.png)

<p align="center">
  <img src="build/icons/icon.png" alt="Kitty icon" width="120" />
</p>

<p align="center">
Cross-platform desktop music library and metadata manager with a floating dock, fast caching, tag/artwork/lyrics tools, and a built-in downloader (Cobalt + SoundCloud likes).
</p>

## Features
- Import by drag-and-drop or file picker (MP3/FLAC/WAV/OGG/M4A) @_@
- Edit tags: title, artist, album, disc/track numbers, genre, year, comments, lyrics
- Artwork editor: crop/zoom, brightness, saturation, blur, sharpen
- Lyrics editor and audio preview
- Cached library for quick startup
- Direct downloader powered by [cobalt](https://github.com/imputnet/cobalt) (MP3/OGG/WAV/OPUS, selectable bitrate)
- SoundCloud likes view with one-click downloads (auto-imports into Kitty)

## Tech Stack
- Backend: Go + Wails
- Frontend: React, TypeScript, Vite, TailwindCSS
- Audio/Metadata: beep/mp3, id3v2, dhowden/tag
- Core logic is Go; UI is mostly TS/TSX.

## Requirements
- [Go 1.21+](https://go.dev/doc/install)
- [Node.js 18+](https://nodejs.org/en/download) with pnpm or npm available on PATH (for the bundled cobalt API)
- Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

## SoundCloud Setup
SoundCloud requires your own app credentials.

1. Create a SoundCloud app and set the redirect URI to:
   - `http://127.0.0.1:17877/oauth/soundcloud/callback`
2. In Kitty: open `Settings` and paste your SoundCloud `Client ID` and `Client Secret`.
3. Go to `Downloader` → `SoundCloud Likes` and press `Connect`.

## Build from source (recommended)
- `./kitty install` – install Go and frontend dependencies
- `./kitty dev` – run with hot reload
- `./kitty build` – production build (clears macOS quarantine on the bundle)
- `./kitty clean` – remove build outputs

## Releases
- Windows: download `Kitty-Installer.exe` from [Releases](https://github.com/hld19/kitty/releases), run it, and launch Kitty from Start Menu/Desktop.
- macOS: download `Kitty.dmg` from [Releases](https://github.com/hld19/kitty/releases), drag Kitty to Applications, then right-click → Open (or `xattr -dr com.apple.quarantine /Applications/Kitty.app`) since the app is not notarized and i dont see the point of getting a developer id (for now).

## Project Structure
- `frontend/` — UI components, hooks, Tailwind styles
- `backend/` — audio, metadata, storage, analysis
- `api/` — bundled cobalt API source
- `app.go` / `main.go` — Wails bootstrap and bindings

## License
MIT – see [LICENSE](LICENSE).
