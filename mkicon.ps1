param(
  [string]$Src = "build\tray.ico",
  [string]$PngOut = "build\appicon.png",
  [string]$IcoOut = "build\tray.ico"
)
Add-Type -AssemblyName System.Drawing
# 取 256x256 帧导出 PNG，供 Wails 生成 exe 图标
$ico = New-Object System.Drawing.Icon($Src, 256, 256)
$bmp = $ico.ToBitmap()
$bmp.Save($PngOut, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose(); $ico.Dispose()
Write-Output ("PNG: " + $PngOut + "  " + (Get-Item $PngOut).Length + " bytes")
# 托盘需要真正的 ICO（含 16/32/48/256 多尺寸），原文件直接可用
Copy-Item -Path $Src -Destination $IcoOut -Force
Write-Output ("ICO: " + $IcoOut + "  " + (Get-Item $IcoOut).Length + " bytes")
