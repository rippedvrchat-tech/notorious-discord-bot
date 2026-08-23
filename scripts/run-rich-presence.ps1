$ErrorActionPreference = 'Continue'
$repoPath = 'C:\Users\bryso\AppData\Local\Temp\notorious-discord-bot'
$logPath = Join-Path $repoPath 'rich-presence.log'
$env:DISCORD_RPC_CLIENT_ID = '1502781288141033573'

while ($true) {
  & node (Join-Path $repoPath 'scripts\local-rich-presence.mjs') 2>&1 | Out-File -FilePath $logPath -Append -Encoding utf8
  Start-Sleep -Seconds 15
}
