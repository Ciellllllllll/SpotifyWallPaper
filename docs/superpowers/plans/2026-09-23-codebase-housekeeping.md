# Codebase Housekeeping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up five structural issues identified in a code review: retire dead backend code, correct README/docs claims about WASM, decompose the god-object runtime, consolidate excessive documentation, and tidy AI-agent scaffolding references.

**Architecture:** Each task is an independent cleanup that does not change runtime behavior. Tasks 1-2 remove/update files, Task 3 is a structural refactor with existing tests as safety net, Tasks 4-5 are documentation-only. All tasks should leave `npm test`, `npm run check`, `npm run build`, `cargo check --workspace`, and `cargo test --workspace` green.

**Tech Stack:** TypeScript, Svelte, Vite, Rust, wasm-pack

**Spec:** This plan is self-contained; it implements the five findings from the 2026-09-23 code review.

## Global Constraints

- Node.js 22+, Rust stable, `wasm32-unknown-unknown` target.
- No runtime behavior changes — tests must remain green with no modifications to test assertions.
- `apps/wallpaper/src/runtime/wallpaperRuntime.test.ts` (1,550 lines) is the safety net for Task 3; every existing test must pass without assertion changes.
- Never commit Spotify tokens, Client Secrets, or credential material.
- Retain `apps/backend/` as-is (confirmed optional loopback-only local development tool per `docs/02`).

## Review Focus

1. **Task 3 snapshot shape:** If the refactored runtime changes the order of `emit()` calls or the snapshot contents at any intermediate step, existing subscribers would see different state sequences — verify the 1,550-line test file catches this.
2. **Task 3 circular imports:** Extracting modules from the closure could accidentally create circular imports between the new files and `wallpaperRuntime.ts` — run `npx madge --circular apps/wallpaper/src/runtime/` after the split.
3. **Task 4 link integrity:** Removing docs that other docs reference will produce dead links — `grep -r` the removed filenames across `docs/` and `README.md` before committing.
4. **Task 1 Cargo.toml workspace members:** Removing `apps/public-backend` source might leave a phantom workspace member in root `Cargo.toml` — check and clean.
5. **Task 2 wasm-pack build path:** If README wording changes the documented `wasm-pack build` command or output path, users following the guide could get build errors — keep the exact command unchanged.

---

### Task 1: Remove dead `apps/public-backend` and clean stale operations docs

The hosted public backend was retired on 2026-09-21. `apps/public-backend/` has zero git-tracked source files (only four `.wrangler*.generated.json` config files remain tracked). The four `docs/operations/cloudflare-worker-*.md` files and `docs/release-notes-public-backend-beta.md` are all archived stubs referencing the deleted Cloudflare Worker and VPS deployment. `docs/25-public-backend.md` serves as the retirement record and stays.

**Files:**
- Delete: `apps/public-backend/` (entire directory — 4 tracked `.wrangler*.generated.json` files plus untracked build artifacts)
- Delete: `docs/operations/cloudflare-worker-deploy.md`
- Delete: `docs/operations/cloudflare-worker-incident-response.md`
- Delete: `docs/operations/cloudflare-worker-key-rotation.md`
- Delete: `docs/operations/cloudflare-worker-restore.md`
- Delete: `docs/release-notes-public-backend-beta.md`
- Delete: `docs/phase-reports/cloudflare-worker-public-backend.md`
- Modify: `docs/02-repository-structure.md` (remove `apps/public-backend` section if present)
- Check: root `Cargo.toml` and `package.json` for any public-backend workspace references

**Interfaces:**
- Consumes: nothing
- Produces: cleaner tree; no interface changes

- [ ] **Step 1: Verify no runtime code imports from public-backend**

```bash
grep -r "public-backend" apps/wallpaper/src/ apps/configurator/src/ apps/spotify-auth/src/ packages/ crates/ || echo "No references found"
```

Expected: no references.

- [ ] **Step 2: Check root workspace files for public-backend references**

