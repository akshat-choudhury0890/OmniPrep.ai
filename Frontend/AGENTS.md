<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- The backend is a separate Express server; all calls go through `src/lib/api/client.ts` using `VITE_API_BASE_URL`. Why: keeps UI decoupled from backend deployment.
- `API_CONTRACT.md` + `src/lib/api/types.ts` are the shared contract; change both together. Why: frontend and backend are built independently.
- Chat UI uses custom components + react-markdown instead of AI Elements. Why: backend returns a non-streaming JSON contract (answer/sources/resources), not an AI SDK stream.
- Never show mock or simulated data in the production flow; surface real backend errors. Why: product requirement against fabricated answers/citations.
- LofiPlayer is mounted in `__root.tsx`. Why: playback persists across route changes.
