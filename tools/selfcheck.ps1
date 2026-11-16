# 飞行副驾 · SimConnect 自检
#
# 在装着 MSFS 2020 的那台机器上跑。不需要装 Coopanion，只验证底下的通道：
#   1. 能不能找到 SimConnect.dll
#   2. SimConnect_Open 能不能连上模拟器（游戏要开着、进到飞行里）
#   3. 66 个 SimVar 的名字和单位有没有写错的
#   4. 数据回包的结构体偏移对不对（高度、速度读出来是不是人话）
#
# 一条命令都不发，只读。结果写进同目录的 selfcheck-result.txt。

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'msfs-bridge.exe'
$varsFile = Join-Path $here 'vars.tsv'
$log = Join-Path $here 'selfcheck-result.txt'

$report = New-Object System.Collections.Generic.List[string]
function Say([string]$text) {
  Write-Host $text
  [void]$report.Add($text)
}

Say "=== 飞行副驾 SimConnect 自检 ==="
Say ("时间: " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ""

if (-not (Test-Path -LiteralPath $exe)) {
  Say "缺少 msfs-bridge.exe，自检中止。"
  $report | Out-File -FilePath $log -Encoding utf8
  exit 1
}

# ---------- 1. 找 SimConnect.dll ----------

Say "[1] 找 SimConnect.dll"
$dll = $null
$tried = New-Object System.Collections.Generic.List[string]

function Find-Dll([string]$path) {
  if ([string]::IsNullOrWhiteSpace($path)) { return $null }
  try {
    if (Test-Path -LiteralPath $path -PathType Leaf) { return (Resolve-Path -LiteralPath $path).Path }
  } catch { }
  return $null
}

if ($env:MSFS_SIMCONNECT_DLL) {
  $dll = Find-Dll $env:MSFS_SIMCONNECT_DLL
  if ($dll) { Say "  环境变量命中: $dll" }
}

# SDK 与游戏目录：所有盘符都扫一遍常见的相对路径。
if (-not $dll) {
  $drives = Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }
  $rels = @(
    'MSFS SDK\SimConnect SDK\lib\SimConnect.dll',
    'Microsoft Flight Simulator\SimConnect.dll',
    'Games\Microsoft Flight Simulator\SimConnect.dll'
  )
  foreach ($drive in $drives) {
    foreach ($rel in $rels) {
      $p = Join-Path $drive $rel
      $tried.Add($p)
      if (-not $dll) { $dll = Find-Dll $p }
    }
    if ($dll) { break }
  }
}

# Store 版：包在 WindowsApps 里。列目录名不需要提权。
if (-not $dll) {
  $apps = Join-Path $env:ProgramFiles 'WindowsApps'
  if (Test-Path -LiteralPath $apps) {
    try {
      Get-ChildItem -LiteralPath $apps -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'Microsoft.FlightSimulator_*' } |
        ForEach-Object {
          $p = Join-Path $_.FullName 'SimConnect.dll'
          $tried.Add($p)
          if (-not $dll) { $dll = Find-Dll $p }
        }
    } catch { }
  }
}

# Steam 版：默认库 + libraryfolders.vdf 里登记的其它库。
if (-not $dll) {
  $steamRoots = @()
  if (${env:ProgramFiles(x86)}) { $steamRoots += (Join-Path ${env:ProgramFiles(x86)} 'Steam') }
  if ($env:ProgramFiles) { $steamRoots += (Join-Path $env:ProgramFiles 'Steam') }
  foreach ($root in $steamRoots) {
    $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
      try {
        $text = Get-Content -LiteralPath $vdf -Raw
        foreach ($m in [regex]::Matches($text, '"path"\s+"([^"]+)"')) {
          $lib = $m.Groups[1].Value -replace '\\\\', '\'
          $p = Join-Path $lib 'steamapps\common\MicrosoftFlightSimulator\SimConnect.dll'
          $tried.Add($p)
          if (-not $dll) { $dll = Find-Dll $p }
        }
      } catch { }
    }
    $p2 = Join-Path $root 'steamapps\common\MicrosoftFlightSimulator\SimConnect.dll'
    $tried.Add($p2)
    if (-not $dll) { $dll = Find-Dll $p2 }
  }
}