```bash
grep -n "public-backend" package.json Cargo.toml
```

Expected: no references (public-backend is a Node project, not in Cargo workspace, and likely not in npm workspaces since it had its own Cloudflare wrangler setup).

- [ ] **Step 3: Check docs cross-references to files being deleted**

```bash
grep -rl "cloudflare-worker-deploy\|cloudflare-worker-incident\|cloudflare-worker-key-rotation\|cloudflare-worker-restore\|release-notes-public-backend-beta\|cloudflare-worker-public-backend" docs/ README.md
```

For each reference found, update it to point to `docs/25-public-backend.md` (the retirement record) or remove the reference.

- [ ] **Step 4: Remove tracked files**

```bash
git rm -r apps/public-backend/
git rm docs/operations/cloudflare-worker-deploy.md
git rm docs/operations/cloudflare-worker-incident-response.md
git rm docs/operations/cloudflare-worker-key-rotation.md
git rm docs/operations/cloudflare-worker-restore.md
git rm docs/release-notes-public-backend-beta.md
git rm docs/phase-reports/cloudflare-worker-public-backend.md
```

- [ ] **Step 5: Remove empty `docs/operations/` directory if no files remain**

```bash
ls docs/operations/ 2>/dev/null && echo "Still has files" || git rm -r docs/operations/ 2>/dev/null; rmdir docs/operations 2>/dev/null
```

- [ ] **Step 6: Run verification**

```bash
npm run check && npm test && npm run build && cargo check --workspace
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: remove retired public-backend and stale operations docs

The hosted Cloudflare Worker/VPS backend was retired on 2026-09-21.
Remove the orphaned tracked config files, archived operations runbooks,
and the cloudflare-worker phase report. docs/25-public-backend.md
remains as the retirement record."
```

---

### Task 2: Correct README/docs claims about Rust WASM core

The README and `docs/12-rust-wasm-core.md` position Rust/WASM as a "visual core", but the crate is only 203 lines providing two utility functions (`normalize_visualizer` and `readability`). The real visualizer logic lives in TypeScript. The docs should accurately describe the Rust layer as an optional performance helper, not a core engine.

**Files:**
- Modify: `README.md` — "Technical Stack" section and WASM-related paragraphs
- Modify: `docs/12-rust-wasm-core.md` — title and responsibilities description
- Modify: `docs/02-repository-structure.md` — `crates/visual-core/` description

**Interfaces:**
- Consumes: nothing
- Produces: accurate documentation; no code changes

- [ ] **Step 1: Update README.md Technical Stack section**

Change:
```
- Visual core: Rust compiled to WebAssembly for typed-array visual normalization and readability helpers.
```
To:
```
- Optional WASM helpers: Rust compiled to WebAssembly for visualizer sample normalization and theme readability calculation. The wallpaper runs with TypeScript fallbacks when WASM is absent.
```

- [ ] **Step 2: Update docs/12-rust-wasm-core.md title and description**

Change the title from `# Rust WASM Core` to `# Rust WASM Helpers`.

Update the opening to:
```markdown
## Responsibilities

Rust/WASM provides optional performance-path helpers. The wallpaper runs
with TypeScript fallback logic when WASM binaries are absent.

Current functions:
- `normalize_visualizer`: visualizer sample smoothing, decay, clamping,
  and noise gating (returns typed Float32Array for zero-copy hot path)
- `readability`: WCAG-based text color, overlay opacity, and shadow
  strength for a given background RGB

All visualizer rendering (SVG generation, bar/path layout, animation,
Canvas effects) and all theme extraction (album pixel sampling, color
selection) remain TypeScript-owned.
```

- [ ] **Step 3: Update docs/02-repository-structure.md visual-core entry**

Change:
```
- `crates/visual-core/`
  Rust pure logic crate. The current boundary exposes only measured visual
  normalization/readability algorithms through typed arrays. Settings,
  layout, and safe-area semantics remain TypeScript-owned.
```
To:
```
- `crates/visual-core/`
  Optional Rust WASM helpers: visualizer sample normalization and theme
  readability calculation, exposed as typed-array functions. Two functions,
  ~200 lines. The wallpaper uses TypeScript fallbacks when WASM is absent.
```

