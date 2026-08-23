$ErrorActionPreference = 'Continue'
$repoPath = 'C:\Users\bryso\AppData\Local\Temp\notorious-discord-bot'
$readmePath = 'C:\Users\bryso\OneDrive\Desktop\READMECODEX.txt'
$logPath = Join-Path $repoPath 'presence.log'

while ($true) {
  try {
    $lines = Get-Content -LiteralPath $readmePath -TotalCount 2
    $renderKey = $lines[1].Substring($lines[1].IndexOf(':') + 1).Trim()
    $renderHeaders = @{ Authorization = "Bearer $renderKey" }
    $envs = Invoke-RestMethod -Headers $renderHeaders -Uri 'https://api.render.com/v1/services/srv-da4srqvqj5pc73b3qoa0/env-vars'
    $token = ($envs | Where-Object { $_.envVar.key -eq 'DISCORD_BOT_TOKEN' }).envVar.value
    if (-not $token) { throw 'DISCORD_BOT_TOKEN was not returned by Render.' }
    $applicationId = ($envs | Where-Object { $_.envVar.key -eq 'DISCORD_APPLICATION_ID' }).envVar.value

    $env:DISCORD_BOT_TOKEN = $token
    $env:DISCORD_APPLICATION_ID = $applicationId
    $env:DISCORD_ACTIVITY_LARGE_IMAGE = 'notorious_banner'
    $env:WEBSITE_URL = 'https://ogpill.xyz'
    $env:JOIN_URL = 'https://notorious-discord-bot.onrender.com/join'
    & node (Join-Path $repoPath 'scripts\local-presence.mjs') 2>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
  } catch {
    "[PresenceRunner] $($_.Exception.Message)" | Out-File -FilePath $logPath -Append -Encoding utf8
  }
  Start-Sleep -Seconds 15
}
