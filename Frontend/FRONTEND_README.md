# OmniPrep.ai — Frontend

React + Vite (TanStack Start/Router) UI for OmniPrep.ai. Talks to the separate Express backend described in `API_CONTRACT.md`.

## Run
```bash
bun install        # or npm install
cp .env.example .env   # set VITE_API_BASE_URL to your Express server
bun run dev
```

## Environment
| var | purpose |
|---|---|
| `VITE_API_BASE_URL` | Express backend origin, e.g. `http://localhost:4000`. Public — never put secrets in `VITE_*`. |

Without it, the app shows a "Backend not connected" banner and every action shows a real error (no fake data).

## Assets
- Hero art: `src/assets/lofi-study-room.jpg` (generated for this project; swap freely).
- Music: put `lofi-1.mp3`, `lofi-2.mp3`, `lofi-3.mp3` in `public/audio/`, or edit `src/lib/playlist.ts`.

## Structure
- `src/lib/api/` — typed API client + contract types
- `src/hooks/use-documents.ts` — document list (polls while processing), delete
- `src/components/landing/LandingPage.tsx`
- `src/components/chat/` — ChatPage, DocumentPanel (uploader + list), ChatParts (messages, input, sources), StudyResourcesPanel
- `src/components/LofiPlayer.tsx` — persistent player mounted in the root layout
