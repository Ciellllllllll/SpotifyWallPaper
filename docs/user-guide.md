# User Guide

This guide covers the current `v0.0.1` milestone. The wallpaper runs as a Wallpaper Engine Web Wallpaper, and it also opens in a normal browser with mock playback for development and QA.

## Quick Start

1. Install dependencies from the repository root:

   ```sh
   npm install
   ```

2. Start the browser preview:

   ```sh
   npm run dev -w @spotify-wallpaper/wallpaper
   ```

3. Open `http://127.0.0.1:5173/`.

Without Spotify settings, the wallpaper uses mock playback, mock audio, and safe default settings.

## Spotifyへの接続

この移行の通常構成は、ブラウザのGitHub Pagesで初回PKCE認証を行い、その後は
Wallpaper EngineからSpotifyへ直接通信する方式です。運営VPS、Worker、D1、追加の常駐アプリは不要です。
以下のURLは公開予定であり、この変更で実公開したものではありません。

1. Spotify Developer Dashboardで自分のアプリを用意し、Client IDを確認します。Client Secretは使いません。
2. Redirect URIに`https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/callback/`を登録します。
   末尾`/`も必須です。以前の`/callback`から変更した場合、途中の認可を再利用せず最初からやり直します。
3. [認証ページ](https://ciellllllllll.github.io/SpotifyWallPaper/spotify-auth/)でClient IDを入力し、Spotify公式画面で認可します。
   パスワードはSpotify公式画面だけに入力します。
4. 成功後の認証用データ`swpt2.`をコピーし、Wallpaper Engineの「Spotify Token」欄へ貼り付けます。
5. 認証ページの「表示を消して終了」を押します。コピー履歴の削除は利用者自身で行います。

権限は現在再生中の情報、再生状態、再生操作の3つです。メール・ライブラリ権限は求めません。
Client IDは公開識別子ですが、認証用データにはRefresh Tokenが入ります。
Base64urlは暗号化ではありません。スクリーンショット、設定JSON、ログ、issue、共有ファイルへ入れないでください。

2026-09-21確認時、Development Modeはアプリ所有者のPremiumと利用者のallowlist登録が必要で、
認証可能ユーザーは最大5人です。Client IDは開発者アカウント当たり最大25個ですがquotaはアカウント単位で共有されます。
公開アプリとして無制限に利用できる意味ではありません。
[Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)と
[2026年7月更新](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates)を確認してください。
無料化の対象は追加の運営インフラで、Spotify Premium・Wallpaper Engine・GitHubの利用制限は別です。

### 保存・再認証・解除

壁紙はChromiumのIndexedDBデータベース`spotify-wallpaper-direct-credentials`の
`credentials`ストアへClient ID、最新Refresh/Access Token、有効期限、認可識別情報、更新番号を保存します。
物理ファイルの場所はWallpaper EngineのChromiumプロファイル・インストール環境に依存し、この作業では実測していません。
OSの秘密保管庫と同等ではなく、同一ユーザー権限のマルウェア・DevTools・改変された壁紙コードからは保護できません。
ブラウザの通常Mock起動はこのストアを読みません。ホストのプロパティ通知から保存を有効にします。

一般設定は別の`spotify-wallpaper-settings`です。設定JSONのexport/importは機密を扱いません。
WEに残った同じ初回データが再通知されても、保存済みの最新Tokenを優先します。
認可を切り替えるときは新しいデータの保存成功後に切り替えます。
再認証でテーマ・レイアウトなどを初期化しません。

Access TokenはSpotifyの`expires_in`に従って更新します。24時間固定の失効はありません。
Refresh Tokenは元の認可から6か月で、Access Token更新では延長されません。
180日固定で自動削除はせず、Spotifyの`invalid_grant`を失効判定に使います。
旧`swpt1.`の元の認可時刻は不明として扱います。
[SpotifyのToken更新仕様](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens)。

解除はWallpaper Engineの「Spotify Token」欄を空にします。専用ストアの機密とメモリを消し、
同じ古いデータの再通知を拒否する機密値を含まない記録を残します。`invalid_grant`も同様です。
再接続はPagesで新しく認証して取り込みます。Spotify側の許可も取り消す場合はSpotifyアカウントのAppsで解除してください。
設定JSONを消すだけでは認証解除になりません。
保存領域自体を削除すると無効化記録も消えるので、先にWEの入力欄を空にし、必要ならSpotify側も解除してください。

保存・読み込み失敗は保存エラーとして表示します。メモリだけの状態を再起動可能とは表示しません。
更新Tokenの保存失敗や通信中断で状態が不確かになった場合は、保存領域を復旧しPagesから再認証してください。
PC移行、壁紙の配置先変更、ブラウザデータ削除では保存領域が変わり、再認証が必要になる場合があります。

### 複数画面と長時間動作

同一保存領域ではIndexedDBの短い原子的更新と期限付きlease・revisionで競合を制御します。
通信中にDB transactionを開き続けません。更新処理はprovider破棄後も保存まで完了し、
別認可へ切り替わった後の古い結果は拒否します。
通常ブラウザの2タブでの検証はWallpaper Engine実機の共有性を証明しません。
WEの画面・プロセス間で保存領域が共有されるか、Origin/CORS、再起動後の保存は未検証です。
分離された画面・別PCでは同じRefresh Tokenの使い回しを保証せず、各保存領域で個別に認証してください。
個別再認可が既存認可に与えるSpotify側の影響も実アカウントで確認が必要です。
Fake clockの24/72時間相当テストは実機72時間連続稼働試験ではありません。

### エラーの意味

- `invalid_grant`：現在の認可が失効。Tokenを破棄し、Pagesで再認証します。
- 401：使用したAccess Tokenを確認して更新し、1回だけ再試行します。
- 403：アカウント・デバイス・allowlist・操作権限を確認します。Tokenは削除しません。
- 429：Retry-Afterに従います。`QUOTA_EXCEEDED`は開発者quotaで、再ログインでは解決しません。
- 通信障害・timeout・5xx：待機して再試行します。次/前などの操作を通信障害だけで自動再送しません。
- 保存エラー：ストレージの許可・容量・破損を確認します。認可失効と区別します。

### 旧構成からの移行

既存`swpt1.`を互換読み込みできます。`swpb1.`はRefresh TokenではないのでPagesで一度再認証してください。
旧`swpb1.`は固定の再認証案内を表示し、有効な直接接続の認証情報を上書きしません。
任意loopback/Tauri/Rainmeterは維持します。公開バックエンドは廃止しました。
2026-09-21に利用者の承認を得て旧Worker 1件とD1 2件を完全削除しました。
確認したVPSには対象サービスがなかったため停止していません。
詳細は[廃止記録](25-public-backend.md)を参照してください。旧配備手順はアーカイブです。

## GitHub Pagesの公開手順（利用者が実行）

1. 公開前に[Privacy](privacy.md)と直接接続方式の適用規約・運営者・連絡先・適用日を確認します。
   旧[EULA](eula.md)は廃止済みバックエンドの資料で、現在の公開規約として流用しません。
   Spotifyの[Policy](https://developer.spotify.com/policy)・[Design](https://developer.spotify.com/documentation/design)と
   GitHub Pagesの[利用制限](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)への適合を別途確認します。
   画像加工・音声と視覚の同期・商標・商用/機密取引の条件は、この技術移行で承認されたものではありません。
2. レビュー済みdevelopを利用者がpushします。この作業ではpushしません。
3. Repository Settings → Pages → SourceをGitHub Actionsにします。
4. `github-pages` environmentのdeployment branchで`develop`を許可し、必要な承認規則を設定します。
5. Repository Variable `PAGES_DEPLOY_ENABLED`を文字列`true`にします。未設定・falseでは公開しません。
6. developへの対象push、または利用可能な場合はdevelopを指定したworkflow_dispatchで実行します。
   default branchがmasterの場合、workflow_dispatchの登録/UI表示にはworkflowがdefault branchに存在する条件があります。
   この作業ではmasterを変更しません。必要なら利用者が別途レビューしたworkflow登録を行うかdevelop pushを使用します。
7. Pages設定のHTTPSと最終URL、callbackの200応答、assetsのパスを実公開後に確認します。

PRは検証のみです。deploy権限は公開jobに限定し、artifactは認証ページの静的出力だけで保存期間1日です。
Client ID・Spotify Token・Client SecretをGitHub Secrets/Variablesへ登録する必要はありません。
GitHubは最初のcallback HTTP要求を受けます。認可コードはPKCEで保護しますが「サーバーを一切通らない」とは説明しません。
Pagesで独自HTTPヘッダーを自由に設定できるとは仮定せず、HTMLのCSP/meta referrerを使います。
[公式workflow手順](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、
[HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)。

## Wallpaper Engine Development and Updates

1. Build the web wallpaper and create its development link:

   ```powershell
   npm run wallpaper:dev-build
   ```

2. In Wallpaper Engine, select the `spotify-wallpaper-dev` project under
   `projects\myprojects` once.
3. After later source changes, run `npm run wallpaper:dev-build` again and
   reload the existing wallpaper. Do not import another copy.
4. Configure user properties as needed.

The link command reads Wallpaper Engine's install path from the current-user
registry. To use a non-standard location, set
`WALLPAPER_ENGINE_PROJECTS_DIR` to the absolute path of the `myprojects`
folder. The command does not delete or overwrite an existing destination, and
it leaves older manual imports such as `index1` untouched.

### Workshop updates

Normal development builds never contain a Workshop ID. Workshop builds read
`apps/wallpaper/workshop-metadata.json` instead:

```powershell
npm run build:workshop -w @spotify-wallpaper/wallpaper
```

For the first owner-only Private test, use no Spotify credentials and verify
mock behavior only. After Wallpaper Engine creates the Workshop item, copy
only its decimal ID into `workshop-metadata.json` as a quoted string. Run the
Workshop build again before future **Submit Update** operations. Steam updates
the same subscribed item, although delivery may be slightly delayed.

Private publication itself is not automated. Do not connect a real Spotify
account, invite another user, begin a Limited beta, or publish generally until
the existing Spotify distribution gates are complete and the action is
separately approved.

Visible user property keys:

- `spotify_refresh_token`
- `visualizer_enabled`
- `glowing_objects_enabled`
- `visualizer_mode`
- `visualizer_position`
- `visualizer_intensity`
- `visualizer_sensitivity`
- `visualizer_smoothing`
- `visualizer_decay`
- `clock_enabled`
- `clock_hour12`
- `clock_show_date`
- `performance_mode`
- `debug_enabled`

The `spotify_refresh_token` key is displayed as Spotify Token for saved-value
compatibility. `swpt2.` and compatible `swpt1.` select direct mode. Old `swpb1.` input is rejected with a Pages reauthorization message.
All public HTTPS backend origins are rejected before sending a credential. Clearing the field disconnects Spotify,
and malformed prefixed input does not replace the active credential. Legacy
hidden properties remain readable for existing installs, but Settings JSON
and the separate provider, backend URL, Client ID, and Pairing Token controls
are no longer shown.

If Wallpaper Engine APIs are absent, the same build still works in a browser using mock settings and mock playback.

### Visualizer tuning

When Visualizer Enabled is on, Wallpaper Engine shows four live sliders. Each
slider accepts two decimal places in 0.01 steps:

- Visualizer Intensity changes the final height or radius of the effect.
- Visualizer Sensitivity raises quiet input before it is treated as silence.
- Visualizer Smoothing trades immediate movement for steadier movement; move
  it toward 0 for the quickest response.
- Visualizer Decay Speed controls how quickly the effect falls after a sound;
  higher values produce a shorter tail.

Changes apply without reloading. Start by lowering Smoothing, then raise
Sensitivity for quiet sources, and use Intensity only for the final visual
size. Set Visualizer Position to `around-album` to keep circular geometry
centered on the album art, or to `bottom-up` to anchor the visualizer at the
bottom of the screen and grow radial bars upward. The position is independent
of the selected mode, and the visualizer does not rotate as a whole.

In direct or backend Spotify mode, Wallpaper Engine audio starts reacting only
after the current connection successfully reports a playing track or episode.
Spotify volume 1 through 100 is virtually referenced to 100 with
`100 / volume`; zero or unavailable volume is left unboosted. This affects only
the wallpaper response and never changes Spotify or PC volume. Paused, stopped,
missing-item, and not-yet-fetched states set the visualizer to zero while the
album and lights return to rest. A short network failure keeps the last valid playback state,
while no active device, no item, expired authorization, or denied access stops
audio response. Changing connection waits for the next successful result. Browser mock
audio is never boosted. Because Wallpaper Engine receives the PC-wide audio
mix, other audible applications are also amplified visually while Spotify is
eligible.

### Glowing objects

Glowing Objects Enabled controls a full-screen field of small lights that begin
near the center and move outward. The effect is independent of album-art and
SVG visualizer visibility. Normalized audio continuously grows the album
content up to 54%, moves it outward by at most 8px, and raises particle speed
up to twice normal with a brightness increase; after the sound stops, these
values ease back in about 450ms. In theme color mode, the album's quantized
dominant color is applied to the SVG visualizer and lights only, with white as
the fallback and a short color transition. Reduce Motion does not disable
this effect. A particle count or lifetime of 0 selects the performance-aware
automatic value; use the toggle when the effect should be off.

### Display mode animation

The default `album-only` mode hides track details. Switching to
`album-details` reveals the track panel with its text-entry animation while the
album frame transitions to its details layout. Switching back reverses the
album and seekbar position changes; the detail text is removed. Enable Reduce
Motion when these display-mode animations and transitions should be stopped.

## Rust/WASM Visual Core

The wallpaper can use the Rust visual core at runtime for typed-array visualizer normalization and readability calculation.
Layout and settings remain TypeScript-owned. Generate the WASM bundle before packaging when Rust runtime integration is required:

```sh
wasm-pack build crates/visual-core --target web --out-dir ../../apps/wallpaper/public/wasm
npm run build -w @spotify-wallpaper/wallpaper
```

If the WASM bundle is not present, the wallpaper falls back to TypeScript logic and still starts in browser preview and Wallpaper Engine.

## Optional Configurator

Run the browser configurator:

```sh
npm run dev -w @spotify-wallpaper/configurator
```

Run the Tauri shell:

```sh
npm run tauri:dev -w @spotify-wallpaper/configurator
```

The configurator edits the complete v3 preferences object, previews the shared mock renderer, imports/exports secret-free
settings JSON, and writes optional Rainmeter JSON. Spotify authorization uses the single native
`authorize_spotify_and_copy_swpt1` command. Verifier, state, callback URL, authorization code, and Refresh Token stay in
Rust locals; after native confirmation, the approved `swpt1.` bundle is copied to the clipboard once. The WebView receives
only status or fixed error codes and never stores or exports credentials. There is no callback-URL paste or token draft.

The configurator is optional. The wallpaper runtime must keep working without it.

## Settings Reference

Every preferences object uses `schemaVersion: 3` and these top-level categories:

- `spotify`
- `layout`
- `theme`
- `background`
- `albumArt`
- `text`
- `player`
- `seekbar`
- `visualizer`
- `clock`
- `transitions`
- `performance`
- `rainmeter`
- `debug`

Malformed settings are repaired or replaced with safe defaults at startup. Examples are available in `examples/settings/`.

Use `layout.preset` for the first level of customization. Available presets:

- `Minimal`
- `Center Album`
- `Visualizer Heavy`
- `Rainmeter Hybrid`
- `Left Dock`
- `Bottom Player`
- `Clock Focus`
- `Album Ring`
- `Ambient Background`

## Rainmeter Integration

Rainmeter export is optional and belongs to the configurator/Tauri side. The Web Wallpaper does not require Rainmeter and does not write local files.

The current output mode is JSON. The payload contains:

- `title`
- `artists`
- `albumName`
- `albumArtLocalPath`
- `progressMs`
- `durationMs`
- `progressRatio`
- `isPlaying`
- `primaryColor`
- `secondaryColor`
- `accentColor`
- `readableTextColor`
- `timestamp`
- `playbackSource`

The Tauri command rejects payloads with Spotify token, client secret, OAuth authorization code, or callback URL field names before writing files.

The Tauri scheduler can write Rainmeter JSON repeatedly. It writes at about 1 second while playback is marked playing and uses `rainmeter.stoppedUpdateIntervalMs` while stopped. Scheduler failures are isolated from the wallpaper runtime.

A minimal Rainmeter reader sample is available at `examples/rainmeter/SpotifyWallPaper/SpotifyWallPaper.ini`. Copy it into a Rainmeter skin folder and set `JsonPath` to the configurator output file if you do not use the default `@Resources/NowPlaying.json` location.

## Troubleshooting

- Browser opens but no Spotify data appears: this is expected without Spotify settings; mock playback should still render.
- Wallpaper Engine properties do not apply: reload the existing development wallpaper after rebuilding and confirm the visible property key names.
- Spotify controls fail: passive display works without Premium, but some playback operations can be denied by Spotify or by restricted devices.
- Old public-backend credentials no longer work: authorize through the static Pages helper.
- Lyrics/LRC settings are not available in this milestone. Remove legacy `lyrics` fields from pasted settings JSON if they appear in old samples.
- Visualizer is idle: Wallpaper Engine audio data may be unavailable; browser preview uses mock or idle audio paths. In Wallpaper Engine, confirm Visualizer Enabled, lower Smoothing, and raise Sensitivity gradually.
- Rainmeter write fails: confirm the configurator is running in the Tauri shell, not only the browser preview, and verify the output path is writable.
- Settings break the layout: clear `spotify-wallpaper-settings` from local storage or import a known-good sample from `examples/settings/`.