- [ ] **Step 4: Verify no broken references**

```bash
grep -rn "Rust WASM Core" docs/ README.md
```

Update any remaining references to use the new name.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/12-rust-wasm-core.md docs/02-repository-structure.md
git commit -m "docs: accurately describe Rust WASM as optional helpers, not a core

The Rust crate provides two utility functions (~200 lines) with TypeScript
fallbacks. Update README and docs to reflect the actual scope instead of
implying a visual engine."
```

---

### Task 3: Decompose `wallpaperRuntime.ts` god object

Extract cohesive subsystems from the 798-line closure into focused modules. The runtime keeps its public interface (`WallpaperRuntime`) unchanged — only internal implementation moves. The existing 1,550-line test file must pass without assertion changes, confirming behavioral equivalence.

**Decomposition plan:**

| New file | Responsibility | Lines (approx) |
|---|---|---|
| `runtime/runtimeTheme.ts` | `updateTheme()`, `requestAlbumExtraction()` closure, visualizer color logic | ~100 |
| `runtime/runtimeAudio.ts` | `acceptAudioFrame` logic, `acceptIdleFrame`, `startVisualizers`, silence tracking, motion release | ~120 |
| `runtime/runtimePolling.ts` | `poll()`, `configureProvider()`, `providerKey()`, `clearProvider()` | ~100 |
| `runtime/runtimeCredentials.ts` | `storageFailed()`, `acceptStored()`, credential epoch/queue logic | ~80 |
| `runtime/runtimeTypes.ts` | `WallpaperRuntimeSnapshot`, `DeepReadonly`, `ReadonlyWallpaperRuntimeSnapshot`, `WallpaperRuntime` interface, `WallpaperRuntimeDependencies`, `deepFreeze`, `sanitizeProviderError`, `safeProviderErrorMessage`, `retainsPlaybackEligibility` | ~80 |

`wallpaperRuntime.ts` retains `createWallpaperRuntime()` as the orchestrator, calling into extracted modules. It shrinks from ~798 to ~300 lines.

**Files:**
- Create: `apps/wallpaper/src/runtime/runtimeTypes.ts`
- Create: `apps/wallpaper/src/runtime/runtimeTheme.ts`
- Create: `apps/wallpaper/src/runtime/runtimeAudio.ts`
- Create: `apps/wallpaper/src/runtime/runtimePolling.ts`
- Create: `apps/wallpaper/src/runtime/runtimeCredentials.ts`
- Modify: `apps/wallpaper/src/runtime/wallpaperRuntime.ts`
- Test: `apps/wallpaper/src/runtime/wallpaperRuntime.test.ts` (existing — must pass unchanged)

**Interfaces:**
- Consumes: existing internal functions inside `createWallpaperRuntime` closure
- Produces: same public API (`createWallpaperRuntime`, `WallpaperRuntime`, `ReadonlyWallpaperRuntimeSnapshot`, `WallpaperRuntimeDependencies`)

Each extracted module exports pure functions or factory functions that accept the shared mutable state as parameters. The closure state is passed explicitly rather than captured, making dependencies visible.

- [ ] **Step 1: Extract `runtimeTypes.ts` — types, utility functions, constants**

Move from `wallpaperRuntime.ts` to `runtimeTypes.ts`:
- `SILENCE_RELEASE_MS`, `FALLBACK_VISUALIZER_COLOR` constants
- `WallpaperRuntimeSnapshot` interface
- `DeepReadonly<T>` type
- `ReadonlyWallpaperRuntimeSnapshot` type alias
- `WallpaperRuntime` interface
- `WallpaperRuntimeDependencies` interface
- `deepFreeze()` function
- `sanitizeProviderError()` function
- `safeProviderErrorMessage()` function
- `retainsPlaybackEligibility()` function

```typescript
// apps/wallpaper/src/runtime/runtimeTypes.ts
import type {
  NormalizedPlayback,
  SpotifyPlaybackError,
  VisualizerFrame,
  VisualizerMotionState,
  WallpaperPreferences,
  WallpaperTheme,
  PlaybackCommand,
  PlaybackProvider
} from '@spotify-wallpaper/shared-types';
import type { AlbumThemeExtraction } from '../theme/extractAlbumTheme';
import type { TrackTransitionState } from '../transitions/model';
import type { AudioBridgeSource } from '../wallpaperEngine/audio';
import type { CredentialUpdate } from '../wallpaperEngine/types';
import type { DirectCredentialStore } from '../spotify/credentialStore';
import { selectPlaybackProvider } from '../spotify/providers/factory';
import { startAudioBridge } from '../wallpaperEngine/audio';
import { extractAlbumTheme } from '../theme/extractAlbumTheme';

