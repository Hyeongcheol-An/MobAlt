cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "0.12.0"
  sha256 arm:   "9fb25e0cdf242ba63a21a9d38a745ddba3ff1a7ac8f2a85c6a7dec71e1cf46c3",
         intel: "349fda2ec29021ed520ed198924f2013a4e61c9867cf9ef1b1870bac03cf1ad0"

  url "https://github.com/Hyeongcheol-An/MobAlt/releases/download/v#{version}/MobAlt-#{version}-#{arch}.dmg"
  name "MobAlt"
  desc "MobaXterm-style SSH, SFTP and terminal workbench"
  homepage "https://github.com/Hyeongcheol-An/MobAlt"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
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
