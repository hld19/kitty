# Contributing to Kitty

Thanks for helping improve Kitty! Follow these quick guidelines to keep contributions smooth.

## Setup
1. Install Go 1.21+ and Node.js 18+.
2. Install Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`.
3. Install deps:
   ```bash
   npm install --prefix frontend
   go mod download
   ```

## Development
- Run the app with hot reload: `wails dev`.
- Lint/format: please keep Go code `gofmt`-clean and run your editor's formatter for TS/React.
- Tests: add or update tests where reasonable; manual QA for UI changes is appreciated.

## Pull Requests
- Keep PRs focused and small where possible.
- Describe the change, impact, and how you tested.
- Include before/after notes or screenshots for UI tweaks.

## Reporting Issues
- Use the bug report template.
- Include OS, repro steps, expected vs actual, and logs or screenshots where relevant.

By contributing, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
