# Blueberry Music Player

Blueberry Music Player is a desktop music player built with Electron and vanilla JavaScript. It focuses on local playback, playlist management, and a simple offline-first listening experience.

## Tech Stack

- Electron
- Vanilla JavaScript
- HTML and CSS
- Howler.js for audio playback
- jsmediatags for metadata
- SortableJS for drag-and-drop playlist ordering
- TanStack Virtual Core for large playlist rendering
- Electron Store for local persistence
- Electron Builder for packaging

## Getting Started

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

Run the app normally:

```bash
npm start
```

## Development

The development command uses Nodemon:

```bash
npm run dev
```

Nodemon watches JavaScript, JSON, HTML, and CSS files. In development builds, the app also starts a UI watcher so changes under `ui/` reload the Electron window.

## Build

Create a Windows installer:

```bash
npm run build
```

Build output is written to `dist/`.

## Project Structure

```text
.
|-- main.js                 # Electron main process and IPC handlers
|-- preload.js              # Safe bridge between Electron and the renderer
|-- package.json            # Scripts, dependencies, and build config
|-- ui/
|   |-- index.html          # Renderer entry HTML
|   |-- script.js           # Renderer app routing and initialization
|   |-- watcher.js          # Development UI reload watcher
|   |-- components/         # Shared UI components
|   |-- pages/              # App pages: library, playlist, queue, about
|   |-- services/           # Audio and session services
|   |-- state/              # Player state
|   `-- utils/              # Shared utility modules
`-- .github/workflows/      # Release workflow
```

## Scripts

| Command         | Description                                     |
| --------------- | ----------------------------------------------- |
| `npm run dev`   | Start Electron through Nodemon for development. |
| `npm start`     | Start the Electron app.                         |
| `npm run clean` | Remove the `dist/` directory.                   |
| `npm run build` | Clean and build the Windows installer.          |

## Packaging Notes

Electron apps include Chromium and Node.js, so installer size can be larger than a typical native desktop app. This project trims packaged files through the Electron Builder `files` config, but output size is still expected to be relatively large.

## Roadmap

- Audio normalization.
- Shuffle, repeat, and play-next controls.
- More queue management options.
- Better responsive layout and accessibility.
- Further package-size optimization.

## License

ISC