# 最后碰运气：PATH 里。
if (-not $dll) {
  foreach ($dir in ($env:PATH -split ';')) {
    if ([string]::IsNullOrWhiteSpace($dir)) { continue }
    $p = Join-Path $dir 'SimConnect.dll'
    $tried.Add($p)
    if (-not $dll) { $dll = Find-Dll $p }
  }
}

if (-not $dll) {
  Say ("  没找到。试过 " + $tried.Count + " 个位置。")
  Say ""
  Say "  SDK 装好的话，通常在 <SDK 目录>\SimConnect SDK\lib\SimConnect.dll。"
  Say "  把完整路径填在下面（直接回车放弃）："
  $answer = Read-Host "  SimConnect.dll 路径"
  $dll = Find-Dll $answer
}

if (-not $dll) {
  Say "  仍然没找到，自检中止。"
  $report | Out-File -FilePath $log -Encoding utf8
  exit 1
}

Say ("  找到: " + $dll)
Say ""

# ---------- 2. 连接 ----------

Say "[2] 连接模拟器（游戏要开着，并且已经进到飞行里）"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$utf8 = New-Object System.Text.UTF8Encoding $false
$psi.StandardOutputEncoding = $utf8
$psi.StandardErrorEncoding = $utf8

$proc = [System.Diagnostics.Process]::Start($psi)

function Send-Line([string]$line) {
  # 直接写底层字节流。用 $proc.StandardInput.WriteLine 会走它自己的 StreamWriter，
  # 在 chcp 65001 下会往管道开头塞 UTF-8 BOM，对端读到的第一行变成 "\uFEFFOPEN"。
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($line + "`n")
  $stream = $proc.StandardInput.BaseStream
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Flush()
}

# StreamReader.Peek() 在管道没数据时会阻塞，用它做「读完就走」会把脚本挂死。
# 改成 ReadLineAsync + 超时：有数据立刻取，没数据最多等到期限。
$script:pendingRead = $null
function Read-For([int]$timeoutMs) {
  $lines = @()
  $deadline = [DateTime]::UtcNow.AddMilliseconds($timeoutMs)
  while ([DateTime]::UtcNow -lt $deadline) {
    if ($null -eq $script:pendingRead) {
      $script:pendingRead = $proc.StandardOutput.ReadLineAsync()
    }
    $remain = [int]([math]::Max(0, ($deadline - [DateTime]::UtcNow).TotalMilliseconds))
    if ($script:pendingRead.Wait($remain)) {
      $line = $script:pendingRead.Result
      $script:pendingRead = $null
      if ($null -eq $line) { break }
      if ($line.Length -gt 0) { $lines += $line }
    } else {
      break
    }
  }
  return $lines
}

Send-Line ("OPEN" + [char]9 + $dll)
Start-Sleep -Seconds 3
$openResult = Read-For 3000

$opened = $false
foreach ($line in $openResult) {
  if ($line -match '"type"\s*:\s*"opened"') { $opened = $true }
  if ($line -match '"type"\s*:\s*"error"') { Say ("  错误: " + $line) }
}

if (-not $opened) {
  Say "  连接失败。常见原因：游戏没开、还在主菜单没进飞行、或者 DLL 版本对不上。"
  Send-Line "CLOSE"
  Start-Sleep -Milliseconds 500
  [void](Read-For 500)
  $report | Out-File -FilePath $log -Encoding utf8
  exit 1
}

Say "  连上了。"
Say ""

# ---------- 3. 定义 66 个变量 ----------

Say "[3] 定义 SimVar（这一步能查出名字或单位写错的）"