export const SILENCE_RELEASE_MS = 450;
export const FALLBACK_VISUALIZER_COLOR = '#ffffff';

export interface WallpaperRuntimeSnapshot {
  settings: WallpaperPreferences;
  playback: NormalizedPlayback;
  previousPlayback: NormalizedPlayback | null;
  spotifyError: SpotifyPlaybackError | null;
  controlError: SpotifyPlaybackError | null;
  controlBusy: boolean;
  playbackMode: string;
  providerSelection: 'mock' | 'ready' | 'invalid';
  providerConfigurationError: string | null;
  lastPollingDelayMs: number | null;
  consecutiveErrors: number;
  nowMs: number;
  progressNowMs: number;
  visualizerFrame: VisualizerFrame | null;
  previousVisualizerFrame: VisualizerFrame | null;
  visualizerMotion: VisualizerMotionState;
  visualizerColor: string;
  theme: WallpaperTheme;
  transitionState: TrackTransitionState | null;
  credentialStatus: { kind: 'none' | 'direct' | 'backend'; present: boolean; revision: number };
}

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Date
    ? Readonly<T>
    : T extends readonly (infer U)[]
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type ReadonlyWallpaperRuntimeSnapshot = DeepReadonly<WallpaperRuntimeSnapshot>;

export interface WallpaperRuntime {
  enableCredentialStore(store: DirectCredentialStore): void;
  start(): void;
  subscribe(listener: (snapshot: ReadonlyWallpaperRuntimeSnapshot) => void): () => void;
  applyConfiguration(settings: WallpaperPreferences, credential: CredentialUpdate, safetyGateOpen: boolean, providerSelectionExplicit?: boolean): void;
  acceptAudioFrame(frame: VisualizerFrame): void;
  execute(command: PlaybackCommand): Promise<void>;
  toggleDisplayMode(): void;
  dispose(): void;
}

export interface WallpaperRuntimeDependencies {
  credentialStore?: DirectCredentialStore;
  selectProvider?: typeof selectPlaybackProvider;
  startAudioBridge?: typeof startAudioBridge;
  extractTheme?: typeof extractAlbumTheme;
}

export const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
};

export const sanitizeProviderError = (error: SpotifyPlaybackError): SpotifyPlaybackError => {
  const status = error.status;
  const retryAfterMs = error.retryAfterMs;
  const safeStatus = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
  const safeRetryAfterMs = typeof retryAfterMs === 'number' && Number.isSafeInteger(retryAfterMs) && retryAfterMs >= 0
    ? Math.round(retryAfterMs)
    : undefined;
  return {
    kind: error.kind,
    message: error.kind === 'rate_limited' && error.quotaExceeded === true ? 'Spotify開発者アカウントのquota上限です。再認証せず時間をおいてください。' : safeProviderErrorMessage(error.kind),
    ...(error.quotaExceeded === true ? { quotaExceeded: true } : {}),
    ...(safeStatus === undefined ? {} : { status: safeStatus }),
    ...(safeRetryAfterMs === undefined ? {} : { retryAfterMs: safeRetryAfterMs })
  };
};

