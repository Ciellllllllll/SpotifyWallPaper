# ビジュライザー配置と表示モードアニメーションの復元 実装計画

## 概要

- `visualizer.position` を追加し、`around-album` と `bottom-up` を Wallpaper Engine から選択可能にする。
- 既存の `album-ring`、`radial-bars`、`waveform-line` は維持する。
- アルバム周囲では極座標で円周に沿って描画し、下部では横長・上向きに自然変換する。
- 共有表示部から失われたアルバム移動・詳細表示 CSS アニメーションを復元する。

## 実装方針

- 共有設定 v2 に `VisualizerPosition = 'around-album' | 'bottom-up'` と `visualizer.position` を追加する。欠落・不正値は `around-album` に補正する。
- Wallpaper Engine の `visualizer_position` コンボを追加し、既存の表示形式と設定 JSON の互換性を保つ。
- `AlbumVisualizer.svelte` は円周基準の SVG/極座標描画、`BottomVisualizer.svelte` は下端基準の描画を担当する。
- `WallpaperView.svelte` は位置で2コンポーネントを切り替え、過去の `album-enter`、`text-enter`、レイアウト transition を復元する。
- `rotationSpeed` は旧設定互換のため残すが、ビジュライザー全体の回転には使用しない。

## テストとレビュー

- 共有設定のデフォルト、不正値補正、Wallpaper Engine プロパティ、2配置×3形式、標準/低電力、表示切替アニメーション、reduced motion を検証する。
- `npm test`、`npm run check`、`npm run build`、対象 Playwright、`npm audit`、Rust の check/test を `h5i capture run` 経由で実行する。
- strict-gated 変更として Sol、SpecGuard、Architecture、Settings Schema、Wallpaper Engine、UI Layout、Visualizer、Transition、Performance、QA、Docs の読み取りレビューを行い、指摘修正後に同じ差分を再レビューする。
- 最後に Ponytail 監査を行い、`Lean already. Ship.` を確認する。

## 並列作業

- 契約 worktree 完了後、描画コンポーネント worktree と QA・文書 worktree を並列で進める。
- コンポーネント完成後、表示統合 worktree で親コンポーネントへ統合する。
- 統合用 worktree で全ブランチを統合し、全体検証を行う。

## Ponytail baseline

- 公式 marketplace source: `https://github.com/DietrichGebert/ponytail.git`
- snapshot / installed revision: `2ed6c52c9d7e5e56942508591085fd45dea277d3`
- exact version: `4.9.0`
- verification time: `2026-08-27T10:32:01.3867682+09:00`
- standard enabled hooks: `SessionStart`、`SubagentStart`、`UserPromptSubmit`
- mode: `full`
- audit result: `Lean already. Ship.`
