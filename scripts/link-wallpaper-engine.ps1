$ErrorActionPreference = 'Stop'

# Node is already required by the build/link tooling. Native realpath resolves
# junctions and long/8.3 name aliases through Windows filesystem handles.
function Test-SameDirectory([string] $Left, [string] $Right) {
    # Compare in Node to avoid a Unicode path round-trip through console encoding.
    & node -e "const fs = require('fs'); process.exit(fs.realpathSync.native(process.argv[1]) === fs.realpathSync.native(process.argv[2]) ? 0 : 1)" -- $Left $Right
    return $LASTEXITCODE -eq 0
}

try {
    $repositoryRoot = Split-Path -Parent $PSScriptRoot
    $sourcePath = Join-Path $repositoryRoot 'apps\wallpaper\dist'
    $projectsPath = $env:WALLPAPER_ENGINE_PROJECTS_DIR

    if ([string]::IsNullOrWhiteSpace($projectsPath)) {
        $installPath = (Get-ItemProperty -LiteralPath 'HKCU:\Software\WallpaperEngine' -Name InstallPath).InstallPath
        if ([string]::IsNullOrWhiteSpace($installPath) -or -not (Test-Path -LiteralPath $installPath -PathType Leaf)) {
            throw 'Wallpaper Engineの実行ファイルをレジストリから確認できません。'
        }
        $projectsPath = Join-Path (Split-Path -Parent $installPath) 'projects\myprojects'
    } elseif ($projectsPath -notmatch '^(?:[A-Za-z]:[\/\\]|\\\\)') {
        throw 'WALLPAPER_ENGINE_PROJECTS_DIRにはmyprojectsの絶対パスを指定してください。'
    }

    if (-not (Test-Path -LiteralPath $sourcePath -PathType Container)) {
        throw 'apps\wallpaper\distがありません。先にWallpaperをビルドしてください。'
    }
    foreach ($requiredFile in @('index.html', 'project.json')) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourcePath $requiredFile) -PathType Leaf)) {
            throw "apps\wallpaper\dist\$requiredFileがありません。先にWallpaperをビルドしてください。"
        }
    }
    if (-not (Test-Path -LiteralPath $projectsPath -PathType Container)) {
        throw 'Wallpaper Engineのprojects\myprojectsフォルダーが見つかりません。'
    }

    $sourcePath = (Resolve-Path -LiteralPath $sourcePath).Path
    $projectsPath = (Resolve-Path -LiteralPath $projectsPath).Path
    $destinationPath = Join-Path $projectsPath 'spotify-wallpaper-dev'
    $existing = Get-Item -LiteralPath $destinationPath -Force -ErrorAction SilentlyContinue

    if ($null -ne $existing) {
        if ($existing.LinkType -ne 'Junction') {
            throw 'spotify-wallpaper-devには既存のファイルまたはフォルダーがあります。削除や上書きは行いません。'
        }
        $existingTarget = @($existing.Target)
        if ($existingTarget.Count -ne 1) {
            throw 'spotify-wallpaper-devの接続先を確認できません。削除や付け替えは行いません。'
        }
        if (-not (Test-SameDirectory $destinationPath $sourcePath)) {
            throw 'spotify-wallpaper-devは別の場所を指しています。削除や付け替えは行いません。'
        }
        Write-Output 'Wallpaper Engineの開発用リンクは設定済みです。'
        exit 0
    }

    New-Item -ItemType Junction -Path $destinationPath -Target $sourcePath | Out-Null
    $created = Get-Item -LiteralPath $destinationPath -Force
    if ($created.LinkType -ne 'Junction' -or -not (Test-SameDirectory $destinationPath $sourcePath)) {
        throw 'Wallpaper Engineの開発用リンクを確認できませんでした。'
    }

    Write-Output 'Wallpaper Engineの開発用リンクを作成しました。'
    exit 0
} catch {
    [Console]::Error.WriteLine("Wallpaper Engineの開発用リンクに失敗しました: $($_.Exception.Message)")
    exit 1
}
