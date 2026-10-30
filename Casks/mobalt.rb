cask "mobalt" do
  arch arm: "arm64", intel: "x64"

  version "0.10.1"
  sha256 arm:   "868048d73a221d7661b2041a3eeec19576a11da647975ab4f3382905171110f9",
         intel: "9af4614b7cccf174fb9dbab0d33be9082c5b4ea38418bdeceeb1166e9d3a41a6"

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
