cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "0.9.0"
  sha256 arm:   "3b37673096d349992d263d3e67ea54c7c6279345129669d99692d8282c4be0b7",
         intel: "cfe03bdda2ca5bf33aef5027fc0fec3d2f2bd40c5edd4a8f8f0286de94bbc17d"

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
