// SimConnectBridge.cs —— 飞行副驾的 SimConnect 桥接进程。
//
// 为什么要有它：SimConnect 是原生 DLL 接口，Node 没法直接调。这里用 P/Invoke 直接
// 绑原生 SimConnect.dll 的导出函数，不依赖 MSFS SDK 里的托管封装（Microsoft.FlightSimulator.SimConnect.dll），
// 因为目标机器上很可能只装了游戏、没装 SDK，而原生 DLL 游戏目录里一定有。
//
// 线程模型（踩过坑，别改回去）：
//   * 主线程读 stdin、执行全部命令。命令永远不会被派发循环挡住。
//   * 泵线程只做两件事：SimConnect_Open（窗口属于它）和 GetNextDispatch 轮询取消息。
//   早先把命令处理也放在泵线程里，结果 CallDispatch/GetNextDispatch 一阻塞，
//   后面的命令就全排着队没人管——外面只能看到「发出去没回应」。
//
// 编译（由 src/probe/build.ts 调用）：
//   csc.exe /nologo /codepage:65001 /target:exe /out:msfs-bridge.exe SimConnectBridge.cs
// 只用 C# 5 语法：.NET Framework 4.x 自带的 csc.exe 不认字符串插值和 ?. 之类。
//
// 协议：
//   stdin  每行一条命令，字段用 \t 分隔（固定无 BOM 的 UTF-8）
//     PING
//     OPEN\t<dllPath>
//     DEFINE\t<id>\t<name>\t<unit>\t<type>\t<name>\t<unit>\t<type>...
//     REQUEST\t<id>\t<second|frame|once>\t<interval>
//     SUBSCRIBE\t<id>\t<systemEventName>
//     EVENT\t<eventName>\t[data]
//     CLOSE
//   stdout 每行一个 JSON 对象
//     {"type":"pong"}
//     {"type":"opened"}
//     {"type":"defined","id":1[,"errors":[...]]}
//     {"type":"requested","id":1}
//     {"type":"subscribed","id":100}
//     {"type":"sent","name":"TOGGLE_LANDING_LIGHTS"}
//     {"type":"data","id":1,"values":[0.5,"A320neo"]}
//     {"type":"event","id":100,"name":"1sec","data":0}
//     {"type":"error","message":"..."}
//     {"type":"quit"}
//     {"type":"closed"}

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class SimConnectBridge
{
    // ---- SimConnect 常量 ----
    private const uint ObjectIdUser = 0;
    // SIMCONNECT_PERIOD: NEVER=0, ONCE=1, VISUAL_FRAME=2, SIM_FRAME=3, SECOND=4
    private const uint PeriodOnce = 1;
    private const uint PeriodVisualFrame = 2;
    private const uint PeriodSimFrame = 3;
    private const uint PeriodSecond = 4;
    private const uint DataTypeFloat64 = 4;
    // SIMCONNECT_DATATYPE：INT32=1, INT64=2, FLOAT32=3, FLOAT64=4, STRING8=5,
    // STRING32=6, STRING64=7, STRING128=8, STRING256=9, STRING260=10, STRINGV=11。
    // 写成 11 就是 STRINGV（变长），会让整个定义变成变长定义，
    // RequestDataOnSimObject 一律回 DEFINITION_ERROR——单次请求却又能过，极难发现。
    private const uint DataTypeString256 = 9;
    // SIMCONNECT_RECV_ID：NULL=0, EXCEPTION=1, OPEN=2, QUIT=3, EVENT=4, ..., SIMOBJECT_DATA=8
    // 错一个值就会把「连接确认」当成「模拟器退出」，泵线程连上即自杀。
    private const uint RecvIdException = 1;
    private const uint RecvIdOpen = 2;
    private const uint RecvIdQuit = 3;
    private const uint RecvIdEvent = 4;
    private const uint RecvIdSimObjectData = 8;
    private const uint GroupPriorityHighest = 1;
    private const uint EventFlagGroupIdIsPriority = 0x00000010;
    /// <summary>
    /// AddToDataDefinition 的 DatumID 传 0 不是「自动分配」，而是一个真实 ID：
    /// 同一 define 里所有变量都用它，后写的会覆盖前面的，67 个变量最后只剩 1 个。
    /// 要么传 SIMCONNECT_UNUSED，要么每个变量给唯一值。
    /// </summary>
    private const uint DatumIdUnused = 0xFFFFFFFF;

    // ---- P/Invoke ----
    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int SimConnect_Open(out IntPtr phSimConnect, string szName, IntPtr hWnd,
        uint userEventWin32, uint hEventHandle, uint configIndex);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int SimConnect_Close(IntPtr hSimConnect);

    /// <summary>非阻塞取一条消息；没有消息时返回非零错误码。必须在 Open 的线程调用。</summary>
    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int SimConnect_GetNextDispatch(IntPtr hSimConnect, out IntPtr ppData, out uint pcbData);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int SimConnect_AddToDataDefinition(IntPtr hSimConnect, uint defineId,
        string datumName, string unitsName, uint datumType, float fEpsilon, uint datumId);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int SimConnect_RequestDataOnSimObject(IntPtr hSimConnect, uint requestId,
        uint defineId, uint objectId, uint period, uint flags, uint origin, uint interval, uint limit);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int SimConnect_MapClientEventToSimEvent(IntPtr hSimConnect, uint eventId, string eventName);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int SimConnect_TransmitClientEvent(IntPtr hSimConnect, uint objectId,
        uint eventId, uint dwData, uint groupId, uint flags);

    [DllImport("SimConnect.dll", CallingConvention = CallingConvention.StdCall, CharSet = CharSet.Ansi)]
    private static extern int SimConnect_SubscribeToSystemEvent(IntPtr hSimConnect, uint eventId, string systemEventName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectory(string lpPathName);

    // ---- 状态 ----
    // 两张表会被主线程写、泵线程读，必须用并发容器。
    private static readonly ConcurrentDictionary<uint, List<string>> DefineTypes =
        new ConcurrentDictionary<uint, List<string>>();
    private static readonly ConcurrentDictionary<uint, string> EventNames =
        new ConcurrentDictionary<uint, string>();
    private static readonly ConcurrentDictionary<uint, int> ExceptionCounts =
        new ConcurrentDictionary<uint, int>();
    /// <summary>逐变量体检时收到过数据的 defineId；体检用 200 以上的高位 id，不碰正式定义的 1。</summary>
    private static readonly ConcurrentDictionary<uint, bool> ProbeReceived =
        new ConcurrentDictionary<uint, bool>();
    private static readonly object OutLock = new object();
    private static readonly object LogLock = new object();
    private static readonly ManualResetEventSlim OpenedEvent = new ManualResetEventSlim(false);

    private static IntPtr _hSimConnect = IntPtr.Zero;
    private static volatile bool _running = true;
    private static volatile bool _opened;
    private static volatile int _openHr = int.MinValue;
    private static string _pendingDllPath;
    private static Thread _pump;
    private static uint _nextEventId = 1000;
    private static StreamReader _in;
    private static StreamWriter _out;
    private static StreamWriter _log;

    private static void Main()
    {
        var utf8 = new UTF8Encoding(false);
        _in = new StreamReader(Console.OpenStandardInput(), utf8, true);
        _out = new StreamWriter(Console.OpenStandardOutput(), utf8);
        _out.AutoFlush = true;
        OpenLog();

        Log("启动，pid=" + ProcessId());

        // 主线程：读命令、执行命令。派发在泵线程，卡住也不影响这里。
        string line;
        while ((line = _in.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            Handle(line);
            if (line.TrimStart('\uFEFF') == "CLOSE") break;
        }

        _running = false;
        if (_pump != null) _pump.Join(2000);
        Log("退出");
        CloseLog();
    }

    private static void OpenLog()
    {
        try
        {
            string exePath = System.Reflection.Assembly.GetExecutingAssembly().Location;
            string dir = Path.GetDirectoryName(exePath);
            if (string.IsNullOrEmpty(dir)) return;
            _log = new StreamWriter(Path.Combine(dir, "msfs-bridge.log"), false, new UTF8Encoding(false));
            _log.AutoFlush = true;
        }
        catch
        {
            _log = null;
        }
    }

    private static void CloseLog()
    {
        if (_log == null) return;
        try { _log.Dispose(); } catch { }
        _log = null;
    }

    private static void Log(string message)
    {
        if (_log == null) return;
        lock (LogLock)
        {
            try { _log.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + "  " + message); }
            catch { }
        }
    }

    private static int ProcessId()
    {
        try { return System.Diagnostics.Process.GetCurrentProcess().Id; }
        catch { return -1; }
    }

    // ---- 命令 ----

    private static void Handle(string line)
    {
        // 单条命令出错不能让进程死掉，也不能让后面的命令跟着消失。
        try
        {
            HandleInner(line);
        }
        catch (Exception ex)
        {
            Log("命令异常 " + line.Split('\t')[0] + ": " + ex);
            Emit("{\"type\":\"error\",\"message\":" + Json("处理命令失败 " + line.Split('\t')[0] + ": "
                + ex.GetType().Name + " " + ex.Message) + "}");
        }
    }

    private static void HandleInner(string line)
    {
        // 双保险：StreamReader 已经会跳过 BOM，这里再吃掉一次。
        line = line.TrimStart('\uFEFF');
        if (line.Length == 0) return;
        string[] parts = line.Split('\t');
        Log("收到命令 " + parts[0]);
        switch (parts[0])
        {
            case "PING": Emit("{\"type\":\"pong\"}"); break;
            case "OPEN": DoOpen(parts.Length > 1 ? parts[1] : ""); break;
            case "DEFINE": if (RequireOpen()) DoDefine(parts); break;
            case "REQUEST": if (RequireOpen()) DoRequest(parts); break;
            case "SUBSCRIBE": if (RequireOpen()) DoSubscribe(parts); break;
            case "EVENT": if (RequireOpen()) DoEvent(parts); break;
            case "PROBEALL": if (RequireOpen()) DoProbeAll(parts); break;
            case "CLOSE": _running = false; break;
            default:
                Emit("{\"type\":\"error\",\"message\":" + Json("未知命令 " + parts[0]) + "}");
                break;
        }
    }

    /// <summary>没连上就发数据命令会让 P/Invoke 拿到零句柄直接崩，先挡一道。</summary>
    private static bool RequireOpen()
    {
        if (_opened) return true;
        Emit("{\"type\":\"error\",\"message\":" + Json("还没连上模拟器，先发 OPEN") + "}");
        return false;
    }

    private static void DoOpen(string dllPath)
    {
        if (_opened)
        {
            Emit("{\"type\":\"opened\"}");
            return;
        }
        if (_pump != null)
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("OPEN 正在进行中") + "}");
            return;
        }

        _pendingDllPath = dllPath;
        OpenedEvent.Reset();
        _pump = new Thread(PumpLoop);
        _pump.IsBackground = true;
        _pump.Start();

        // 等泵线程把连接建立起来。SimConnect_Open 自身很慢，给足时间。
        if (!OpenedEvent.Wait(15000))
        {
            Log("SimConnect_Open 超时");
            Emit("{\"type\":\"error\",\"message\":" + Json("SimConnect_Open 超时（15 秒）") + "}");
            return;
        }
        if (_openHr != 0 || !_opened)
        {
            Log("SimConnect_Open 失败 hr=" + _openHr);
            Emit("{\"type\":\"error\",\"message\":" + Json("SimConnect_Open 返回 " + _openHr) + "}");
            return;
        }
        Log("SimConnect_Open 成功");
        Emit("{\"type\":\"opened\"}");
    }

    private static void DoDefine(string[] parts)
    {
        uint id;
        if (parts.Length < 2 || !uint.TryParse(parts[1], out id))
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("DEFINE 缺少有效 id") + "}");
            return;
        }
        var types = new List<string>();
        var errors = new List<string>();
        for (int i = 2; i + 2 < parts.Length; i += 3)
        {
            string name = parts[i];
            string unit = parts[i + 1];
            string type = parts[i + 2];
            uint datumType = type == "str" ? DataTypeString256 : DataTypeFloat64;
            int hr = SimConnect_AddToDataDefinition(_hSimConnect, id, name, unit, datumType, 0f, DatumIdUnused);
            // 逐条记失败，不中断：自检要一次看清所有写错的变量名或单位。
            if (hr != 0) errors.Add(name + " => " + hr);
            types.Add(type);
        }
        DefineTypes[id] = types;
        Log("DEFINE 完成，变量 " + types.Count + "，失败 " + errors.Count);
        if (errors.Count > 0)
        {
            Emit("{\"type\":\"defined\",\"id\":" + id + ",\"errors\":[" + string.Join(",", errors.ConvertAll(Json).ToArray()) + "]}");
        }
        else
        {
            Emit("{\"type\":\"defined\",\"id\":" + id + "}");
        }
    }

    private static void DoRequest(string[] parts)
    {
        uint id;
        if (parts.Length < 3 || !uint.TryParse(parts[1], out id))
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("REQUEST 缺少有效 id") + "}");
            return;
        }
        uint period;
        switch (parts[2])
        {
            case "once": period = PeriodOnce; break;
            case "visual": period = PeriodVisualFrame; break;
            case "frame": period = PeriodSimFrame; break;
            default: period = PeriodSecond; break;
        }
        uint interval = 1;
        if (parts.Length > 3) uint.TryParse(parts[3], out interval);
        if (interval == 0) interval = 1;
        int hr = SimConnect_RequestDataOnSimObject(_hSimConnect, id, id, ObjectIdUser, period, 0, 0, interval, 0);
        if (hr != 0)
        {
            Log("RequestDataOnSimObject 失败 hr=" + hr);
            Emit("{\"type\":\"error\",\"message\":" + Json("RequestDataOnSimObject 返回 " + hr) + "}");
            return;
        }
        Log("REQUEST 受理 id=" + id + " period=" + parts[2]);
        Emit("{\"type\":\"requested\",\"id\":" + id + "}");
    }

    private static void DoSubscribe(string[] parts)
    {
        uint id;
        if (parts.Length < 3 || !uint.TryParse(parts[1], out id))
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("SUBSCRIBE 缺少有效 id") + "}");
            return;
        }
        string name = parts[2];
        int hr = SimConnect_SubscribeToSystemEvent(_hSimConnect, id, name);
        if (hr != 0)
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("SubscribeToSystemEvent " + name + " 返回 " + hr) + "}");
            return;
        }
        EventNames[id] = name;
        Emit("{\"type\":\"subscribed\",\"id\":" + id + "}");
    }

    /// <summary>
    /// 逐变量体检：每个变量单独定义、单独请求一次，看谁拿不到数据。
    /// AddToDataDefinition 对无效的名字或单位会返回 0，只能靠「有没有数据回来」判断。
    /// </summary>
    private static void DoProbeAll(string[] parts)
    {
        var ids = new List<uint>();
        var names = new List<string>();
        var units = new List<string>();
        uint nextId = 200;

        for (int i = 1; i + 2 < parts.Length; i += 3)
        {
            string name = parts[i];
            string unit = parts[i + 1];
            string type = parts[i + 2];
            uint defineId = nextId++;
            uint typeCode = type == "str" ? DataTypeString256 : DataTypeFloat64;
            int hr = SimConnect_AddToDataDefinition(_hSimConnect, defineId, name, unit, typeCode, 0f, DatumIdUnused);
            if (hr != 0)
            {
                Emit("{\"type\":\"probe\",\"name\":" + Json(name) + ",\"unit\":" + Json(unit)
                    + ",\"ok\":false,\"reason\":" + Json("define hr=" + hr) + "}");
                continue;
            }
            DefineTypes[defineId] = new List<string> { type };
            ids.Add(defineId);
            names.Add(name);
            units.Add(unit);
        }

        // 全部定义完再一次性请求，比逐个等快得多。
        for (int i = 0; i < ids.Count; i++)
        {
            int hr = SimConnect_RequestDataOnSimObject(_hSimConnect, ids[i], ids[i], ObjectIdUser,
                PeriodOnce, 0, 0, 1, 0);
            if (hr != 0)
            {
                Emit("{\"type\":\"probe\",\"name\":" + Json(names[i]) + ",\"unit\":" + Json(units[i])
                    + ",\"ok\":false,\"reason\":" + Json("request hr=" + hr) + "}");
            }
        }

        Thread.Sleep(3000);

        int failed = 0;
        for (int i = 0; i < ids.Count; i++)
        {
            bool got = ProbeReceived.ContainsKey(ids[i]);
            if (!got) failed++;
            Emit("{\"type\":\"probe\",\"name\":" + Json(names[i]) + ",\"unit\":" + Json(units[i])
                + ",\"ok\":" + (got ? "true" : "false")
                + (got ? "" : ",\"reason\":\"no-data\"") + "}");
        }
        Emit("{\"type\":\"probe_done\",\"total\":" + ids.Count + ",\"failed\":" + failed + "}");
    }

    private static void DoEvent(string[] parts)
    {
        if (parts.Length < 2)
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("EVENT 缺少事件名") + "}");
            return;
        }
        string name = parts[1];
        // 事件参数按有符号解析：垂直速度这类目标值可以是负数，
        // 用 uint.TryParse 会把 "-1000" 解析失败并静默变成 0。
        int signedData = 0;
        if (parts.Length > 2) int.TryParse(parts[2], out signedData);
        uint data = unchecked((uint)signedData);
        uint id = _nextEventId++;
        int hr = SimConnect_MapClientEventToSimEvent(_hSimConnect, id, name);
        if (hr != 0)
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("MapClientEventToSimEvent " + name + " 返回 " + hr) + "}");
            return;
        }
        hr = SimConnect_TransmitClientEvent(_hSimConnect, ObjectIdUser, id, data,
            GroupPriorityHighest, EventFlagGroupIdIsPriority);
        if (hr != 0)
        {
            Emit("{\"type\":\"error\",\"message\":" + Json("TransmitClientEvent " + name + " 返回 " + hr) + "}");
            return;
        }
        Emit("{\"type\":\"sent\",\"name\":" + Json(name) + "}");
    }

    // ---- 泵线程 ----

    /// <summary>
    /// 只做连接和取消息。命令处理在主线程，所以这里即使卡住，命令照样能执行。
    /// SimConnect 的隐藏窗口属于调用 SimConnect_Open 的线程，所以必须在这个线程里开。
    /// </summary>
    private static void PumpLoop()
    {
        try
        {
            if (!string.IsNullOrEmpty(_pendingDllPath))
            {
                string dir = Path.GetDirectoryName(_pendingDllPath);
                if (!string.IsNullOrEmpty(dir)) SetDllDirectory(dir);
            }
            IntPtr h;
            int hr = SimConnect_Open(out h, "CorticoFlightCopilot", IntPtr.Zero, 0, 0, 0);
            _openHr = hr;
            if (hr == 0)
            {
                _hSimConnect = h;
                _opened = true;
            }
            OpenedEvent.Set();
            if (hr != 0) return;
        }
        catch (Exception ex)
        {
            Log("SimConnect_Open 异常: " + ex);
            Emit("{\"type\":\"error\",\"message\":" + Json(ex.GetType().Name + ": " + ex.Message) + "}");
            _openHr = -1;
            OpenedEvent.Set();
            return;
        }

        long polls = 0;
        while (_running && _opened)
        {
            try
            {
                IntPtr pData;
                uint cbData;
                int hr = SimConnect_GetNextDispatch(_hSimConnect, out pData, out cbData);
                if (hr == 0 && pData != IntPtr.Zero)
                {
                    OnRecv(pData, cbData, IntPtr.Zero);
                }
                else
                {
                    Thread.Sleep(5);
                }
                polls++;
                if (polls % 200 == 0) Log("派发轮询 " + polls + " 次，最近一次 hr=" + hr);
            }
            catch (Exception ex)
            {
                Log("派发异常: " + ex);
                Emit("{\"type\":\"error\",\"message\":" + Json("Dispatch 异常: "
                    + ex.GetType().Name + " " + ex.Message) + "}");
                break;
            }
        }

        if (_opened)
        {
            try { SimConnect_Close(_hSimConnect); }
            catch { }
            _opened = false;
            _hSimConnect = IntPtr.Zero;
        }
        Log("泵线程结束");
        Emit("{\"type\":\"closed\"}");
    }

    /// <summary>回调。结构体偏移见 SimConnect.h：SIMCONNECT_RECV 是 12 字节头。</summary>
    private static void OnRecv(IntPtr pData, uint cbData, IntPtr pContext)
    {
        if (cbData < 12) return;
        uint recvId = (uint)Marshal.ReadInt32(pData, 8);
        // 数据帧太多不记；其余类型全记，枚举写错时能在日志里直接看出来。
        if (recvId != RecvIdSimObjectData) Log("收到消息类型 " + recvId + "（" + cbData + " 字节）");
        switch (recvId)
        {
            case RecvIdSimObjectData:
                {
                    uint defineId = (uint)Marshal.ReadInt32(pData, 20);
                    if (defineId >= 200) ProbeReceived[defineId] = true;
                    uint count = (uint)Marshal.ReadInt32(pData, 36);
                    List<string> types;
                    if (!DefineTypes.TryGetValue(defineId, out types)) return;
                    int offset = 40;
                    var sb = new StringBuilder();
                    sb.Append("{\"type\":\"data\",\"id\":").Append(defineId).Append(",\"values\":[");
                    for (int i = 0; i < types.Count && i < count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        if (types[i] == "str")
                        {
                            sb.Append(Json(ReadString256(pData, offset)));
                            offset += 256;
                        }
                        else
                        {
                            long bits = Marshal.ReadInt64(pData, offset);
                            sb.Append(FormatDouble(BitConverter.Int64BitsToDouble(bits)));
                            offset += 8;
                        }
                    }
                    sb.Append("]}");
                    Emit(sb.ToString());
                    break;
                }
            case RecvIdEvent:
                {
                    uint eventId = (uint)Marshal.ReadInt32(pData, 16);
                    uint data = (uint)Marshal.ReadInt32(pData, 20);
                    string name;
                    EventNames.TryGetValue(eventId, out name);
                    Emit("{\"type\":\"event\",\"id\":" + eventId + ",\"name\":" + Json(name ?? "")
                        + ",\"data\":" + data + "}");
                    break;
                }
            case RecvIdOpen:
                Log("SimConnect 连接确认（RECV_ID_OPEN）");
                break;
            case RecvIdException:
                {
                    uint code = (uint)Marshal.ReadInt32(pData, 12);
                    // dwSendID / dwIndex 能指到是哪一次调用、哪一个 datum 出的问题。
                    uint sendId = cbData >= 20 ? (uint)Marshal.ReadInt32(pData, 16) : 0;
                    uint index = cbData >= 24 ? (uint)Marshal.ReadInt32(pData, 20) : 0;
                    // 同一类异常一次定义里会连发几十条，只报第一次，免得把日志刷满。
                    int seen = ExceptionCounts.AddOrUpdate(code, 1, (k, v) => v + 1);
                    if (seen == 1)
                    {
                        Log("SimConnect 异常码 " + code + " sendId=" + sendId + " index=" + index);
                        Emit("{\"type\":\"error\",\"message\":" + Json("SimConnect 异常 " + code
                            + "（sendId=" + sendId + " index=" + index + "）") + "}");
                    }
                    break;
                }
            case RecvIdQuit:
                Log("模拟器发来 quit");
                Emit("{\"type\":\"quit\"}");
                _running = false;
                break;
        }
    }

    private static string ReadString256(IntPtr pData, int offset)
    {
        var buf = new byte[256];
        Marshal.Copy(new IntPtr(pData.ToInt64() + offset), buf, 0, 256);
        int len = Array.IndexOf(buf, (byte)0);
        if (len < 0) len = 256;
        return Encoding.UTF8.GetString(buf, 0, len);
    }

    private static string FormatDouble(double v)
    {
        if (double.IsNaN(v) || double.IsInfinity(v)) return "null";
        return v.ToString("R", CultureInfo.InvariantCulture);
    }

    private static string Json(string s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        return sb.Append('"').ToString();
    }

    private static void Emit(string json)
    {
        lock (OutLock)
        {
            try
            {
                _out.WriteLine(json);
                _out.Flush();
            }
            catch { }
        }
    }
}
