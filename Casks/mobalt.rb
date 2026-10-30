cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "0.9.1"
  sha256 arm:   "d3e7fb32d30b557ee7cb008c7c1d7c490aea4d31e15e19495b48fe85241f9482",
         intel: "c14155fff38105d04d2ab47fd1faf911c7fb2150c411477478030d0eb1746c4a"

  url "https://github.com/Hyeongcheol-An/MobAlt/releases/download/v#{version}/MobAlt-#{version}-#{arch}.dmg"
  name "MobAlt"
  desc "MobaXterm-style SSH, SFTP and terminal workbench"
  homepage "https://github.com/Hyeongcheol-An/MobAlt"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :ventura

  app "MobAlt.app"

  zap trash: [
    "~/Library/Application Support/MobAlt",
    "~/Library/Caches/io.github.hyeongcheol-an.mobalt",
    "~/Library/Caches/MobAlt",
    "~/Library/Logs/MobAlt",
    "~/Library/Preferences/io.github.hyeongcheol-an.mobalt.plist",
    "~/Library/Saved Application State/io.github.hyeongcheol-an.mobalt.savedState",
  ]
end
