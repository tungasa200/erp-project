# 역할 세션을 백그라운드 Claude 세션으로 띄우고 멈추고 교대한다. WY-pm이 실행한다.
#   session.ps1 list                    역할 세션 목록(VS Code 세션 포함)
#   session.ps1 health                  역할별 대화 크기·마지막 활동, 교대 권장 표시
#   session.ps1 start <역할> [지시]     멈춘 세션이 있으면 대화를 이어서, 없으면 역할 파일로 새로 띄운다
#   session.ps1 stop <역할>             멈춘다. 대화는 남아 start로 이어진다
#   session.ps1 prep <역할>             교대 준비: 진행 중인 것만 save-session으로 저장하라고 지시한다
#   session.ps1 rotate <역할> [경로]    교대: 이전 세션을 멈추고 역할 파일(+인수인계 경로)로 새 세션을 띄운다
#   session.ps1 adopt <역할> <세션ID>   닫은 VS Code 세션의 대화를 백그라운드로 옮긴다
#   session.ps1 pm-cmd [경로]           pm 교대용: 사용자가 새 터미널에 붙여 넣을 명령을 출력한다
param([Parameter(Mandatory)][ValidateSet('list','health','start','stop','prep','rotate','adopt','pm-cmd')][string]$Cmd, [string]$Role, [string]$Prompt)

# claude.exe가 stderr로 진행 문구를 내면 PowerShell 5.1이 'Stop'에서 오류로 끊어 버려 백그라운드 시작이 실패한다
$ErrorActionPreference = 'Continue'
$Repo = 'C:\projects\erp-project'
$Roles = 'WY-commit','WY-search','WY-planner','WY-design','WY-backend1','WY-backend2','WY-frontend','WY-frontend2','WY-browser','WY-qa'
# 2026-10-06 이름 변경 전 이름. 옛 인수인계 파일을 찾을 때만 쓴다
$OldNames = @{ 'WY-commit'='erp-commit'; 'WY-search'='erp-search'; 'WY-planner'='erp-planner'; 'WY-design'='erp-design'
  'WY-backend1'='backend1'; 'WY-backend2'='backend2'; 'WY-frontend'='frontend'; 'WY-frontend2'='frontend2'; 'WY-browser'='browser-controller'; 'WY-qa'='qa'; 'WY-pm'='project-pm' }
# 교대 권장 기준: 대화 기록 크기(MB)
$RotateMB = 5
$Transcripts = "$env:USERPROFILE\.claude\projects\c--projects-erp-project"
if ($Cmd -notin 'list','health','pm-cmd' -and $Role -notin $Roles) { throw "역할 이름이 아닙니다: $Role (예: WY-qa)" }

# PowerShell 5.1의 ConvertFrom-Json은 JSON 배열을 한 덩어리로 넘기므로 괄호로 풀어서 넘긴다
function Get-Sessions { (claude agents --json --all 2>$null | ConvertFrom-Json) | ForEach-Object { $_ } }
function Get-Bg($name) {
  Get-Sessions | Where-Object { $_.kind -eq 'background' -and $_.name -eq $name } | Sort-Object startedAt -Descending | Select-Object -First 1
}
# 멈춘 세션은 state가 stopped·done·failed로 나온다
function Test-Running($s) { $s.state -notin 'stopped','done','failed' }
function Get-Transcript($s) { if ($s) { Get-Item "$Transcripts\$($s.sessionId).jsonl" -ErrorAction SilentlyContinue } }
function Get-Handoff($name) {
  foreach ($n in @($name, $OldNames[$name]) | Where-Object { $_ }) {
    $f = Get-ChildItem "$env:USERPROFILE\.claude\session-data" -Filter "*-$n*-session.tmp" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "^\d{4}-\d{2}-\d{2}-$n(-\d+)?-session\.tmp$" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { return $f }
  }
}
# 새 세션: 역할 파일(.claude/agents/<역할>.md)을 --agent로 싣는다. 인수인계 경로가 있으면 그것부터 불러온다
function Start-New($name, $handoff) {
  $first = if ($handoff) { "/ecc:resume-session $($handoff -replace '\\','/')" }
           else { "[WY-pm] 새 세션입니다. 역할 파일 지시대로 CLAUDE.md와 docs/진행현황.md(역할별 다음 할 일의 내 줄)를 읽고, WY-pm에 SendMessage로 '$name 시작, 다음 할 일: …' 한 줄을 보낸 뒤 지시를 기다리세요." }
  Push-Location $Repo; try { claude --bg --agent $name --name $name $first } finally { Pop-Location }
}

