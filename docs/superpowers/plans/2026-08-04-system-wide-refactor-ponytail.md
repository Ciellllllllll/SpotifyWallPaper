# Ponytail監査付き・主要構造問題修正 実行計画

## 固定実行条件

- 実装担当はLuna/MAXのみ。Sol/mediumは読み取り専用レビュー担当のみ。
- Solは `gpt-5.6-sol`、推論medium、`fork_turns: "none"` の一体を起動時に
  作成し、全Phaseで再利用する。編集・commit・Git操作は禁止する。
- Ponytail 4.8.4標準HookのSessionStart、SubagentStart、UserPromptSubmitを
  trusted/enabled状態で使用する。NodeがHookの非対話PATHから利用できない、
  modeがfullでない、Hookが未承認ならPhaseを開始しない。独自Hookは追加しない。
- ブランチは現在の `Fix/system-wide-refactor` を固定する。branch切替、worktree、
  push、PR、merge、deployは禁止する。Phase 0Aのarchive tagと履歴復元のみ例外。
- Phaseごとに targeted tests/build → Sol review/SpecGuard（対象PhaseはSecurity）
  → 指摘修正・再テスト・再レビュー → Sol明示PASS → 同一diffへの
  `@ponytail-audit` → `Lean already. Ship.`（PONYTAIL PASS）を順守する。
  Ponytail findingまたはdiff変更があればSol PASSからやり直す。
- Phase完了時はLuna/MAXが一つのcommitを作成し、HEADとclean worktreeを確認する。

## Phase 0A（commitなし）

1. clean worktree、branch、HEAD、祖先関係、タグ不存在を確認する。
2. `archive/system-wide-refactor-pre-reset-ea158f0` を annotated local tagで作成する。
3. `git reset --hard 455dcf1`、`git merge --ff-only d13ff25`、
   `git merge --ff-only a3c5400`を同一branchで実行する。
4. HEAD=`a3c5400`、clean worktreeを確認する。`git clean`は実行しない。

## Phase 0B（active authority置換）

2026-08-04のstructure-first design/planをactive authorityにし、旧
2026-07-27 design/planをhistorical-evidenceへ降格する。AGENTS、README/index、
repository structure、quality gates、settings、Spotify、WASM、layout、
visualizer、player、Tauri、QA、public backendの相互参照を整合させる。
Phase 0 authority verifierの検証層は拡張せず、product codeを変更しない。
Sol PASS、Ponytail PASSの後にcommitする。

## Phase 1（characterization）

`@playwright/test@1.62.1`だけを追加する。固定時刻、playback、audio、placeholder
art、reduced motion、長いタイトル、missing art、paused、item none、transition、
preset、v1 settings、provider responseをfixture化する。1920×1080/3440×1440、
album-only（背景/album art/visualizer/seekbar中心）とalbum-details（title/
artists/progress/clock/controlを含む）をGolden化し、差分比率0.002を上限にする。baseline
`@ponytail-audit`を実行後、Sol/Ponytail最終ゲートを通してcommitする。

## Phase 2（共有契約とSettings v2）

`packages/shared-types`内部をsettings/provider/playback/audio/view/themeへ整理し、
workspace依存を持たせない。Settings v2 defaults/migration/repair/preset/
serializerを一実装にし、V1 DTOをmigration内部に限定する。language-neutral
provider-v1 JSON fixtureを追加し、future/malformed/round-trip/secret-freeを
TDDで検証する。Sol/Ponytail後にcommitする。

## Phase 3（CredentialとSettings cutover）

legacy browser credentialは値を読まずdelete-onlyで除去する。既知v1の表示設定だけ
v2へ移し、future/malformed/cleanup失敗はnetworkを開始せずmock表示に固定する。
process-memory credential closure、Wallpaper Engine complete snapshot、
settings_jsonのsecret無視、provider適合を実装する。Sol Code/SpecGuard/Security
PASS後にPonytail PASSを取り、commitする。

## Phase 4（Provider分割とBackend契約）

mock/direct/backend/factoryの3 providerを分離し、mock/ready/invalidを明示する。
Worker/loopbackはprovider fixtureの不一致だけを修正し、OAuth/D1/deletionや
loopback storage/reset ledgerは再設計しない。integration `@ponytail-audit`、
Sol Code/SpecGuard/Security、Ponytailの順でゲートする。

## Phase 5（Runtime抽出）

`App.svelte`からprovider lifecycle、poll/backoff、history、progress、control、
clock、audio、visualizer、theme、transitionを`createWallpaperRuntime()`へ移す。
stale poll/theme、A→B→C、dispose競合をテストし、Appにはwiring/ViewModel/
compositionだけを残す。Sol/Ponytail後にcommitする。

## Phase 6（Shared rendererとConfigurator）

`packages/wallpaper-view`を追加し、Wallpaper markup/CSS/display componentを移す。
Configuratorも同じviewを使い、Preferencesのpartial patchだけを編集する。
重複defaults/preset/import/export/preview/CSSを削除し、Configurator control intent
はSpotifyへ送らない。integration Ponytail audit、Sol、Ponytail、commitの順に進める。

## Phase 7（Tauri秘密境界）

認証commandを`authorize_spotify_and_copy_swpt1`へ統合する。verifier/state/callback/
code/Refresh TokenはRustローカルだけに保持し、native確認後に`swpt1`を一度だけ
clipboardへコピーする。WebViewにはstatusと固定error codeだけ返す。Sol Code/
SpecGuard/Security PASS後にPonytail PASS、commitする。

## Phase 8（WASM境界）

Rust layout ABIを削除し、visual normalization/readabilityだけを残す。毎frame JSON
ABIをtyped arrayへ置換し、generated bindingはignored directoryへ生成する。actual
WASMとTS fallbackを同じadapterで比較し、sample許容差1e-5/readability1e-4を満たす。
Sol/Ponytail後にcommitする。

## Phase 9（Build、cleanup、最終監査）

npm root build順をWASM → shared-types → consumersに固定し、Cargo/Tauri/loopbackを
独立CI jobにする。consumer 0を確認して旧settings/cache/preview/重複preset/旧WASM/
`config-schema`を削除する。clean install相当のtest/check/build、全repository対象の
`@ponytail-audit`、Sol final Code/Architecture/SpecGuard/Security PASS、Ponytail
`Lean already. Ship.`を同一diffで確認してから最終commitする。pushしない。

## Phase共通の報告

各Phase報告は次の見出しを正確に使用する。

- Phase name
- Summary
- Changed files
- Relevant docs read
- Implemented requirements
- Known gaps
- Tests run
- Risks introduced
- Review outcome
- Fixes from review
- Verification commands
- Next recommended task

`.codex/reports`は実行記録として更新するが、ユーザーが明示しない限りstaging/commit
しない。既存Ponytail findingはpre-existingまたは後続Phase予定として記録し、現在Phase
が新規導入したfindingは同Phase内に解消する。
