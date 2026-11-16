# 飞行副驾 · cortico-world-msfs-copilot

《微软模拟飞行 2020》的副驾驶。它坐在右座，读 SimConnect 遥测，盯着飞行状态、告警、自动驾驶和导航，在起飞、巡航、下降、进近、接地这些节点开口。

定位是**监控飞行员（PM）**：报事实、报数字、报偏差，不教你怎么飞，也不替你做决定。

## 安装

```bash
npm install cortico-world-msfs-copilot
```

或者把 `npm pack` 出来的 tarball 装进 Coopanion 的插件目录。装好后在 Coopanion 里启用「飞行副驾」。

默认**只读**。要让它开灯、收放起落架、改频率、动自动驾驶，得在设置里打开「允许副驾动飞机」总闸和对应分项——自动驾驶那一项单独默认关闭，因为它能真的把飞机带走。

## 需要什么

- Windows（SimConnect 是 Windows 原生库）
- 微软模拟飞行 2020（Store 版或 Steam 版都行）
- .NET Framework 4.x（Windows 10/11 自带，桥接用它的 `csc.exe` 现场编译）
- `SimConnect.dll`——游戏安装目录里就有，插件会自动找；找不到可以在设置里手动指定

**不需要**安装 MSFS SDK。桥接自己 P/Invoke 原生 `SimConnect.dll`，不依赖 SDK 里的托管封装。

## 它是怎么连上的

```
Coopanion ──stdio JSON──> msfs-bridge.exe ──P/Invoke──> SimConnect.dll ──> MSFS 2020
```

桥接是一个 C# 控制台程序（`bridge/SimConnectBridge.cs`）。第一次连上时用 `%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 编译到数据目录，之后按源码 mtime 复用。

这样做的理由：Node 调不了原生 DLL，而目标机器上常常只装了游戏没装 SDK。自己声明 P/Invoke 只要原生 DLL 在就能跑，包也不用带预编译二进制。

连接失败不会让插件挂掉：工具会返回明确原因，插件每 5 秒重试一次。

## 它知道什么

- **飞行状态**：阶段、高度、离地高度、空速、马赫、地速、垂直速度、俯仰、坡度、航向、地面/空中。
- **自动驾驶**：接通状态，航向/高度/进近/NAV1 模式，选定的高度、航向、速度、垂直速度。
- **导航**：COM1/2、NAV1/2 频率，应答机码与状态，下滑道与航向道偏差，DME，下一个航路点。
- **环境**：风、外界温度、气压基准、能见度、降水。
- **告警**：失速、超速、结构结冰、高度偏离、起落架状态。

## 什么时候开口

| 事件 | 正文带什么 |
|---|---|
| `msfs.takeoff` | 离地速度、抬轮姿态、航向 |
| `msfs.cruise` | 巡航高度、马赫、空速 |
| `msfs.descent` | 当前高度、下降率、空速 |
| `msfs.approach` | 距跑道、高度、航向道偏差 |
| `msfs.touchdown` | 下沉率、接地俯仰、坡度、航向 |
| `msfs.stall` | 空速、俯仰、离地高度 |
| `msfs.overspeed` | 马赫、空速、高度 |
| `msfs.altitude_alert` | 选定高度、实际高度、偏差 |
| `msfs.connected` / `msfs.disconnected` | 机型与阶段 / 断开原因 |

事件只陈述事实，说不说、怎么说由模型决定。每条都能在配置里单独关掉。

## 工具

只读：

- `msfs_status` — 飞行状态
- `msfs_ap` — 自动驾驶
- `msfs_nav` — 无线电与导航
- `msfs_wx` — 天气与环境
- `msfs_alerts` — 当前告警与起落架

写操作（默认全关，要操作者逐项打开）：

- `msfs_radio` — COM/NAV 频率、应答机码、气压基准
- `msfs_switch` — 灯光、起落架
- `msfs_ap_set` — 自动驾驶：接通/断开、航向/高度/NAV/速度/垂直速度保持、自动油门预位，以及目标高度/航向/速度/垂直速度

没开放的那一项会明确拒绝并说明是哪一项，不会含糊地说「不行」。

起落架在地面上时拒绝收起。操纵面（副翼、升降舵、油门杆、配平）一律只读。

`msfs_ap_set` 的 11 个动作：

