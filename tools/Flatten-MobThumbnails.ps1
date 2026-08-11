<#
.SYNOPSIS
  Flattens Mob.wz's nested stand/0.png sprite images into a single flat folder,
  renamed so the app can reference them directly by mob ID.

.DESCRIPTION
  Expects a source tree shaped like:

    Mob.wz/<mobID>.img/stand/0.png

  e.g. Mob.wz/9400586.img/stand/0.png

  and produces, in the destination folder:

    9400586_stand_0.png

  for every mob that has one. Mobs missing a stand/0.png are skipped and
  reported at the end (some legitimately don't have a "stand" animation).

.PARAMETER SourceRoot
  Path to the folder containing the extracted Mob.wz (the folder that directly
  contains the "<mobID>.img" subfolders, e.g. ".\Mob.wz").

.PARAMETER DestFolder
  Path to the flat output folder. Created if it doesn't exist.

.EXAMPLE
  .\Flatten-MobThumbnails.ps1 -SourceRoot ".\Mob.wz" -DestFolder ".\mob_thumbs"

.EXAMPLE
  # Preview what would happen without copying anything
  .\Flatten-MobThumbnails.ps1 -SourceRoot ".\Mob.wz" -DestFolder ".\mob_thumbs" -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,

    [Parameter(Mandatory = $true)]
    [string]$DestFolder
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SourceRoot)) {
    throw "Source root not found: $SourceRoot"
}

if (-not (Test-Path -LiteralPath $DestFolder)) {
    New-Item -ItemType Directory -Path $DestFolder -Force | Out-Null
    Write-Host "Created destination folder: $DestFolder"
}

# Match "<mobID>.img" directories directly under SourceRoot, where mobID is
# purely numeric (guards against picking up unrelated folders).
$mobDirs = Get-ChildItem -LiteralPath $SourceRoot -Directory |
    Where-Object { $_.Name -match '^(?<id>\d+)\.img$' }

if ($mobDirs.Count -eq 0) {
    Write-Warning "No '<number>.img' folders found directly under '$SourceRoot'. Double-check -SourceRoot points at the Mob.wz folder itself."
}

$copied = 0
$missing = New-Object System.Collections.Generic.List[string]
$errors  = New-Object System.Collections.Generic.List[string]

foreach ($dir in $mobDirs) {
    $mobId = [regex]::Match($dir.Name, '^(?<id>\d+)\.img$').Groups['id'].Value

    $srcFile = Join-Path $dir.FullName "stand\0.png"

    if (-not (Test-Path -LiteralPath $srcFile)) {
        $missing.Add($mobId) | Out-Null
        continue
    }

    $destFile = Join-Path $DestFolder "${mobId}_stand_0.png"

    try {
        if ($PSCmdlet.ShouldProcess($destFile, "Copy from $srcFile")) {
            Copy-Item -LiteralPath $srcFile -Destination $destFile -Force
            $copied++
        }
    }
    catch {
        $errors.Add("$mobId : $($_.Exception.Message)") | Out-Null
    }
}

Write-Host ""
Write-Host "Done."
Write-Host "  Mob folders scanned : $($mobDirs.Count)"
Write-Host "  Thumbnails copied   : $copied"
Write-Host "  Missing stand/0.png : $($missing.Count)"
if ($errors.Count -gt 0) {
    Write-Host "  Errors              : $($errors.Count)" -ForegroundColor Yellow
}

if ($missing.Count -gt 0) {
    $missingLogPath = Join-Path $DestFolder "_missing_stand_animation.txt"
    $missing | Sort-Object | Set-Content -LiteralPath $missingLogPath
    Write-Host "  (List of mob IDs with no stand/0.png written to: $missingLogPath)"
}

if ($errors.Count -gt 0) {
    $errorLogPath = Join-Path $DestFolder "_copy_errors.txt"
    $errors | Set-Content -LiteralPath $errorLogPath
    Write-Host "  (List of copy errors written to: $errorLogPath)" -ForegroundColor Yellow
}
