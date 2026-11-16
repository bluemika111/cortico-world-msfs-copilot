# AGENTS.md

发布检查表。这个包是一个 Cortico World 扩展。怎么写一个：
[docs/worlds.md](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/worlds.md) 和
[docs/extensions.md](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md)。
`pnpm describe:extension <dir>` 和 `pnpm check:extension <dir>` 在 Cortico 检出根目录下运行；
`<dir>` 是这个包的目录。

- [ ] **契约版本**：`cortico.api` 等于 `check:extension` 打印的 `Contracts:` 行里的 world 版本。
  别的值包不会被加载。
- [ ] **自描述**：改了工具、事件类型或环境提示词之后，跑 `pnpm describe:extension <dir>`。
  `cortico.describe` 说明写了哪个文件，`files` 要把它带上。
- [ ] **标签**：`cortico.tags` 列出 [TAGS.md](https://github.com/Pal-AI-Lab/cortico-extensions/blob/main/TAGS.md) 里
  「when」合适的每个标签，含通知与警告类。
- [ ] **CHANGELOG.md** 有对应版本的 `## <version>` 段落。
- [ ] **`os`**：只在一个平台跑的包要设 npm 的 `os` 字段。
- [ ] **`pnpm check:extension <dir>`** 通过。

## 这个包的注意事项

- `os` 是 `win32`：SimConnect 是 Windows 原生库，桥接用 .NET Framework 的 `csc.exe` 编译，定位逻辑也只认 Windows 路径。
- 没有运行期依赖。`bridge/SimConnectBridge.cs` 由 `src/probe/build.ts` 在首次连接时用系统 `csc.exe` 编译到 World 的 `dataDir`，按源码 mtime 缓存；包里不带二进制。
- 桥接源码只用 C# 5 语法：.NET Framework 4.x 自带的 `csc.exe` 不认字符串插值和 `?.` 之类。
- `describe.json` 由 `scripts/describe.ts` 生成。改了工具、事件或 `src/ENV_PROMPT.md` 之后重跑。
- `tests/manifest.test.ts` 会在 vitest 里跑 `check:extension` 的那几项检查（清单解析、自描述比对、配置组与默认值对应），因为那条命令要 tsx 转译、而转译器会 spawn 子进程。
- 环境提示词里凡是用户可调或运行时探测到的量都用 `{{msfs.*}}` 占位符，并在 `webUi().promptDocs[].vars` 里声明；值由 `envPromptVars()` 提供，每次前缀重建时重取。
- SimVar 的下标集中在 `src/telemetry.ts` 的 `V` 里。加变量只能往 `SIMVARS` 末尾追加，或者同步改 `V`——桥接按声明顺序解析，错一位就全错。
- 桥接的 `SIMCONNECT_PERIOD` 枚举是 `NEVER=0, ONCE=1, VISUAL_FRAME=2, SIM_FRAME=3, SECOND=4`，不是从 1 开始的顺序值。

## 上真机时要核对的

开发环境没有装 MSFS，下面这些是按 SDK 文档写的，第一次接真机要逐条验：

- `SimConnect_Open` / `CallDispatch` 在控制台进程里的消息泵是否稳定。
- `SIMCONNECT_RECV_SIMOBJECT_DATA` 各字段偏移（12 字节头 + 7 个 DWORD = 数据从 40 开始）。
- `COM ACTIVE FREQUENCY:1` 用 `MHz` 单位是否返回浮点频率；如果不是，改用 `Frequency BCD16` 并自己换算。
- `SIMULATION RATE` 是否是可读的 SimVar；读不到时回落到 1 倍。
- `COM_STBY_RADIO_SET_HZ` + `COM_STBY_RADIO_SWAP` 组合是否真的把主频改掉。
- `KOHLSMAN_SET` 只传 `dwData`（mb × 16）时，高度表索引是否默认为第一块。

## 已经踩过的坑（真机联调 2026-11-12）

这四条都真实发生过，症状都是「发出去没回应」，很容易误判成游戏没开或暂停：

1. **`SIMCONNECT_PERIOD` 枚举**：`NEVER=0, ONCE=1, VISUAL_FRAME=2, SIM_FRAME=3, SECOND=4`。
   写成 1 会变成 ONCE，只推一次。
2. **`SIMCONNECT_RECV_ID` 枚举**：`EXCEPTION=1, OPEN=2, QUIT=3, EVENT=4, SIMOBJECT_DATA=8`。
   把 `OPEN`(2) 当成 `QUIT` 会让泵线程在连接成功后 35 毫秒就退出——日志里表现为
   「SimConnect_Open 成功」紧接着「模拟器发来 quit」，而游戏明明还在跑。
3. **`AddToDataDefinition` 的 `DatumID`**：传 `0` 不是「自动分配」，是同一个真实 ID。
   同一 define 内所有变量共用一个 ID 会互相覆盖，67 个变量最后只剩 1 个。
   必须传 `SIMCONNECT_UNUSED`（`0xFFFFFFFF`）或每个变量唯一值。
   这个错很阴：`AddToDataDefinition` 返回 0 表示成功，错误是**异步**通过
   `RECV_ID_EXCEPTION` 报出来的，必须看日志里的异常码。
4. **`CallDispatch` 阻塞**：它是给 Windows 消息循环设计的，控制台里没消息就干等。
   把命令处理也放在同一个线程会让所有后续命令永远排队。现在命令在主线程、
   派发在泵线程，用非阻塞的 `GetNextDispatch` 轮询。

另外两条环境坑：

- **管道 BOM**：PowerShell 的 `StandardInput` 在 `chcp 65001` 下会往管道开头写 UTF-8 BOM，
  对端读到 `\uFEFFOPEN`。桥接固定用无 BOM 的 `StreamReader/StreamWriter` 并 `TrimStart('\uFEFF')`。
- **`StreamReader.Peek()` 阻塞**：管道没数据时它不返回 -1 而是阻塞，用它判断「还有没有数据」
  会把整个调用方挂死。自检脚本改用 `ReadLineAsync()` + 超时。