$vars = @()
if (Test-Path -LiteralPath $varsFile) {
  foreach ($line in (Get-Content -LiteralPath $varsFile -Encoding utf8)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $vars += $line.TrimEnd("`r")
  }
} else {
  Say "  缺少 vars.tsv，自检中止。"
  Send-Line "CLOSE"
  exit 1
}

Say ("  变量数: " + $vars.Count)

$tab = [char]9
$defineLine = "DEFINE" + $tab + "1"
foreach ($v in $vars) {
  $fields = $v -split "`t"
  $defineLine += $tab + $fields[0] + $tab + $fields[1] + $tab + $fields[2]
}

Send-Line $defineLine
Start-Sleep -Seconds 2
$defineResult = Read-For 2000

$defineErrors = @()
foreach ($line in $defineResult) {
  if ($line -match '"errors"\s*:\s*\[') {
    $defineErrors += $line
  }
}

if ($defineErrors.Count -eq 0) {
  Say "  全部 66 个变量都定义成功。"
} else {
  Say "  有变量定义失败："
  foreach ($e in $defineErrors) { Say ("    " + $e) }
}
Say ""

# ---------- 3.5 逐变量体检 ----------
# AddToDataDefinition 对无效的名字或单位返回 0，错误是异步报的，
# 所以只能每个变量单独定义、单独要一次数据，看谁真的拿不回来。

Say "[3.5] 逐变量体检"

$probeLine = "PROBEALL"
foreach ($v in $vars) {
  $f = $v -split "`t"
  $probeLine += $tab + $f[0] + $tab + $f[1] + $tab + $f[2]
}
Send-Line $probeLine
Start-Sleep -Milliseconds 500
$probeResult = Read-For 8000

$probeSeen = 0
$probeFailed = @()
foreach ($pline in $probeResult) {
  if ($pline -match '"type"\s*:\s*"probe"') {
    $probeSeen++
    if ($pline -match '"ok"\s*:\s*false') { $probeFailed += $pline }
  }
}

if ($probeSeen -eq 0) {
  Say "  体检没有回包（桥接可能没起来）。"
} elseif ($probeFailed.Count -eq 0) {
  Say ("  " + $probeSeen + " 个变量全部拿到了数据。")
} else {
  Say ("  " + $probeSeen + " 个里有 " + $probeFailed.Count + " 个拿不到数据：")
  foreach ($pf in $probeFailed) { Say ("    " + $pf) }
}
Say ""

# ---------- 4. 读一帧 ----------

Say "[4] 请求数据（每秒一次）"

# 先探活：桥接进程还在不在、还理不理人。
if ($proc.HasExited) {
  Say ("  桥接进程已经退出了（退出码 " + $proc.ExitCode + "）。")
  $report | Out-File -FilePath $log -Encoding utf8
  exit 1
}
Send-Line "PING"
Start-Sleep -Milliseconds 200
$ping = Read-For 1500
if (($ping -join ' ') -match 'pong') {
  Say "  桥接在线。"
} else {
  Say ("  桥接没回 pong，原始输出: " + $(if ($ping.Count -gt 0) { $ping -join ' | ' } else { '（空）' }))
  Say ("  桥接日志: " + (Join-Path $here 'msfs-bridge.log'))
}

Send-Line ("REQUEST" + $tab + "1" + $tab + "second" + $tab + "1")

# 先单独确认 REQUEST 这条命令本身有没有被受理：有 requested 回执说明命令通了，
# 没回执说明卡在更前面，跟暂停无关。
Start-Sleep -Milliseconds 1500
$reqResult = Read-For 2000
if ($reqResult.Count -gt 0) {
  Say ("  命令回执: " + ($reqResult -join ' | '))
} else {
  Say "  命令回执: （空）——REQUEST 没有被受理"
}

