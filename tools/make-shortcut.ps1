$ErrorActionPreference = "Stop"
# 바탕화면에 "깍깍이" 바로가기를 만듭니다.
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $desktop "깍깍이.lnk"))
$link.TargetPath = Join-Path $root "start.bat"
$link.WorkingDirectory = $root
$link.IconLocation = (Join-Path $root "tools\icon.ico") + ",0"
$link.WindowStyle = 7  # 검은 창은 작게(최소화) 띄움
$link.Description = "까마귀 깍깍이가 내 번호로 문자를 콕콕 보내드려요"
$link.Save()
Write-Host ""
Write-Host "바탕화면에 [깍깍이] 바로가기를 만들었어요!"
Write-Host "이 폴더를 옮기거나 지우면 바로가기가 작동하지 않으니, 폴더는 그대로 두세요."