export const safeProviderErrorMessage = (kind: SpotifyPlaybackError['kind']): string => {
  switch (kind) {
    case 'unauthorized': return 'Spotify authorization is required.';
    case 'forbidden': return 'Spotify playback access was denied.';
    case 'rate_limited': return 'Spotify rate limit reached.';
    case 'network_error': return 'Spotify network request failed.';
    case 'storage_error': return 'Spotify認証情報を保存・復元できません。保存領域を確認して再接続してください。';
    case 'unavailable': return 'Spotify is temporarily unavailable.';
    case 'unknown_response_shape': return 'Spotify returned an unsupported response.';
    case 'item_null': return 'Spotify is not currently playing an item.';
  }
};

export const retainsPlaybackEligibility = (kind: SpotifyPlaybackError['kind']): boolean =>
  kind === 'network_error' || kind === 'rate_limited' || kind === 'unknown_response_shape';
```

Update `wallpaperRuntime.ts` to import from `runtimeTypes.ts` instead of defining inline. Re-export from `wallpaperRuntime.ts` for external consumers:
```typescript
export type { WallpaperRuntime, WallpaperRuntimeDependencies, ReadonlyWallpaperRuntimeSnapshot } from './runtimeTypes';
```

- [ ] **Step 2: Run tests to verify types-only extraction is safe**

```bash
cd apps/wallpaper && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass, zero failures.

- [ ] **Step 3: Extract `runtimeTheme.ts` — theme update logic**

Move the `updateTheme()` function and its `requestAlbumExtraction()` inner function into a standalone module. It accepts explicit parameters for the mutable state it reads/writes:

```typescript
// apps/wallpaper/src/runtime/runtimeTheme.ts
import type { NormalizedPlayback, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { AlbumThemeExtraction } from '../theme/extractAlbumTheme';
import type { WallpaperRuntimeSnapshot } from './runtimeTypes';
import { FALLBACK_VISUALIZER_COLOR } from './runtimeTypes';
import { fallbackThemeFromSeed, hexToRgb, themeFromPrimary } from '../theme/colors';

export interface ThemeState {
  activeThemeKey: string;
  activeVisualizerColorKey: string;
  themeGeneration: number;
  albumExtractionCache: { key: string; theme: AlbumThemeExtraction } | null;
  disposed: boolean;
}

export function updateTheme(
  playback: NormalizedPlayback,
  snapshot: WallpaperRuntimeSnapshot,
  state: ThemeState,
  audioReactionEnabled: (settings: WallpaperPreferences) => boolean,
  extractTheme: (url: string, seed: string) => Promise<AlbumThemeExtraction>,
  applySnapshot: (patch: Partial<WallpaperRuntimeSnapshot>) => void
): void {
  // ... moved logic from wallpaperRuntime.ts updateTheme() ...
  // Uses state for mutable tracking, calls applySnapshot + emit through callback
}
```

The exact function body is the `updateTheme` closure from `wallpaperRuntime.ts` lines 247–326, with closure variables replaced by `state.*` parameter access and `snapshot = { ...snapshot, ... }; emit()` replaced by `applySnapshot({...})`.

- [ ] **Step 4: Run tests after theme extraction**

