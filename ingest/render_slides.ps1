# Render every slide of every ingested PowerPoint job aid to JPEG for the source viewer, at full reading resolution
# (default 3200 px wide, quality 92; the height follows each deck's own slide shape, so 4:3 decks aren't stretched).
# Opens files READ-ONLY via PowerPoint; never saves the originals. Skips images that already exist.
# Usage: powershell -File ingest/render_slides.ps1 -SrcDir "<job aid folder>" -Corpus content/real/corpus.base.json -OutDir content/real/slides [-Width 3200] [-Quality 92]
param([string]$SrcDir, [string]$Corpus, [string]$OutDir, [int]$Width = 3200, [int]$Quality = 92)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $OutDir | Out-Null
$c = Get-Content -Raw -Encoding UTF8 $Corpus | ConvertFrom-Json
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)
$tmp = Join-Path $env:TEMP ("ka-render-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $tmp | Out-Null
$app = New-Object -ComObject PowerPoint.Application
$done = 0; $skipped = 0; $failed = @()
try {
  foreach ($s in $c.sources) {
    if ($s.format -ne 'pptx') { continue }
    $need = @($s.slides | Where-Object { -not $_.transcribed } | ForEach-Object { $_.n } | Where-Object { -not (Test-Path (Join-Path $OutDir ("{0}-{1}.jpg" -f $s.id, $_))) })
    if ($need.Count -eq 0) { $skipped++; continue }
    try {
      $p = $app.Presentations.Open((Join-Path $SrcDir $s.file), $true, $false, $false)   # ReadOnly, no window
      $h = [int][Math]::Round($Width * $p.PageSetup.SlideHeight / $p.PageSetup.SlideWidth)
      foreach ($n in $need) {
        $png = Join-Path $tmp "s.png"
        $p.Slides.Item([int]$n).Export($png, "PNG", $Width, $h)
        $img = [System.Drawing.Image]::FromFile($png)
        $img.Save((Join-Path $OutDir ("{0}-{1}.jpg" -f $s.id, $n)), $enc, $ep)
        $img.Dispose(); Remove-Item $png
        $done++
      }
      $p.Close()
    } catch { $failed += "$($s.file): $($_.Exception.Message)" }
  }
} finally { $app.Quit() }
"rendered=$done  sources_already_complete=$skipped  failed=$($failed.Count)  width=$Width quality=$Quality"
$failed | ForEach-Object { "  FAIL $_" }