| 类别 | 动作 |
|---|---|
| 开关 | `master`、`heading`、`altitude`、`nav`、`speed`、`vs`、`autothrottle` |
| 目标值 | `target_altitude`（英尺）、`target_heading`（度）、`target_speed`（节）、`target_vs`（英尺/分，可负） |

`AP_MASTER` 和 `AUTO_THROTTLE_ARM` 在 SimConnect 里都是 toggle 事件，没有「设为开」的版本。`master` 会先比对当前状态再决定发不发；`autothrottle` 因为没读 `AUTOTHROTTLE ACTIVE`，只能直接 toggle。

**进近模式（APPR）做不到**——MSFS 的事件表里没有 `AP_APPR`，只有 `AP_NAV1_HOLD`。要截获下滑道得靠飞机自身的进近逻辑。

## 配置

| 项 | 默认 | 说明 |
|---|---|---|
| `pollMs` | 500 | 遥测间隔；SimConnect 是秒级推送，小于 1 秒按 1 秒算 |
| `metric` | 关 | 打开后用米、公里每小时、百帕报数 |
| `simconnectDll` | 空 | 留空自动探测 |
| `cruiseAltFt` | 3000 | 高于它且垂直速度平稳才算巡航 |
| `altitudeAlertFt` | 300 | 高度偏离阈值 |
| `approachCooldownSec` | 90 | 同一次进近的重复提醒间隔 |
| `writeEnabled` | 关 | 写权限总闸 |
| `writeLights` / `writeGear` / `writeRadio` / `writeBaro` / `writeXpndr` | 开 | 分项权限，总闸关着时都不生效 |
| `writeAp` | **关** | 自动驾驶。单独默认关闭——它能真的把飞机带走 |

## 提示词模板变量

环境提示词 `src/ENV_PROMPT.md` 里的可变部分全是占位符，WebUI 里能看到当前展开值：

| 变量 | 内容 |
|---|---|
| `{{msfs.connected}}` | 连接状态或失败原因 |
| `{{msfs.aircraft}}` | 当前机型（`TITLE`） |
| `{{msfs.phase}}` | 当前飞行阶段 |
| `{{msfs.simRate}}` | 仿真倍率（MSFS 没有可读的倍率变量，固定报「未提供」） |
| `{{msfs.paused}}` | 是否暂停 |
| `{{msfs.units}}` | 报数单位制 |

轮询间隔和写权限状态刻意不进提示词：前者模型不需要知道，后者由工具在拒绝时说明。

## 已知限制

- **只支持默认机**。PMDG、Fenix 这类第三方机模大量状态走 LVAR 和 ClientData，标准 `A:` 变量在它们身上读不到或不完整。
- **仿真倍率读不到**。MSFS 只提供调倍速的**事件**（`SIM_RATE`），没有可读的倍率状态变量，所以这一项固定报「未提供」。
- **进近模式（APPR）做不到**。MSFS 的事件表里没有 `AP_APPR`，只有 `AP_NAV1_HOLD`。
- **操纵面一律只读**。副翼、升降舵、油门杆、配平不在权限里，这是刻意的。
- **总剩余距离是估算**。MSFS 只给飞行计划全程（`GPS FLIGHTPLAN TOTAL DISTANCE`）和预计时间（`GPS ETE`），剩余距离按 `ETE × 当前地速` 推算，正文里会写明「按当前地速约」。

## 真机联调记录

2026-11-12 在 Boeing 747-8i（Asobo 默认机）上跑通，巡航 10,378 ft：

- 70 个 SimVar 全部有效，一帧 70 个值不缺
- 高度/离地/空速/马赫/地速/垂直速度/应答机/COM/NAV 读数合理且互相自洽
- 外界气压 20.56 inHg ↔ 695 hPa ↔ 10,378 ft 三者对得上

联调过程中修掉五个会让「一个字都收不到」的问题，全部记在 [AGENTS.md](AGENTS.md) 的「已经踩过的坑」里。
`tools/selfcheck.ps1` 是当时用的自检脚本，`PROBEALL` 逐变量体检能一次性找出无效的变量名或单位。

## 许
- **暂停检测依赖 `Pause` 系统事件**。有些机模或场景下 SimConnect 不一定发这个事件。

## 开发

```bash
npm install
npm test          # 81 个测试
npm run typecheck
npm run describe:extension   # 改了工具/事件/提示词之后重跑
```

`tests/manifest.test.ts` 会校验 `describe.json` 与 `definition.ts` 是否同步、配置组的键与默认值是否一一对应。

## 许可

MIT