```bash
cd apps/wallpaper && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Extract `runtimeAudio.ts` — audio frame and visualizer logic**

Move `acceptIdleFrame()`, `startVisualizers()`, `playbackAcceptsAudio()`, `audioReactionEnabled()`, and the body of `acceptAudioFrame()` into a module:

```typescript
// apps/wallpaper/src/runtime/runtimeAudio.ts
import type { VisualizerFrame, VisualizerMotionState, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { WallpaperRuntimeSnapshot } from './runtimeTypes';
import type { AudioBridgeSource } from '../wallpaperEngine/audio';
import { SILENCE_RELEASE_MS } from './runtimeTypes';

export function audioReactionEnabled(settings: WallpaperPreferences): boolean {
  return settings.visualizer.enabled
    || settings.visualizer.glowingObjectsEnabled
    || (settings.albumArt.visible && settings.layout.items.albumArt.enabled);
}

export interface AudioState {
  audioBridgeSource: AudioBridgeSource | null;
  lastWallpaperFrameAtMs: number;
  lastMockFrameAtMs: number;
  silentSinceMs: number | null;
  motionReleaseSource: VisualizerMotionState | null;
  motionReleaseStartedAtMs: number | null;
  hasSuccessfulPlaybackPoll: boolean;
}

export function playbackAcceptsAudio(
  source: VisualizerFrame['source'],
  snapshot: WallpaperRuntimeSnapshot,
  state: AudioState
): boolean {
  // ... moved logic ...
}

export function processAudioFrame(
  frame: VisualizerFrame,
  snapshot: WallpaperRuntimeSnapshot,
  state: AudioState
): Partial<WallpaperRuntimeSnapshot> {
  // ... moved logic, returns snapshot patch instead of mutating ...
}
```

- [ ] **Step 6: Run tests after audio extraction**

```bash
cd apps/wallpaper && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 7: Extract `runtimePolling.ts` — provider and polling logic**

Move `poll()`, `configureProvider()`, `providerKey()`, `clearProvider()`:

```typescript
// apps/wallpaper/src/runtime/runtimePolling.ts
import type { NormalizedPlayback, PlaybackProvider, ProviderResult, SpotifyPlaybackError, WallpaperPreferences } from '@spotify-wallpaper/shared-types';
import type { WallpaperRuntimeSnapshot } from './runtimeTypes';
import { sanitizeProviderError, retainsPlaybackEligibility } from './runtimeTypes';

export interface PollingState {
  provider: PlaybackProvider | null;
  providerAbortController: AbortController | null;
  pollingTimeout: number | null;
  pollingRunId: number;
  hasSuccessfulPlaybackPoll: boolean;
  disposed: boolean;
  safetyGateOpen: boolean;
}

export function providerKey(snapshot: WallpaperRuntimeSnapshot, state: PollingState): string {
  // ... moved logic ...
}

// ... other exported functions ...
```

- [ ] **Step 8: Run tests after polling extraction**

```bash
cd apps/wallpaper && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 9: Extract `runtimeCredentials.ts` — credential store logic**

Move `storageFailed()`, `acceptStored()`, and credential epoch/queue management:

```typescript
// apps/wallpaper/src/runtime/runtimeCredentials.ts
import type { DirectCredentialStore, CredentialRecord } from '../spotify/credentialStore';
import type { WallpaperRuntimeSnapshot, WallpaperRuntime } from './runtimeTypes';
import { DirectTokenSession } from '../spotify/directTokenSession';

export interface CredentialState {
  credentialStore: DirectCredentialStore | undefined;
  directSession: DirectTokenSession | undefined;
  authorizationId: string | undefined;
  credentialEpoch: number;
  credentialQueue: Promise<void>;
  applyingStoredCredential: boolean;
  disposed: boolean;
  safetyGateOpen: boolean;
}

export function createStorageFailed(
  state: CredentialState,
  applySnapshot: (patch: Partial<WallpaperRuntimeSnapshot>) => void
): () => void {
  // ... moved logic ...
}

export function createAcceptStored(
  state: CredentialState,
  credentialClosure: { clear(): void },
  runtime: WallpaperRuntime,
  getSnapshot: () => WallpaperRuntimeSnapshot
): (record: CredentialRecord | null, epoch: number, activate?: boolean) => void {
  // ... moved logic ...
}
```

- [ ] **Step 10: Run tests after credential extraction**

```bash
cd apps/wallpaper && npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 11: Check for circular imports**

```bash
npx madge --circular apps/wallpaper/src/runtime/
```

Expected: no circular dependencies. If found, move the offending type/function to `runtimeTypes.ts`.

- [ ] **Step 12: Run full project verification**

```bash
npm run check && npm test && npm run build
```

Expected: all pass.

- [ ] **Step 13: Commit**

```bash
git add apps/wallpaper/src/runtime/
git commit -m "refactor: decompose wallpaperRuntime into focused modules

Extract types/utilities, theme, audio, polling, and credential logic
from the 798-line god-object closure into five focused modules.
The public API (createWallpaperRuntime, WallpaperRuntime interface)
is unchanged. All 1,550 lines of existing tests pass unmodified."
```

---

### Task 4: Consolidate excessive documentation

Remove or archive documentation that has become stale or disproportionate to the codebase. The `docs/` directory has 32 top-level files + 25 phase-reports + 4 archived operations runbooks (handled in Task 1) + agent/AI-process docs for an ~8,700 line codebase.

**Targets for removal (all completed/historical with no current reference value):**
- `docs/phase-reports/` — 25 historical phase-completion records. Consolidate into a single `docs/phase-reports/README.md` summary that lists phases 0-12 with one-line completion notes, removing individual phase files.
- `docs/30-subagent-matrix.md` (213 lines) — AI agent orchestration matrix, not relevant to the product.
- `docs/00-codex-entrypoint.md` (73 lines) — Codex-specific AI agent entrypoint, not relevant to product or humans.
- `docs/how-to-use-h5i.md` (185 lines) — h5i tool usage guide, belongs in the tool's own docs, not the product repo.
- `docs/eula.md` (64 lines) — archived EULA for the retired hosted backend; retirement record in `docs/25-public-backend.md` already covers this.

**Retain:**
- All numbered specification docs (01-25) except 00 — these are the living product specifications.
- `docs/README.md`, `docs/user-guide.md`, `docs/privacy.md`, `docs/qa-checklist.md`
- `docs/release-notes-v0.0.1.md`, `docs/post-v0.0.1-stabilization.md`
- `docs/superpowers/plans/` and `docs/superpowers/specs/` — active planning artifacts

**Files:**
- Delete: `docs/30-subagent-matrix.md`
- Delete: `docs/00-codex-entrypoint.md`
- Delete: `docs/how-to-use-h5i.md`
- Delete: `docs/eula.md`
- Delete: individual phase-report files (keep `docs/phase-reports/README.md`)
- Modify: `docs/phase-reports/README.md` — rewrite as a consolidated one-line-per-phase summary

**Interfaces:**
- Consumes: nothing
- Produces: smaller, navigable docs; no code changes

- [ ] **Step 1: Check for cross-references to files being deleted**

```bash
grep -rl "30-subagent-matrix\|00-codex-entrypoint\|how-to-use-h5i\|eula\.md" docs/ README.md CLAUDE.md AGENTS.md .github/ scripts/ 2>/dev/null
```

For each reference found, remove the link or redirect to a remaining doc.

- [ ] **Step 2: Read existing phase-reports/README.md**

Read the file to understand current format before rewriting.

- [ ] **Step 3: Write consolidated phase-reports/README.md**

```markdown
# Phase Reports

Historical completion records for the implementation phases defined in
`docs/03-implementation-phases.md`. Individual reports were consolidated
on 2026-09-23. See git history for original files.

| Phase | Summary | Status |
|---|---|---|
| 0 | Scaffold and mock preview | Complete |
| 1 | Spotify MVP | Complete |
| 2 | Wallpaper Engine bridge | Complete |
| 3 | Rust/WASM core | Complete |
| 4 | Settings and layout customization | Complete |
| 5 | Background theme | Complete |
| 6 | Visualizer | Complete |
| 7 | Lyrics (deferred) | Deferred |
| 8 | Transitions | Complete |
| 9 | Player and clock | Complete |
| 10 | Tauri configurator | Complete |
| 11 | Rainmeter | Complete |
| 12 | Final QA and docs | Complete |

Post-release records:
- One-click Spotify auth token flow
- Spotify playback virtual volume boost
- RC-2 Wallpaper Engine property types
- Wallpaper Engine update flow
- System-wide refactor: repository specification truth
- GitHub Pages direct migration
- Hosted backend retirement
- Post-v0.0.1 stabilization
```

- [ ] **Step 4: Remove individual phase reports and stale docs**

```bash
git rm docs/phase-reports/phase-0-scaffold-and-mock-preview.md
git rm docs/phase-reports/phase-1-spotify-mvp.md
git rm docs/phase-reports/phase-2-wallpaper-engine-bridge.md
git rm docs/phase-reports/phase-3-rust-wasm-core.md
git rm docs/phase-reports/phase-4-settings-layout-customization.md
git rm docs/phase-reports/phase-5-background-theme.md
git rm docs/phase-reports/phase-6-visualizer.md
git rm docs/phase-reports/phase-7-lyrics.md
git rm docs/phase-reports/phase-8-transitions.md
git rm docs/phase-reports/phase-9-player-clock.md
git rm docs/phase-reports/phase-10-tauri-configurator.md
git rm docs/phase-reports/phase-11-rainmeter.md
git rm docs/phase-reports/phase-12-final-qa-docs.md
git rm docs/phase-reports/one-click-spotify-auth-token.md
git rm docs/phase-reports/spotify-playback-virtual-volume-boost.md
git rm docs/phase-reports/rc-2-wallpaper-engine-property-types.md
git rm docs/phase-reports/wallpaper-engine-update-flow.md
git rm docs/phase-reports/system-wide-refactor-phase-0-repository-specification-truth.md
git rm docs/phase-reports/github-pages-direct-migration.md
git rm docs/phase-reports/hosted-backend-retirement.md
git rm docs/phase-reports/post-v0.0.1-stabilization.md
git rm docs/phase-reports/final-implementation-report.md
git rm docs/phase-reports/lyrics-deferred-spec-update.md
git rm docs/30-subagent-matrix.md
git rm docs/00-codex-entrypoint.md
git rm docs/how-to-use-h5i.md
git rm docs/eula.md
```

- [ ] **Step 5: Update any broken cross-references found in Step 1**

Fix each reference.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: consolidate phase reports and remove stale AI-process docs

Replace 25 individual phase-report files with a single summary table.
Remove subagent-matrix, codex-entrypoint, h5i usage guide, and archived
EULA that no longer serve the product or its users."
```

---

### Task 5: Clean up root-level AI-agent scaffolding references

Several root-level directories (`.agents/`, `.codex/`, `.codegraph/`, `.superpowers/`) and stray files (`.codex-wallpaper-vite.log`, `.codex-wallpaper-vite.err.log`) are gitignored but referenced by docs. Clean up any tracked references to these agent-specific artifacts to reduce confusion for human contributors.

**Files:**
- Modify: `AGENTS.md` — review and clean up stale agent-specific directives if present
- Modify: `.gitignore` — verify ignore rules are consolidated and tidy
- Check: no tracked files reference `.agents/`, `.codex/`, `.codegraph/` paths

**Interfaces:**
- Consumes: nothing
- Produces: cleaner contributor experience; no code changes

- [ ] **Step 1: Check AGENTS.md for stale references**

```bash
cat AGENTS.md | head -60
```

Review and remove any directives that reference retired tools or backends.

- [ ] **Step 2: Check .gitignore for agent-related rules**

```bash
grep -n "agents\|codex\|codegraph\|superpowers\|worktrees\|\.codex" .gitignore
```

Verify all agent directories have consolidated ignore rules. Remove duplicate or overly specific rules.

- [ ] **Step 3: Check tracked files for stale agent references**

```bash
grep -rl "\.agents/\|\.codex/\|\.codegraph/" docs/ README.md CLAUDE.md AGENTS.md scripts/ 2>/dev/null
```

Remove or update any stale references found.

- [ ] **Step 4: Commit if changes were made**

```bash
git add -A
git commit -m "chore: tidy gitignore and remove stale agent-scaffolding references"
```

If no changes are needed, skip this commit.
