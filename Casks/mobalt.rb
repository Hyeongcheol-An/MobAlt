cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "0.15.2"
  sha256 arm:   "f00dcac452cccbc3a71ef703903df562202588d0286ba95ff0aef6240e5fbb65",
         intel: "eb30625ef4ce3a432e9eb57a1d5ee983eb3f97fd68957c9ff72069d65c48fed0"

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
