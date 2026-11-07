#!/bin/bash
# ソースから .vsix を作る。必要なもの: zip(無ければ python3)。出力先のパスを標準出力へ出す。
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
[ -n "$VER" ] || { echo "package.json から version を読めない" >&2; exit 1; }
OUT="$PWD/tex-sync-view-$VER.vsix"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/extension"
cp -R package.json extension.js media "$T/extension/"
[ -f README.md ] && cp README.md "$T/extension/"
[ -f LICENSE ] && cp LICENSE "$T/extension/"
cat > "$T/[Content_Types].xml" <<'X'
<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/><Default Extension=".mjs" ContentType="application/javascript"/><Default Extension=".css" ContentType="text/css"/><Default Extension=".md" ContentType="text/markdown"/><Default Extension=".vsixmanifest" ContentType="text/xml"/><Default Extension=".bcmap" ContentType="application/octet-stream"/><Default Extension=".pfb" ContentType="application/octet-stream"/><Default Extension=".ttf" ContentType="application/octet-stream"/><Default Extension="" ContentType="text/plain"/></Types>
X
cat > "$T/extension.vsixmanifest" <<X
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="tex-sync-view" Version="$VER" Publisher="fatcorn753"/>
    <DisplayName>TeX Sync View</DisplayName>
    <Description xml:space="preserve">TeX 専用の PDF プレビューと SyncTeX 連動</Description>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets>
</PackageManifest>
X
rm -f "$OUT"
if [ -z "${TEXSYNC_NO_ZIP:-}" ] && command -v zip >/dev/null 2>&1; then
  (cd "$T" && zip -qr "$OUT" '[Content_Types].xml' extension.vsixmanifest extension)
elif command -v python3 >/dev/null 2>&1; then
  (cd "$T" && python3 - "$OUT" <<'PY'
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for top in ("[Content_Types].xml", "extension.vsixmanifest", "extension"):
        if os.path.isdir(top):
            for d, _, fs in os.walk(top):
                for f in fs: z.write(os.path.join(d, f))
        else:
            z.write(top)
PY
  )
else
  echo "zip も python3 も無いので .vsix を作れない。Releases の .vsix を使うか、どちらかを入れてください。" >&2
  exit 1
fi
echo "$OUT"
