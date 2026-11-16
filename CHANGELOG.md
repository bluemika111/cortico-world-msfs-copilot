# Changelog

## 0.1.5

- README 补上 `msfs_ap_set` 与 `writeAp`，删掉「自动驾驶没做」这句过时的话。
- CHANGELOG 补齐 0.1.2–0.1.4 的条目。

## 0.1.4

- 事件正文统一加 `[MSFS-2020]` 前缀，和用户发言区分开。
- `msfs_ap_set` 增加 `speed`、`vs`、`autothrottle` 三个动作。

## 0.1.3

- **事件不再冒充 user 消息**：`origin` 从 `internal` 改为 `external`。框架里 `internal` 的正文无条件拼进 user 消息，只有 `external` 才按 `eventDelivery`（默认 `tool`）走合成工具回执。
- 新增 4 个航路变量：`GPS FLIGHTPLAN TOTAL DISTANCE`、`GPS WP ETE`、`GPS ETE`、`GPS WP NEXT ALT`。`msfs_nav` 现在报全程、下一航路点、到目的地预计时间；剩余距离按 `ETE × 地速` 估算。
- 新增 `msfs_ap_set` 工具与 `writeAp` 配置（默认关）：接通/断开、航向/高度/NAV 保持、目标高度/航向/速度/垂直速度。
- 桥接的事件参数改为按有符号解析，`target_vs` 可以传负数。

## 0.1.2

- 去掉 `panels` 声明。面板需要单独的前端构建产物（`cortico.webUiClient`），本包没有打包 React 组件，声明了会导致面板页签加载失败。状态改由 `lamps` 和 `msfs_status` 提供。

## 0.1.1

真机联调（Boeing 747-8i，2026-11-12）。修掉五个会让整条数据链路「一个字都收不到」的问题：

- `SIMCONNECT_PERIOD` 枚举值：`SECOND` 是 4，不是 1。
- `SIMCONNECT_RECV_ID` 枚举值：`OPEN=2`、`QUIT=3`、`EVENT=4`。把 2 当成 `QUIT` 会让泵线程在连接成功后几十毫秒就退出。
- `AddToDataDefinition` 的 `DatumID`：传 `0` 不是「自动分配」，同一定义里所有变量共用一个 ID 会互相覆盖，必须传 `SIMCONNECT_UNUSED`。
- 单位名：`enum`、`mask`、`BCD16` 都不在 SimConnect 的单位表里，改用 `number` 后自行解码。
- `SIMCONNECT_DATATYPE_STRING256` 是 9，不是 11；11 是 `STRINGV`（变长），会让周期性请求一律回 `DEFINITION_ERROR`。

架构调整：

- 命令处理移到主线程，派发单独一个泵线程，改用非阻塞的 `GetNextDispatch`。此前派发循环一阻塞，命令就永远排队。
- stdin/stdout 自己开无 BOM 的 UTF-8 流，不再依赖控制台代码页。
- 新增 `PROBEALL` 逐变量体检：每个变量单独定义、单次请求，一次性找出无效的名字或单位。
- 新增 `msfs-bridge.log`，记录命令、连接握手、异常码与 `sendId`/`index`。

遥测：

- 新增 `SIM DISABLED`，用于判断模拟是否停住。
- 移除并不存在的 `SIMULATION RATE` SimVar；`msfs.simRate` 模板变量改为如实报「未提供」。
- `xpndrCode` 同时兼容十进制与 BCD 两种应答机码返回形态。

## 0.1.0

首个版本。

- SimConnect 桥接：C# 控制台程序自己 P/Invoke 原生 `SimConnect.dll`，不依赖 MSFS SDK 的托管封装；首次连接时用系统 `csc.exe` 编译，之后按源码 mtime 复用。
- 遥测：66 个 SimVar，覆盖飞行状态、自动驾驶、无线电与导航、天气环境、告警、灯光与起落架回读、接地参数、机型与仿真倍率。
- 飞行阶段推断：停机、滑行、起飞滑跑、爬升、巡航、下降、进近、着陆、滑跑，带 1.2 秒滞后。
- 事件：离地、到达巡航、开始下降、进近建立、接地、失速、超速、高度偏离，以及连接与断开。每项可单独关闭。
- 工具：`msfs_status`、`msfs_ap`、`msfs_nav`、`msfs_wx`、`msfs_alerts` 只读；`msfs_radio`、`msfs_switch` 写操作，默认全关、逐项打开。
- 单位：航空单位（英尺、节、海里、英寸汞柱）为默认，可切公制。
- 提示词模板变量：`msfs.connected`、`msfs.aircraft`、`msfs.phase`、`msfs.simRate`、`msfs.paused`、`msfs.units`。
- 连接失败不阻塞挂载：工具返回明确原因，插件每 5 秒重试。
