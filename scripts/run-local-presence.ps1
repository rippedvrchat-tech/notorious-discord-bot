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

    $env:DISCORD_BOT_TOKEN = $token
    & node (Join-Path $repoPath 'scripts\local-presence.mjs') 2>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
  } catch {
    "[PresenceRunner] $($_.Exception.Message)" | Out-File -FilePath $logPath -Append -Encoding utf8
  }
  Start-Sleep -Seconds 15
}
