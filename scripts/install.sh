#!/usr/bin/env bash
set -euo pipefail

# Haro Installer — macOS / Linux
# Usage: curl -fsSL https://raw.githubusercontent.com/haro-ai/haro/main/scripts/install.sh | bash

REPO_URL="https://github.com/haro-ai/haro"
MIN_NODE_MAJOR=22
HARO_PKG="@haro/cli"

info() { printf '\033[34m[INFO]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[WARN]\033[0m %s\n' "$*"; }
error() { printf '\033[31m[ERROR]\033[0m %s\n' "$*" >&2; }
success() { printf '\033[32m[OK]\033[0m %s\n' "$*"; }

detect_node() {
  if command -v node >/dev/null 2>&1; then
    local version
    version=$(node --version 2>/dev/null | sed 's/^v//')
    local major
    major=$(echo "$version" | cut -d. -f1)
    echo "$major"
    return 0
  fi
  echo ""
  return 1
}

detect_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm --version 2>/dev/null
    return 0
  fi
  echo ""
  return 1
}

detect_npm() {
  if command -v npm >/dev/null 2>&1; then
    npm --version 2>/dev/null
    return 0
  fi
  echo ""
  return 1
}

main() {
  info "Haro Installer"
  info "Repository: $REPO_URL"

  # 1. Check Node.js
  local node_major
  node_major=$(detect_node || true)
  if [ -z "$node_major" ]; then
    error "Node.js 未安装。Haro 需要 Node.js >= $MIN_NODE_MAJOR。"
    info "安装方式："
    info "  • macOS: brew install node@22"
    info "  • Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
    info "  • 或使用 nvm: nvm install 22 && nvm use 22"
    exit 1
  fi

  if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
    error "Node.js 版本过低（当前 v$(node --version | sed 's/^v//')），需要 >= $MIN_NODE_MAJOR。"
    exit 1
  fi

  success "Node.js v$(node --version | sed 's/^v//') 已满足"

  # 2. Check package manager (prefer pnpm, fallback npm)
  local pkg_manager=""
  local pkg_version=""

  pkg_version=$(detect_pnpm || true)
  if [ -n "$pkg_version" ]; then
    pkg_manager="pnpm"
    success "pnpm v$pkg_version 已安装"
  else
    pkg_version=$(detect_npm || true)
    if [ -n "$pkg_version" ]; then
      pkg_manager="npm"
      warn "pnpm 未安装，将使用 npm v$pkg_version（推荐安装 pnpm）"
    else
      error "未找到 npm 或 pnpm。请至少安装 npm（随 Node.js 附带）。"
      exit 1
    fi
  fi

  # 3. Install global package
  info "正在安装 $HARO_PKG ..."
  if [ "$pkg_manager" = "pnpm" ]; then
    if ! pnpm add -g "$HARO_PKG"@latest; then
      error "全局安装失败。请检查网络或 registry 配置。"
      exit 1
    fi
  else
    if ! npm install -g "$HARO_PKG"@latest; then
      error "全局安装失败。请检查网络或 registry 配置。"
      exit 1
    fi
  fi

  # 4. Verify haro is on PATH
  if ! command -v haro >/dev/null 2>&1; then
    warn "haro 命令未在 PATH 中找到。"
    warn "你可能需要手动将全局包 bin 目录添加到 PATH："
    warn "  npm 全局 bin: $(npm bin -g 2>/dev/null || echo '<unknown>')"
    if command -v pnpm >/dev/null 2>&1; then
      warn "  pnpm 全局 bin: $(pnpm bin -g 2>/dev/null || echo '<unknown>')"
    fi
  else
    success "haro 已安装: $(command -v haro)"
  fi

  # 5. Create ~/.haro/
  local haro_home="${HARO_HOME:-$HOME/.haro}"
  if [ ! -d "$haro_home" ]; then
    mkdir -p "$haro_home"
    success "创建数据目录: $haro_home"
  else
    info "数据目录已存在: $haro_home"
  fi

  # 6. Print next steps
  echo ""
  success "安装完成！"
  echo ""
  info "下一步："
  echo "  1. 配置 OPENAI_API_KEY:"
  echo "     export OPENAI_API_KEY=<your-key>"
  echo ""
  echo "  2. 运行首次引导:"
  echo "     haro setup"
  echo ""
  echo "  3. 检查健康状态:"
  echo "     haro doctor"
  echo ""
  echo "  4. 执行第一条任务:"
  echo "     haro run \"列出当前目录下的 TypeScript 文件\""
  echo ""
  echo "  5. 查看帮助:"
  echo "     haro --help"
  echo ""
  info "如需从源码开发，请访问: $REPO_URL"
}

main "$@"
