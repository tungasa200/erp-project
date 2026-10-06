# 역할 세션을 백그라운드 Claude 세션으로 띄우고 멈춘다. WY-pm이 실행한다.
#   session.ps1 list                 역할 세션 목록(VS Code 세션 포함)
#   session.ps1 start <역할> [지시]  멈춘 세션이 있으면 대화를 이어서, 없으면 인수인계 파일로 새로 띄운다
#   session.ps1 new <역할>           교대: 인수인계 파일로 새 세션을 띄운다(이전 세션은 먼저 stop)
#   session.ps1 stop <역할>          멈춘다. 대화는 남아 start로 이어진다
#   session.ps1 adopt <역할> <세션ID> 닫은 VS Code 세션의 대화를 백그라운드로 옮겨 멈춰 둔다(ID는 list --json 결과의 sessionId)
param([Parameter(Mandatory)][ValidateSet('list','start','new','stop','adopt')][string]$Cmd, [string]$Role, [string]$Prompt)

$ErrorActionPreference = 'Stop'
$Repo = 'C:\projects\erp-project'
$Roles = 'WY-commit','WY-search','WY-planner','WY-design','WY-backend1','WY-backend2','WY-frontend','WY-frontend2','WY-browser','WY-qa'
# 2026-10-06 이름 변경 전 이름. 멈춰 둔 옛 세션과 옛 인수인계 파일을 찾을 때만 쓴다(start로 이어 띄우면 새 이름이 붙는다)
$OldNames = @{ 'WY-commit'='erp-commit'; 'WY-search'='erp-search'; 'WY-planner'='erp-planner'; 'WY-design'='erp-design'
  'WY-backend1'='backend1'; 'WY-backend2'='backend2'; 'WY-frontend'='frontend'; 'WY-frontend2'='frontend2'; 'WY-browser'='browser-controller'; 'WY-qa'='qa' }
if ($Cmd -ne 'list' -and $Role -notin $Roles) { throw "역할 이름이 아닙니다: $Role (예: WY-qa)" }

# PowerShell 5.1의 ConvertFrom-Json은 JSON 배열을 한 덩어리로 넘기므로 괄호로 풀어서 넘긴다
function Get-Sessions { (claude agents --json --all 2>$null | ConvertFrom-Json) | ForEach-Object { $_ } }
function Get-Bg($name) {
  $names = @($name, $OldNames[$name]) | Where-Object { $_ }
  Get-Sessions | Where-Object { $_.kind -eq 'background' -and $_.name -in $names } | Sort-Object startedAt -Descending | Select-Object -First 1
}
# 멈춘 세션은 state가 stopped 또는 done으로 나온다
function Test-Running($s) { $s.state -notin 'stopped','done','failed' }
function Get-Handoff($name) {
  foreach ($n in @($name, $OldNames[$name]) | Where-Object { $_ }) {
    $f = Get-ChildItem "$env:USERPROFILE\.claude\session-data" -Filter "*-$n*-session.tmp" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match "^\d{4}-\d{2}-\d{2}-$n(-\d+)?-session\.tmp$" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { return $f }
  }
}
function Start-New($name) {
  $h = Get-Handoff $name
  $first = if ($h) { "/ecc:resume-session $($h.FullName -replace '\\','/')" }
           else { "역할 $name 으로 시작합니다. CLAUDE.md와 docs/진행현황.md를 읽고 WY-pm 지시를 기다리세요." }
  Push-Location $Repo; try { claude --bg --name $name $first } finally { Pop-Location }
}

switch ($Cmd) {
  'list' {
    Get-Sessions | Sort-Object name | Format-Table name, kind, @{n='상태';e={ if ($_.status) { $_.status } else { $_.state } }}, id -AutoSize
  }
  'start' {
    $s = Get-Bg $Role
    if ($s -and (Test-Running $s)) { "$Role 은 이미 실행 중입니다($($s.id))."; break }
    if (-not $s) {
      Start-New $Role
      # 첫 입력은 인수인계 불러오기라 지시를 함께 넘길 수 없다
      if ($Prompt) { "지시는 넘기지 않았습니다. 세션이 ListAgents에 보이면 SendMessage로 보내세요." }
      break
    }
    if (-not $Prompt) { $Prompt = '[WY-pm] 세션을 다시 띄웠습니다. CLAUDE.md·docs/진행현황.md에서 바뀐 점을 확인하고 pm 지시를 기다리세요.' }
    # 지시를 넘기면 대화 복사본이 새 ID로 뜬다: 이름을 다시 붙이고 멈춘 원본은 지운다(대화는 복사본에 그대로 있음)
    # PowerShell 5.1은 큰따옴표를 실행 파일 인자로 제대로 넘기지 못하므로 작은따옴표로 바꾼다
    $Prompt = $Prompt -replace '"', "'"
    Push-Location $Repo; try { claude --bg --resume $s.sessionId --name $Role $Prompt } finally { Pop-Location }
    if ((Get-Bg $Role).sessionId -ne $s.sessionId) { claude rm $s.id | Out-Null }
  }
  'new' {
    $s = Get-Bg $Role
    if ($s -and (Test-Running $s)) { throw "$Role 이 실행 중입니다. 인수인계 저장 뒤 stop 하고 다시 실행하세요." }
    Start-New $Role
  }
  'adopt' {
    if (-not $Prompt) { throw '세션ID가 필요합니다.' }
    # 지시 없이 이어 띄우면 대화가 기록되지 않은 빈 사본이 생겨, 다음 start 때 "source session not found"로 실패한다.
    # 그래서 한 줄 지시를 넘겨 대화를 남기고, 끝나면 멈춘다.
    $hello = "[WY-pm] 이 세션을 $Role 이름의 백그라운드 세션으로 옮겼습니다. 답은 '옮김 확인' 한 줄만 하고 다른 작업은 하지 마세요."
    Push-Location $Repo; try { claude --bg --resume $Prompt --name $Role $hello } finally { Pop-Location }
    "옮겼습니다. 답을 마치면 session.ps1 stop $Role 로 멈추세요."
  }
  'stop' {
    $s = Get-Bg $Role
    if (-not $s -or -not (Test-Running $s)) { "$Role 백그라운드 세션이 실행 중이 아닙니다."; break }
    claude stop $s.id
  }
}
