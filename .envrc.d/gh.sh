# Install/update GitHub CLI (gh) to ~/.local/bin from GitHub releases
# Checks for updates once per day on direnv reload
# Minimum version: 2.49.0 (fixes Projects Classic deprecation error)

GH_MIN_VERSION="2.49.0"

_gh_arch() {
  case "$(uname -m)" in
    x86_64)        echo "amd64" ;;
    aarch64|arm64) echo "arm64" ;;
    *) echo "unsupported" ;;
  esac
}

_gh_os() {
  case "$(uname -s)" in
    Linux)  echo "linux" ;;
    Darwin) echo "macOS" ;;
    *) echo "unsupported" ;;
  esac
}

_gh_latest_version() {
  curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null \
    | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1
}

_gh_version_ge() {
  # Returns 0 if $1 >= $2 (semver comparison)
  printf '%s\n%s\n' "$2" "$1" | sort -V | head -1 | grep -qx "$2"
}

_gh_install() {
  local version=$1
  local os=$(_gh_os)
  local arch=$(_gh_arch)
  local asset="gh_${version}_${os}_${arch}.tar.gz"
  local url="https://github.com/cli/cli/releases/download/v${version}/${asset}"

  echo "gh: installing v${version}..."
  local tmpdir
  tmpdir=$(mktemp -d)
  if curl -fsSL "$url" | tar xz -C "$tmpdir"; then
    mkdir -p "$HOME/.local/bin"
    mv "$tmpdir/gh_${version}_${os}_${arch}/bin/gh" "$HOME/.local/bin/gh"
    echo "gh: v${version} installed to ~/.local/bin/gh"
  else
    echo "gh: failed to download $asset"
  fi
  rm -rf "$tmpdir"
}

_gh_ensure() {
  local bin="$HOME/.local/bin/gh"
  local stamp="$HOME/.local/share/gh/.update-check"
  mkdir -p "$HOME/.local/share/gh"

  if [[ ! -x "$bin" ]]; then
    # No local install — check system gh
    local sys_gh
    sys_gh=$(which gh 2>/dev/null || true)
    if [[ -n "$sys_gh" ]]; then
      local sys_ver
      sys_ver=$("$sys_gh" --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -1)
      if _gh_version_ge "$sys_ver" "$GH_MIN_VERSION"; then
        return 0  # System gh is new enough
      fi
    fi
    local latest=$(_gh_latest_version)
    [[ -n "$latest" ]] && _gh_install "$latest"
  elif [[ ! -f "$stamp" ]] || [[ -n $(find "$stamp" -mtime +1 2>/dev/null) ]]; then
    local current
    current=$("$bin" --version 2>/dev/null | sed -n 's/.*version \([0-9][0-9.]*\).*/\1/p' | head -1)
    local latest=$(_gh_latest_version)
    if [[ -n "$latest" && "$current" != "$latest" ]]; then
      echo "gh: $current -> $latest"
      _gh_install "$latest"
    fi
    touch "$stamp"
  fi
}

_gh_ensure
PATH_add "$HOME/.local/bin"
