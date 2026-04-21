# Haro Installer — Windows PowerShell
# Usage: iwr -useb https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/haro-ai/haro"
$MinNodeMajor = 22
$HaroPkg = "@haro/cli"

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-ErrorX { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Success { param([string]$Message) Write-Host "[OK] $Message" -ForegroundColor Green }

function Get-NodeMajor {
    try {
        $ver = node --version 2>$null
        if ($ver) {
            $ver = $ver.TrimStart('v')
            return [int]($ver.Split('.')[0])
        }
    } catch { }
    return $null
}

function Get-PnpmVersion {
    try {
        $ver = pnpm --version 2>$null
        if ($ver) { return $ver.Trim() }
    } catch { }
    return $null
}

function Get-NpmVersion {
    try {
        $ver = npm --version 2>$null
        if ($ver) { return $ver.Trim() }
    } catch { }
    return $null
}

Write-Info "Haro Installer"
Write-Info "Repository: $RepoUrl"

# 1. Check Node.js
$nodeMajor = Get-NodeMajor
if ($null -eq $nodeMajor) {
    Write-ErrorX "Node.js 未安装。Haro 需要 Node.js >= $MinNodeMajor。"
    Write-Info "安装方式："
    Write-Info "  • 从 https://nodejs.org/ 下载 LTS 安装包"
    Write-Info "  • 或使用 winget: winget install OpenJS.NodeJS.LTS"
    exit 1
}

if ($nodeMajor -lt $MinNodeMajor) {
    Write-ErrorX "Node.js 版本过低（当前 v$((node --version).TrimStart('v'))），需要 >= $MinNodeMajor。"
    exit 1
}

Write-Success "Node.js v$((node --version).TrimStart('v')) 已满足"

# 2. Check package manager (prefer pnpm, fallback npm)
$pkgManager = $null
$pkgVersion = Get-PnpmVersion
if ($pkgVersion) {
    $pkgManager = "pnpm"
    Write-Success "pnpm v$pkgVersion 已安装"
} else {
    $pkgVersion = Get-NpmVersion
    if ($pkgVersion) {
        $pkgManager = "npm"
        Write-Warn "pnpm 未安装，将使用 npm v$pkgVersion（推荐安装 pnpm）"
    } else {
        Write-ErrorX "未找到 npm 或 pnpm。请至少安装 npm（随 Node.js 附带）。"
        exit 1
    }
}

# 3. Install global package
Write-Info "正在安装 $HaroPkg ..."
try {
    if ($pkgManager -eq "pnpm") {
        pnpm add -g "${HaroPkg}@latest" | Out-Host
    } else {
        npm install -g "${HaroPkg}@latest" | Out-Host
    }
} catch {
    Write-ErrorX "全局安装失败。请检查网络或 registry 配置。"
    exit 1
}

# 4. Verify haro is on PATH
$haroCmd = Get-Command haro -ErrorAction SilentlyContinue
if (-not $haroCmd) {
    Write-Warn "haro 命令未在 PATH 中找到。"
    Write-Warn "你可能需要重启终端，或手动将全局包 bin 目录添加到 PATH。"
    Write-Warn "  npm 全局 prefix: $(npm prefix -g 2>$null)"
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        Write-Warn "  pnpm 全局 prefix: $(pnpm prefix -g 2>$null)"
    }
} else {
    Write-Success "haro 已安装: $($haroCmd.Source)"
}

# 5. Create ~/.haro/
$haroHome = if ($env:HARO_HOME) { $env:HARO_HOME } else { Join-Path $env:USERPROFILE ".haro" }
if (-not (Test-Path $haroHome)) {
    New-Item -ItemType Directory -Path $haroHome -Force | Out-Null
    Write-Success "创建数据目录: $haroHome"
} else {
    Write-Info "数据目录已存在: $haroHome"
}

# 6. Print next steps
Write-Host ""
Write-Success "安装完成！"
Write-Host ""
Write-Info "下一步："
Write-Host "  1. 配置 OPENAI_API_KEY:"
Write-Host "     `$env:OPENAI_API_KEY = '<your-key>'"
Write-Host ""
Write-Host "  2. 运行首次引导:"
Write-Host "     haro setup"
Write-Host ""
Write-Host "  3. 检查健康状态:"
Write-Host "     haro doctor"
Write-Host ""
Write-Host "  4. 执行第一条任务:"
Write-Host '     haro run "列出当前目录下的 TypeScript 文件"'
Write-Host ""
Write-Host "  5. 查看帮助:"
Write-Host "     haro --help"
Write-Host ""
Write-Info "如需从源码开发，请访问: $RepoUrl"
