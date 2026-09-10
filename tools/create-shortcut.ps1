# 在桌面创建「DSH Desktop」快捷方式。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools/create-shortcut.ps1
#   powershell ... -File tools/create-shortcut.ps1 -TargetDir "C:\path\to\DSH Desktop"
param(
    [string]$TargetDir = (Join-Path $PSScriptRoot "..\dist\DSH Desktop"),
    [string]$ShortcutName = "DSH Desktop.lnk"
)

$ErrorActionPreference = "Stop"

$exe = Join-Path $TargetDir "DSH Desktop.exe"
if (-not (Test-Path $exe)) {
    Write-Error "找不到 $exe，请先运行 npm run dist 打包。"
    exit 1
}

$desktop = [Environment]::GetFolderPath("Desktop")
$link = Join-Path $desktop $ShortcutName

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = (Resolve-Path $TargetDir).Path
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = "DeepSeek Harness 桌面端"
$shortcut.Save()

Write-Host "已创建桌面快捷方式：$link"
Write-Host "指向：$exe"
