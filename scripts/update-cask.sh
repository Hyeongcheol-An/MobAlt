#!/bin/bash
# Write the Homebrew cask for the DMGs in dist/ and (optionally) push it to the tap repository.
#
#   scripts/update-cask.sh <version> [out-dir]
#
# sha256 values come from dist/MobAlt-<version>-{arm64,x64}.dmg, so run it after `npm run dist`.
# With HOMEBREW_TAP_DEPLOY_KEY set (private SSH key with write access to the tap), the script clones
# github.com/Hyeongcheol-An/homebrew-tap, updates Casks/mobalt.rb and pushes; otherwise it only writes
# the file to out-dir (default: Casks/, which is committed with each release so the repo itself can be tapped).
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?usage: update-cask.sh <version> [out-dir]}"
OUT="${2:-Casks}"
TAP_REPO="git@github.com:Hyeongcheol-An/homebrew-tap.git"

ARM="dist/MobAlt-${VERSION}-arm64.dmg"
X64="dist/MobAlt-${VERSION}-x64.dmg"
for f in "$ARM" "$X64"; do [ -f "$f" ] || { echo "missing $f"; exit 1; }; done
SHA_ARM=$(shasum -a 256 "$ARM" | cut -d' ' -f1)
SHA_X64=$(shasum -a 256 "$X64" | cut -d' ' -f1)

mkdir -p "$OUT"
CASK="$OUT/mobalt.rb"
cat > "$CASK" <<RUBY
cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "${VERSION}"
  sha256 arm:   "${SHA_ARM}",
         intel: "${SHA_X64}"

  url "https://github.com/Hyeongcheol-An/MobAlt/releases/download/v#{version}/MobAlt-#{version}-#{arch}.dmg"
  name "MobAlt"
  desc "MobaXterm-style SSH, SFTP and terminal workbench"
  homepage "https://github.com/Hyeongcheol-An/MobAlt"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :ventura"

  app "MobAlt.app"

  zap trash: [
    "~/Library/Application Support/MobAlt",
    "~/Library/Caches/MobAlt",
    "~/Library/Caches/io.github.hyeongcheol-an.mobalt",
    "~/Library/Logs/MobAlt",
    "~/Library/Preferences/io.github.hyeongcheol-an.mobalt.plist",
    "~/Library/Saved Application State/io.github.hyeongcheol-an.mobalt.savedState",
  ]
end
RUBY
echo "wrote $CASK (arm64 ${SHA_ARM:0:12}…, x64 ${SHA_X64:0:12}…)"

if [ -n "${HOMEBREW_TAP_DEPLOY_KEY:-}" ]; then
  KEY=$(mktemp)
  trap 'rm -f "$KEY"' EXIT
  printf '%s\n' "$HOMEBREW_TAP_DEPLOY_KEY" > "$KEY"
  chmod 600 "$KEY"
  export GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  TAP=$(mktemp -d)
  git clone -q --depth 1 "$TAP_REPO" "$TAP"
  mkdir -p "$TAP/Casks"
  cp "$CASK" "$TAP/Casks/mobalt.rb"
  git -C "$TAP" add Casks/mobalt.rb
  git -C "$TAP" -c user.name="mobalt-release-bot" -c user.email="mobalt-release-bot@users.noreply.github.com" \
    commit -q -m "mobalt ${VERSION}" || { echo "cask unchanged"; exit 0; }
  git -C "$TAP" push -q origin HEAD
  echo "pushed Casks/mobalt.rb ${VERSION} to homebrew-tap"
fi
