Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-MisHorasIcon {
    param(
        [int]$Size,
        [string]$FileName,
        [double]$ClockRadiusFactor
    )

    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(37, 99, 235),
        [System.Drawing.Color]::FromArgb(15, 42, 112),
        45.0
    )
    $graphics.FillRectangle($background, $rect)

    $glow = New-Object System.Drawing.SolidBrush(
        [System.Drawing.Color]::FromArgb(20, 255, 255, 255)
    )
    $graphics.FillEllipse(
        $glow,
        [int]($Size * 0.60),
        [int]($Size * 0.60),
        [int]($Size * 0.50),
        [int]($Size * 0.50)
    )

    $centerX = [single]($Size / 2.0)
    $centerY = [single]($Size / 2.0)
    $radius = [single]($Size * $ClockRadiusFactor)
    $stroke = [single]($Size * 0.044)

    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, $stroke)
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

    $graphics.DrawEllipse(
        $pen,
        [single]($centerX - $radius),
        [single]($centerY - $radius),
        [single]($radius * 2),
        [single]($radius * 2)
    )

    $minuteAngle = [Math]::PI / 3.0
    $hourAngle = 5.0 * [Math]::PI / 3.0
    $minuteLength = $radius * 0.58
    $hourLength = $radius * 0.40

    $graphics.DrawLine(
        $pen,
        $centerX,
        $centerY,
        [single]($centerX + $minuteLength * [Math]::Sin($minuteAngle)),
        [single]($centerY - $minuteLength * [Math]::Cos($minuteAngle))
    )
    $graphics.DrawLine(
        $pen,
        $centerX,
        $centerY,
        [single]($centerX + $hourLength * [Math]::Sin($hourAngle)),
        [single]($centerY - $hourLength * [Math]::Cos($hourAngle))
    )

    $dotBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $dotRadius = [single]($Size * 0.030)
    $graphics.FillEllipse(
        $dotBrush,
        [single]($centerX - $dotRadius),
        [single]($centerY - $dotRadius),
        [single]($dotRadius * 2),
        [single]($dotRadius * 2)
    )

    $path = Join-Path $outDir $FileName
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

    $dotBrush.Dispose()
    $pen.Dispose()
    $glow.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Host "Creado $path"
}

New-MisHorasIcon -Size 180 -FileName 'icon-180.png' -ClockRadiusFactor 0.285
New-MisHorasIcon -Size 192 -FileName 'icon-192.png' -ClockRadiusFactor 0.285
New-MisHorasIcon -Size 512 -FileName 'icon-512.png' -ClockRadiusFactor 0.285
New-MisHorasIcon -Size 512 -FileName 'maskable-512.png' -ClockRadiusFactor 0.225