# MSFS 默认在窗口失去焦点时暂停模拟，暂停后不会推送数据。
# 自检是在 cmd 窗口里跑的，所以这里主动把游戏切回前台。
$fs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like '*FlightSimulator*' } | Select-Object -First 1
if ($fs) {
  try {
    $shell = New-Object -ComObject WScript.Shell
    [void]$shell.AppActivate($fs.Id)
    Say ("  已把 " + $fs.ProcessName + " 切到前台（失焦时 MSFS 会暂停模拟）。")
  } catch {
    Say "  切前台失败，请手动点一下游戏窗口。"
  }
} else {
  Say "  没找到 FlightSimulator 进程，请手动点一下游戏窗口。"
}

Say "  等 6 秒收集数据…"
Start-Sleep -Seconds 6
$dataResult = Read-For 6000

$frame = $null
foreach ($line in $dataResult) {
  if ($line -match '"type"\s*:\s*"data"') { $frame = $line }
}

if (-not $frame) {
  Say "  没收到数据帧。"
  Say ("  这 6 秒的原始输出: " + $(if ($dataResult.Count -gt 0) { $dataResult -join ' | ' } else { '（空）' }))
  if ($reqResult.Count -eq 0) {
    Say "  REQUEST 本身就没有回执，问题在桥接，不在游戏。"
  } else {
    Say "  REQUEST 受理了但没有数据：多半是模拟器还在暂停状态。"
    Say "  检查两处：游戏窗口是否在前台；DevMode 的 Options 里 Pause Simulation 是否被勾上。"
  }
} else {
  Say "  收到数据帧。"
  Say ""
  Say "  原始:"
  Say ("    " + $frame)

  # 解析出来看人说人话：下标见 src/telemetry.ts 的 V。
  $json = $frame | ConvertFrom-Json
  $values = $json.values
  Say ""
  Say ("  值个数: " + $values.Count + "（应为 " + $vars.Count + "）")
  if ($values.Count -ne $vars.Count) {
    Say "  数量对不上：结构体偏移或字符串长度有问题。"
  } else {
    Say ""
    Say "  关键读数:"
    Say ("    机型 TITLE            = " + $values[64])
    Say ("    高度 PLANE ALTITUDE   = " + [math]::Round([double]$values[2], 0) + " ft")
    Say ("    离地 PLANE ALT AGL    = " + [math]::Round([double]$values[3], 0) + " ft")
    Say ("    空速 AIRSPEED IND     = " + [math]::Round([double]$values[7], 1) + " kt")
    Say ("    马赫 AIRSPEED MACH    = " + [math]::Round([double]$values[9], 3))
    Say ("    地速 GROUND VELOCITY  = " + [math]::Round([double]$values[10], 1) + " kt")
    Say ("    垂直速度 VERT SPEED   = " + [math]::Round([double]$values[11] * 60, 0) + " fpm")
    Say ("    在地面 SIM ON GROUND  = " + $values[12])
    Say ("    应答机码 XPNDR        = " + $values[31])
    Say ("    COM1 (MHz 单位)       = " + $values[27])
    Say ("    NAV1 (MHz 单位)       = " + $values[29])
    Say ("    模拟是否停住 SIM DISABLED = " + $values[65])

    # 合理性检查：MSFS 里高度的量级一眼能看出来对不对。
    $altFt = [double]$values[2]
    if ($altFt -eq 0 -and [double]$values[7] -eq 0 -and [string]$values[64] -eq '') {
      Say ""
      Say "  [警告] 全是零或空：很可能数据偏移不对，或者所有变量都定义失败。"
    } elseif ($altFt -gt 100000 -or $altFt -lt -2000) {
      Say ""
      Say ("  [警告] 高度 " + $altFt + " ft 不像真实值：结构体偏移可能不对。")
    }
  }
}

# ---------- 收尾 ----------

Send-Line "CLOSE"
Start-Sleep -Milliseconds 800
[void](Read-For 500)

Say ""
Say "=== 自检结束 ==="
Say ("结果已写入: " + $log)
Say ("桥接日志: " + (Join-Path $here 'msfs-bridge.log'))

$report | Out-File -FilePath $log -Encoding utf8