switch ($Cmd) {
  'list' {
    Get-Sessions | Sort-Object name | Format-Table name, kind, @{n='상태';e={ if ($_.status) { $_.status } else { $_.state } }}, id -AutoSize
  }
  'health' {
    $all = Get-Sessions
    $(foreach ($r in $Roles) {
      $s = $all | Where-Object { $_.kind -eq 'background' -and $_.name -eq $r } | Sort-Object startedAt -Descending | Select-Object -First 1
      $t = Get-Transcript $s
      $mb = if ($t) { [math]::Round($t.Length / 1MB, 1) } else { 0 }
      [pscustomobject]@{ 역할 = $r; 상태 = if ($s) { $s.state } else { '없음' }; '대화(MB)' = $mb
        '마지막 활동' = if ($t) { $t.LastWriteTime.ToString('MM-dd HH:mm') } else { '-' }
        권장 = if ($mb -ge $RotateMB) { '교대' } else { '' } }
    }) | Format-Table -AutoSize
  }
  'start' {
    $s = Get-Bg $Role
    if ($s -and (Test-Running $s)) { "$Role 은 이미 실행 중입니다($($s.id))."; break }
    # 대화 기록이 없는 항목은 이어 띄울 수 없다("source session not found"). 역할 파일로 새로 띄운다
    if (-not $s -or -not (Get-Transcript $s)) {
      if ($s) { claude rm $s.id | Out-Null }
      Start-New $Role (Get-Handoff $Role).FullName
      if ($Prompt) { "새 세션으로 띄웠습니다. 지시는 '시작' 회신을 받은 뒤 SendMessage로 보내세요." }
      break
    }
    if (-not $Prompt) { $Prompt = '[WY-pm] 세션을 다시 띄웠습니다. CLAUDE.md·docs/진행현황.md에서 바뀐 점을 확인하고 지시를 기다리세요.' }
    # 지시를 넘겨 이어 띄운다. 지시 없이 띄우면 빈 사본이 생겨 다음에 실패한다
    # PowerShell 5.1은 큰따옴표를 실행 파일 인자로 제대로 넘기지 못하므로 작은따옴표로 바꾼다
    $Prompt = $Prompt -replace '"', "'"
    Push-Location $Repo; try { claude --bg --resume $s.sessionId --name $Role $Prompt } finally { Pop-Location }
    $n = Get-Bg $Role
    if ($n -and $n.sessionId -ne $s.sessionId) { claude rm $s.id | Out-Null }
  }
  'stop' {
    $s = Get-Bg $Role
    if (-not $s -or -not (Test-Running $s)) { "$Role 백그라운드 세션이 실행 중이 아닙니다."; break }
    claude stop $s.id
  }
  'prep' {
    $msg = "[WY-pm 교대 준비] 컨텍스트가 길어져 새 세션으로 교대합니다. 지금 하던 일을 멈출 수 있는 지점까지만 마무리하고, 진행 중인 것(미커밋 파일, 반쯤 한 작업, 막힌 이유)만 /ecc:save-session 으로 저장하세요. short-id는 $Role (같은 날 두 번째면 $Role-2). 역할 설명과 끝난 일은 적지 마세요. 진행 중인 것이 하나도 없으면 저장하지 말고 '진행 중 없음'이라고만 알리세요. 끝나면 WY-pm에 SendMessage로 저장 경로 또는 '진행 중 없음' 한 줄."
    $s = Get-Bg $Role
    if ($s -and (Test-Running $s)) { "실행 중인 세션입니다. 이 문구를 SendMessage로 보내세요:"; $msg; break }
    if (-not $s) { "$Role 세션이 없습니다. 교대할 필요 없이 start 하세요."; break }
    Push-Location $Repo; try { claude --bg --resume $s.sessionId --name $Role $msg } finally { Pop-Location }
  }
  'rotate' {
    $s = Get-Bg $Role
    if ($s -and (Test-Running $s)) { claude stop $s.id | Out-Null }
    if ($s) { claude rm $s.id | Out-Null }   # 작업 항목만 지운다. 대화 기록 파일은 남는다
    $h = if ($Prompt -and $Prompt -ne 'none') { $Prompt } else { $null }
    Start-New $Role $h
    "교대했습니다. 새 세션이 '시작' 또는 인계 확인을 보내면 '멈춰 있는 동안 끝난 일'을 SendMessage로 알려 주세요."
  }
  'adopt' {
    if (-not $Prompt) { throw '세션ID가 필요합니다.' }
    # 지시 없이 이어 띄우면 빈 사본이 생기므로 한 줄 지시를 넘긴다. 끝나면 stop
    $hello = "[WY-pm] 이 세션을 $Role 이름의 백그라운드 세션으로 옮겼습니다. 답은 '옮김 확인' 한 줄만 하고 다른 작업은 하지 마세요."
    Push-Location $Repo; try { claude --bg --resume $Prompt --name $Role $hello } finally { Pop-Location }
    "옮겼습니다. 답을 마치면 session.ps1 stop $Role 로 멈추세요."
  }
  'pm-cmd' {
    $h = if ($Prompt) { $Prompt } else { (Get-Handoff 'WY-pm').FullName }
    if (-not $h) { throw 'WY-pm 인수인계 파일이 없습니다. 먼저 /ecc:save-session (short-id WY-pm)을 실행하세요.' }
    "아래 한 줄을 새 터미널(또는 VS Code 새 Claude 패널)에서 실행하면 WY-pm이 이어집니다. 이전 pm 창은 닫으세요."
    "cd $Repo; claude --name WY-pm `"/ecc:resume-session $($h -replace '\\','/')`""
  }
}
