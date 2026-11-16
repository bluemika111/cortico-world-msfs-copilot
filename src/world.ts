/**
 * 飞行副驾。
 *
 * 它坐在右座，看的是 SimConnect 遥测；不做判断该不该开口，只在事实成立时把事实交出去。
 * 写权限逐项开关：能读一切，但动飞机这件事要操作者一项一项打开，没开的就明确拒绝。
 */
import { fileURLToPath } from 'node:url';
import type {
  EventEnvelope,
  PushOptions,
  ToolDef,
  ToolOutcome,
  World,
  WorldHost,
  WorldWebUiDecl,
} from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { MSFS_COPILOT_CONFIG_GROUP, type MsfsCopilotConfigSection } from './config.ts';
import {
  renderAltitudeAlert,
  renderApproach,
  renderConnected,
  renderCruise,
  renderDescent,
  renderDisconnected,
  renderOverspeed,
  renderStall,
  renderTakeoff,
  renderTouchdown,
} from './model-text.ts';
import { PHASE_LABELS, PhaseTracker, type FlightPhase } from './phase.ts';
import { ensureBridge } from './probe/build.ts';
import { DLL_ENV, locateSimConnectDll } from './probe/locate.ts';
import { SimConnectProbe, type ProbeLike } from './probe/simconnect.ts';
import { parseFrame, SIMVARS, type TelemetryFrame } from './telemetry.ts';
import {
  formatAltitude,
  formatAttitude,
  formatDistanceNm,
  formatDuration,
  formatHeading,
  formatMach,
  formatPressure,
  formatSpeed,
  formatTemperature,
  formatVerticalSpeed,
  formatWind,
  group,
  type UnitSystem,
} from './units.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const BRIDGE_SRC = fileURLToPath(new URL('../bridge/SimConnectBridge.cs', import.meta.url));

/** defineId 与 requestId 共用。 */
const DEFINE_ID = 1;
/** 暂停系统事件的订阅 id。 */
const SUB_PAUSE = 100;
/** 连不上时多久重试一次。 */
const RECONNECT_MS = 5000;

/** 全部工具的声明；定义里的 describe 与 `tools()` 都取它。 */
export const MSFS_COPILOT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'msfs_status',
    description:
      'Report the flight state right now: flight phase, altitude, height above ground, airspeed, mach, vertical speed, ground speed, attitude, heading, and whether the aircraft is on the ground. Read-only; do not poll it on a timer.',
    tags: ['read', 'snapshot'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'msfs_ap',
    description:
      'Report the autopilot: whether it is engaged, which lateral and vertical modes are active, and the selected target altitude, heading, speed and vertical speed. Read-only.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'msfs_nav',
    description:
      'Report radio and navigation: COM1/2 and NAV1/2 frequencies, transponder code and mode, localizer and glideslope deviation, DME distance, and the next GPS waypoint with its distance and bearing. Read-only.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'msfs_wx',
    description:
      'Report the environment around the aircraft: wind, outside temperature, altimeter setting, visibility and precipitation. Read-only.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'msfs_alerts',
    description:
      'Report which warnings are active right now: stall, overspeed, structural icing, deviation from the selected altitude, and landing gear state. Read-only.',
    tags: ['read'],
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'msfs_radio',
    description:
      'Set a radio or instrument value: COM or NAV frequency in MHz, transponder code as a four-digit number, or altimeter setting in inches of mercury. Refuses with the reason when the operator has not enabled that write permission.',
    tags: ['act'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          enum: ['com1', 'com2', 'nav1', 'nav2', 'transponder', 'altimeter'],
          description: 'Which radio or instrument to set.',
        },
        value: {
          type: 'number',
          description:
            'COM/NAV frequency in MHz (e.g. 118.7), transponder code as a four-digit number (e.g. 1200), or altimeter setting in inches of mercury (e.g. 29.92).',
        },
      },
      required: ['target', 'value'],
    },
  },
  {
    name: 'msfs_switch',
    description:
      'Flip a switch: landing, nav, strobe, taxi or beacon lights, or raise/lower the landing gear. Refuses with the reason when the operator has not enabled that write permission.',
    tags: ['act'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          enum: ['landing_light', 'nav_light', 'strobe_light', 'taxi_light', 'beacon_light', 'gear'],
          description: 'Which switch to flip.',
        },
        on: {
          type: 'boolean',
          description:
            'For lights: true turns it on, false turns it off. For the gear: true lowers it, false raises it.',
        },
      },
      required: ['target', 'on'],
    },
  },
  {
    name: 'msfs_ap_set',
    description:
      'Change the autopilot: engage or disengage it, switch heading/altitude/nav hold on or off, or set the target altitude, heading, speed or vertical speed. Refuses with the reason when the operator has not enabled the autopilot write permission.',
    tags: ['act'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'string',
          enum: [
            'master',
            'heading',
            'altitude',
            'nav',
            'speed',
            'vs',
            'autothrottle',
            'target_altitude',
            'target_heading',
            'target_speed',
            'target_vs',
          ],
          description:
            'What to change. master/heading/altitude/nav are switches; target_* set a reference value.',
        },
        on: {
          type: 'boolean',
          description: 'For switches: true engages, false disengages. Ignored for target_*.',
        },
        value: {
          type: 'number',
          description:
            'For target_altitude: feet. target_heading: degrees 0-360. target_speed: knots. target_vs: feet per minute (may be negative).',
        },
      },
      required: ['target'],
    },
  },
];

export interface MsfsCopilotWorldOptions {
  cfg: MsfsCopilotConfigSection;
  timezone: string;
  dataDir: string;
  /** 测试注入：替掉真实桥接进程。 */
  probe?: ProbeLike | null;
  /** 测试注入。 */
  now?: () => number;
}

/** 写操作被拒时统一走这里：说清楚是哪一项没开，而不是含糊地说「不行」。 */
function refused(text: string): ToolOutcome {
  return { text, failed: true };
}

export class MsfsCopilotWorld implements World {
  readonly id = 'msfs-copilot';

  private host: WorldHost | null = null;
  private probe: ProbeLike | null = null;
  private readonly injectedProbe: ProbeLike | null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private running = false;

  private frame: TelemetryFrame | null = null;
  private readonly phase = new PhaseTracker('preflight');
  private connected = false;
  private paused = false;
  private lastError = '';

  // 事件判定用的上一帧状态
  private stallActive = false;
  private overspeedActive = false;
  private altitudeAlerted = false;
  /** 最近一次报进近的时刻。初始为负无穷，否则第一次进近会被冷却窗口挡掉。 */
  private approachAt = Number.NEGATIVE_INFINITY;
  private lastPhase: FlightPhase = 'preflight';

  private readonly clock: () => number;

  constructor(private readonly opts: MsfsCopilotWorldOptions) {
    this.clock = opts.now ?? Date.now;
    this.injectedProbe = opts.probe ?? null;
  }

  // —— 框架契约 ——

  envPromptVars(): Record<string, string> {
    const f = this.frame;
    const connected = this.connected ? '已连上，遥测在流。' : this.lastError ? `未连上：${this.lastError}` : '正在连接。';
    return {
      'msfs.connected': connected,
      'msfs.aircraft': f?.title || '未报机型',
      'msfs.phase': PHASE_LABELS[this.phase.current].zh,
      'msfs.simRate': '未提供（SimConnect 没有可读的倍率变量）',
      'msfs.paused': f?.simDisabled || this.paused ? '已暂停，读数是停住的' : '运行中',
      'msfs.units': this.units() === 'metric'
        ? '公制：米、公里每小时、百帕'
        : '航空单位：英尺、节、海里、英寸汞柱',
    };
  }

  tools(): ToolDef[] {
    return [
      this.readTool('msfs_status', () => this.renderStatus()),
      this.readTool('msfs_ap', () => this.renderAutopilot()),
      this.readTool('msfs_nav', () => this.renderNav()),
      this.readTool('msfs_wx', () => this.renderWeather()),
      this.readTool('msfs_alerts', () => this.renderAlerts()),
      this.radioTool(),
      this.switchTool(),
      this.apTool(),
    ];
  }

  webUi(language?: string): WorldWebUiDecl {
    const zh = language !== 'en';
    return {
      config: [MSFS_COPILOT_CONFIG_GROUP],
      lamps: [
        {
          label: zh ? 'SimConnect' : 'SimConnect',
          state: this.connected ? 'online' : this.lastError ? 'error' : 'loading',
          hint: this.connected
            ? zh ? '遥测在流' : 'Telemetry is flowing'
            : this.lastError || (zh ? '正在连接' : 'Connecting'),
        },
        {
          label: zh ? '写权限' : 'Write',
          state: this.opts.cfg.writeEnabled ? 'online' : 'offline',
          hint: this.opts.cfg.writeEnabled
            ? zh ? '副驾可以动飞机' : 'The copilot may touch the aircraft'
            : zh ? '只读' : 'Read-only',
        },
      ],
      // 不声明 panels：面板要单独的前端构建产物（cortico.webUiClient），
      // 本包没有打包 React 组件。状态走 lamps（导航栏状态灯）和 msfs_status 工具。
      promptDocs: [
        {
          key: 'worlds.msfs-copilot.envPrompt',
          title: zh ? '飞行副驾 · 环境提示词' : 'Flight Copilot · environment prompt',
          description: zh
            ? '说明这些事件是什么、什么时候来。'
            : 'What these events are and when they arrive.',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'msfs.connected', description: zh ? 'SimConnect 的连接状态' : 'SimConnect link state' },
            { name: 'msfs.aircraft', description: zh ? '当前机型' : 'Current aircraft title' },
            { name: 'msfs.phase', description: zh ? '当前飞行阶段' : 'Current flight phase' },
            { name: 'msfs.simRate', description: zh ? '仿真倍率' : 'Simulation rate' },
            { name: 'msfs.paused', description: zh ? '是否暂停' : 'Whether the sim is paused' },
            { name: 'msfs.units', description: zh ? '报数用的单位制' : 'Unit system used when reporting' },
          ],
        },
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.running = true;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const probe = this.probe;
    this.probe = null;
    if (probe) await probe.stop().catch(() => {});
    this.host = null;
    this.frame = null;
    this.connected = false;
    this.paused = false;
    this.lastError = '';
    this.stallActive = false;
    this.overspeedActive = false;
    this.altitudeAlerted = false;
    this.lastPhase = 'preflight';
  }

  shutdownVerification(language = 'zh'): readonly {
    key: string;
    label: string;
    status: 'verified-ended' | 'still-live' | 'unknown';
    detail: string;
    manualAction: string;
  }[] {
    const zh = language !== 'en';
    return [
      {
        key: 'simconnect',
        label: zh ? 'SimConnect 连接' : 'SimConnect link',
        status: this.probe ? 'still-live' : 'verified-ended',
        detail: this.probe
          ? zh ? '桥接进程还没结束' : 'The bridge process is still running'
          : zh ? '桥接进程已结束' : 'The bridge process has ended',
        manualAction: zh ? '无需操作' : 'Nothing to do',
      },
    ];
  }

  // —— 内部：连接与重连 ——

  private units(): UnitSystem {
    return this.opts.cfg.metric ? 'metric' : 'aviation';
  }

  /** pollMs 换成 SimConnect 的秒级推送间隔，至少 1 秒。 */
  private pushSeconds(): number {
    return Math.max(1, Math.min(10, Math.round(this.opts.cfg.pollMs / 1000)));
  }

  private async connect(): Promise<void> {
    if (this.probe) return;

    if (this.injectedProbe) {
      this.probe = this.injectedProbe;
      await this.attachProbe(this.injectedProbe);
      return;
    }

    const dll = locateSimConnectDll(this.opts.cfg.simconnectDll);
    if (!dll.path) {
      this.lastError =
        `没找到 SimConnect.dll（试了 ${dll.tried.length} 个位置）。` +
        `可以在「飞行副驾」设置里指定路径，或设环境变量 ${DLL_ENV}。`;
      this.scheduleReconnect();
      return;
    }

    const build = ensureBridge(BRIDGE_SRC, this.opts.dataDir);
    if (!build.exePath) {
      this.lastError = build.error ?? '编译 SimConnect 桥接失败。';
      this.scheduleReconnect();
      return;
    }

    const probe = new SimConnectProbe({ exePath: build.exePath, dllPath: dll.path });
    this.probe = probe;
    await this.attachProbe(probe);
  }

  private async attachProbe(probe: ProbeLike): Promise<void> {
    try {
      await probe.start({
        onData: (_id, values) => this.onFrame(values),
        onEvent: (name, data) => this.onSystemEvent(name, data),
        onError: (msg) => {
          this.lastError = msg;
        },
        onQuit: () => this.onProbeClosed('游戏退出了'),
        onClosed: () => this.onProbeClosed('桥接进程结束了'),
      });
      await probe.define(DEFINE_ID, SIMVARS);
      await probe.request(DEFINE_ID, 'second', this.pushSeconds());
      await probe.subscribe(SUB_PAUSE, 'Pause');
      this.lastError = '';
    } catch (err) {
      this.lastError = (err as Error).message;
      const p = this.probe;
      this.probe = null;
      if (p) await p.stop().catch(() => {});
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {});
    }, RECONNECT_MS);
    this.reconnectTimer.unref?.();
  }

  private async disconnect(): Promise<void> {
    const probe = this.probe;
    this.probe = null;
    this.connected = false;
    if (probe) await probe.stop().catch(() => {});
  }

  // —— 内部：数据与事件 ——

  private onFrame(values: Array<number | string | null>): void {
    const prev = this.frame;
    const frame = parseFrame(values);
    const now = this.clock();
    this.frame = frame;

    const phase = this.phase.update(
      {
        onGround: frame.onGround,
        parked: frame.parked,
        aglFt: frame.aglFt,
        iasKt: frame.iasKt,
        vsFpm: frame.vsFpm,
        gearDown: frame.gear.lowest > 0.5,
      },
      now,
    );

    if (!this.connected) {
      this.connected = true;
      this.lastError = '';
      void this.push('msfs.connected', renderConnected(frame, PHASE_LABELS[phase].zh), {
        trigger: 'flush',
      });
    }

    if (prev) this.detectEvents(prev, frame, phase, now);
    this.lastPhase = phase;
  }

  private detectEvents(
    prev: TelemetryFrame,
    frame: TelemetryFrame,
    phase: FlightPhase,
    now: number,
  ): void {
    const cfg = this.opts.cfg;
    const u = this.units();

    // 离地：地面 → 空中，且已经跑起来（排除悬停和刹停抖动）。
    if (cfg.takeoff && prev.onGround && !frame.onGround && frame.iasKt > 30) {
      void this.push('msfs.takeoff', renderTakeoff(frame, u), { trigger: 'flush' });
    }

    // 接地：空中 → 地面。接地前一帧得真的在天上，免得滑行时的抖动被当成落地。
    if (cfg.touchdown && !prev.onGround && frame.onGround && prev.aglFt > 20) {
      void this.push('msfs.touchdown', renderTouchdown(frame, u), { trigger: 'flush' });
    }

    // 到达巡航：爬升 → 巡航，且高度够得上巡航。
    if (cfg.cruise && this.lastPhase === 'climb' && phase === 'cruise' && frame.aglFt >= cfg.cruiseAltFt) {
      void this.push('msfs.cruise', renderCruise(frame, u), { trigger: 'piggyback' });
    }

    // 开始下降：从巡航或爬升转到下降。
    if (cfg.descent && (this.lastPhase === 'cruise' || this.lastPhase === 'climb') && phase === 'descent') {
      void this.push('msfs.descent', renderDescent(frame, u), { trigger: 'piggyback' });
    }

    // 进近建立：下滑道信号从无到有。
    if (cfg.approach && !prev.nav.gsFlag && frame.nav.gsFlag) {
      if (now - this.approachAt > cfg.approachCooldownSec * 1000) {
        this.approachAt = now;
        void this.push('msfs.approach', renderApproach(frame, u), { trigger: 'flush' });
      }
    }

    // 失速：上升沿。这一条用 interrupt，压过别的输出。
    if (cfg.stall && !this.stallActive && frame.stall) {
      this.stallActive = true;
      void this.push('msfs.stall', renderStall(frame, u), { trigger: 'interrupt' });
    }
    if (!frame.stall) this.stallActive = false;

    // 超速：上升沿。
    if (cfg.overspeed && !this.overspeedActive && frame.overspeed) {
      this.overspeedActive = true;
      void this.push('msfs.overspeed', renderOverspeed(frame, u), { trigger: 'flush' });
    }
    if (!frame.overspeed) this.overspeedActive = false;

    // 高度偏离：只有自动驾驶在高度保持时才有「选定高度」可比。
    const target = frame.ap.targetAltFt;
    if (cfg.altitudeAlert && frame.ap.altitude && target > 0) {
      const diff = Math.abs(frame.altFt - target);
      if (diff > cfg.altitudeAlertFt) {
        if (!this.altitudeAlerted) {
          this.altitudeAlerted = true;
          void this.push('msfs.altitude_alert', renderAltitudeAlert(frame, u, target), {
            trigger: 'flush',
          });
        }
      } else if (diff < cfg.altitudeAlertFt * 0.5) {
        // 回到一半阈值以内才允许再报，免得在边界上反复触发。
        this.altitudeAlerted = false;
      }
    } else {
      this.altitudeAlerted = false;
    }
  }

  private onSystemEvent(name: string, data: number): void {
    if (name === 'Pause') this.paused = data !== 0;
  }

  private onProbeClosed(reason: string): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.probe = null;
    this.lastError = reason;
    if (wasConnected) {
      void this.push('msfs.disconnected', renderDisconnected(reason), { trigger: 'flush' });
    }
    this.scheduleReconnect();
  }

  private async push(type: string, text: string, opts: PushOptions): Promise<EventEnvelope | null> {
    const host = this.host;
    if (!host) return null;
    try {
      return await host.pushEvent(
        {
          type,
          ts: nowIso(this.opts.timezone),
          source: this.id,
          origin: 'external',
          senderKey: this.id,
          // 统一带来源前缀：事件正文和用户发言混在一起时，一眼能分出是谁在说话。
          text: `[MSFS-2020] ${text}`,
        },
        opts,
      );
    } catch (err) {
      host.log.warn('飞行副驾事件投递失败', { err });
      return null;
    }
  }

  // —— 内部：工具 ——

  private readTool(name: string, render: () => string): ToolDef {
    const decl = MSFS_COPILOT_TOOL_DECLS.find((d) => d.name === name);
    if (!decl) throw new Error(`没有声明工具 ${name}`);
    return { ...decl, handler: async () => render() };
  }

  private notConnected(): string {
    if (this.lastError) return `还没连上模拟器：${this.lastError}`;
    return '还没连上模拟器，SimConnect 没有数据。';
  }

  private renderStatus(): string {
    const f = this.frame;
    if (!f) return this.notConnected();
    const u = this.units();
    const lines = [
      `阶段 ${PHASE_LABELS[this.phase.current].zh}。`,
      `高度 ${formatAltitude(f.altFt, u)}，离地 ${formatAltitude(f.aglFt, u)}。`,
      `空速 ${formatSpeed(f.iasKt, u)}，${formatMach(f.mach)}，地速 ${formatSpeed(f.gsKt, u)}。`,
      `垂直速度 ${formatVerticalSpeed(f.vsFpm, u)}。`,
      `姿态 ${formatAttitude(f.pitchDeg, f.bankDeg)}，航向 ${formatHeading(f.headingDeg)}。`,
    ];
    if (f.onGround) lines.push(f.parked ? '在地面上，停着。' : '在地面上，滑行中。');
    else lines.push('在空中。');
    if (f.title) lines.push(`机型 ${f.title}。`);
    if (f.simDisabled || this.paused) lines.push('模拟器暂停中，这些读数是停住的。');
    return lines.join('\n');
  }

  private renderAutopilot(): string {
    const f = this.frame;
    if (!f) return this.notConnected();
    const u = this.units();
    const ap = f.ap;
    if (!ap.master) return '自动驾驶没接通。';
    const modes: string[] = [];
    if (ap.heading) modes.push('航向保持');
    if (ap.altitude) modes.push('高度保持');
    if (ap.approach) modes.push('进近');
    if (ap.nav1) modes.push('NAV1');
    const head = modes.length
      ? `自动驾驶接通：${modes.join('、')}。`
      : '自动驾驶接通，没有横向或垂直保持模式。';
    return [
      head,
      `目标高度 ${formatAltitude(ap.targetAltFt, u)}，`,
      `目标航向 ${formatHeading(ap.targetHeadingDeg)}，`,
      `目标速度 ${formatSpeed(ap.targetSpeedKt, u)}，`,
      `目标垂直速度 ${formatVerticalSpeed(ap.targetVsFpm, u)}。`,
    ].join('');
  }

  private renderNav(): string {
    const f = this.frame;
    if (!f) return this.notConnected();
    const u = this.units();
    const n = f.nav;
    const lines = [
      `COM1 ${n.com1Mhz.toFixed(3)}，COM2 ${n.com2Mhz.toFixed(3)}。`,
      `NAV1 ${n.nav1Mhz.toFixed(2)}，NAV2 ${n.nav2Mhz.toFixed(2)}。`,
      n.transponder
        ? `应答机 ${n.transponder}，状态 ${xpndrStateLabel(n.transponderState)}。`
        : '应答机码没读到。',
    ];
    if (n.gsFlag) lines.push(`下滑道信号有效，距台 ${formatDistanceNm(n.dmeNm, u)}。`);
    if (n.nextWaypoint) {
      lines.push(
        `下一个航路点 ${n.nextWaypoint}，方位 ${formatHeading(n.wpBearingDeg)}，距离 ${formatDistanceNm(n.wpDistanceNm, u)}。`,
      );
    } else if (n.wpDistanceNm > 0) {
      lines.push(`到下一个航路点 ${formatDistanceNm(n.wpDistanceNm, u)}。`);
    }
    // 航路总量：全程、到下一航路点/到目的地的预计时间。
    // MSFS 没有「剩余距离」这个变量，剩余按 ETE × 地速 估。
    if (n.totalDistanceNm > 0) {
      lines.push(`飞行计划全程 ${formatDistanceNm(n.totalDistanceNm, u)}。`);
    }
    if (n.wpEteS > 0) {
      lines.push(`到下一航路点预计 ${formatDuration(n.wpEteS)}。`);
    }
    if (n.eteS > 0) {
      const gs = f.gsKt > 50 ? f.gsKt : n.gpsGroundSpeedKt;
      const remainNm = gs * (n.eteS / 3600);
      lines.push(
        `到目的地预计 ${formatDuration(n.eteS)}，按当前地速约 ${formatDistanceNm(remainNm, u)}。`,
      );
    }
    return lines.join('\n');
  }

  private renderWeather(): string {
    const f = this.frame;
    if (!f) return this.notConnected();
    const u = this.units();
    return [
      `风 ${formatWind(f.wx.windKt, f.wx.windDirDeg, u)}。`,
      `外界温度 ${formatTemperature(f.wx.tempC, u)}。`,
      `外界气压 ${formatPressure(f.wx.ambientInHg, u)}，高度表拨正值 ${formatPressure(f.kohlsmanInHg, u)}。`,
      `能见度 ${group(f.wx.visibilityM)} 米。`,
      f.wx.precip ? `有降水（状态码 ${f.wx.precip}）。` : '没有降水。',
    ].join('\n');
  }

  private renderAlerts(): string {
    const f = this.frame;
    if (!f) return this.notConnected();
    const u = this.units();
    const lines: string[] = [];
    if (f.stall) {
      lines.push(
        `失速警告响着。空速 ${formatSpeed(f.iasKt, u)}，俯仰 ${f.pitchDeg.toFixed(1)} 度，离地 ${formatAltitude(f.aglFt, u)}。`,
      );
    }
    if (f.overspeed) {
      lines.push(`超速警告响着。${formatMach(f.mach)}，空速 ${formatSpeed(f.iasKt, u)}。`);
    }
    if (f.icePct > 5) lines.push(`结构结冰 ${f.icePct.toFixed(0)}%。`);
    if (f.ap.altitude && f.ap.targetAltFt > 0) {
      const diff = f.altFt - f.ap.targetAltFt;
      if (Math.abs(diff) > this.opts.cfg.altitudeAlertFt) {
        lines.push(
          `高度偏离：选定 ${formatAltitude(f.ap.targetAltFt, u)}，实际 ${formatAltitude(f.altFt, u)}，` +
            `${diff > 0 ? '高了' : '低了'} ${formatAltitude(Math.abs(diff), u)}。`,
        );
      }
    }
    const pct = (v: number): number => Math.round(v * 100);
    if (f.gear.handleDown) {
      lines.push(
        f.gear.lowest > 0.99
          ? '起落架放下锁定。'
          : `起落架正在放下（${pct(f.gear.lowest)}%）。`,
      );
    } else {
      lines.push(
        f.gear.lowest < 0.01
          ? '起落架收起。'
          : `起落架正在收起（${pct(f.gear.lowest)}%）。`,
      );
    }
    if (lines.length === 1) {
      // 只有起落架那一行 = 没有告警。
      return `没有告警。${lines[0]}`;
    }
    return lines.join('\n');
  }

  private radioTool(): ToolDef {
    const decl = MSFS_COPILOT_TOOL_DECLS.find((d) => d.name === 'msfs_radio');
    if (!decl) throw new Error('没有声明工具 msfs_radio');
    return { ...decl, handler: async (args) => this.setRadio(args) };
  }

  private switchTool(): ToolDef {
    const decl = MSFS_COPILOT_TOOL_DECLS.find((d) => d.name === 'msfs_switch');
    if (!decl) throw new Error('没有声明工具 msfs_switch');
    return { ...decl, handler: async (args) => this.setSwitch(args) };
  }

  private apTool(): ToolDef {
    const decl = MSFS_COPILOT_TOOL_DECLS.find((d) => d.name === 'msfs_ap_set');
    if (!decl) throw new Error('没有声明工具 msfs_ap_set');
    return { ...decl, handler: async (args) => this.setAutopilot(args) };
  }

  private async setAutopilot(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const target = String(args.target ?? '');
    const gate = this.writeAllowed();
    if (gate) return gate;
    if (!this.opts.cfg.writeAp) return refused('操作者没有开放自动驾驶的权限。');
    const probe = this.probe!;

    try {
      switch (target) {
        case 'master': {
          const on = args.on === true;
          // AP_MASTER 是 toggle，先比对当前状态，免得「接通」把已经接通的关掉。
          const current = this.frame?.ap.master ?? false;
          if (current === on) return `自动驾驶已经是${on ? '接通' : '断开'}状态。`;
          await probe.sendEvent('AP_MASTER');
          return `自动驾驶已${on ? '接通' : '断开'}。`;
        }
        case 'heading': {
          const on = args.on === true;
          await probe.sendEvent(on ? 'AP_PANEL_HEADING_ON' : 'AP_PANEL_HEADING_OFF');
          return `航向保持已${on ? '打开' : '关闭'}。`;
        }
        case 'altitude': {
          const on = args.on === true;
          await probe.sendEvent(on ? 'AP_PANEL_ALTITUDE_ON' : 'AP_PANEL_ALTITUDE_OFF');
          return `高度保持已${on ? '打开' : '关闭'}。`;
        }
        case 'nav': {
          const on = args.on === true;
          await probe.sendEvent(on ? 'AP_NAV1_HOLD_ON' : 'AP_NAV1_HOLD_OFF');
          return `NAV 保持已${on ? '打开' : '关闭'}。`;
        }
        case 'speed': {
          const on = args.on === true;
          await probe.sendEvent(on ? 'AP_AIRSPEED_ON' : 'AP_AIRSPEED_OFF');
          return `速度保持已${on ? '打开' : '关闭'}。`;
        }
        case 'vs': {
          const on = args.on === true;
          await probe.sendEvent(on ? 'AP_VS_ON' : 'AP_VS_OFF');
          return `垂直速度保持已${on ? '打开' : '关闭'}。`;
        }
        case 'autothrottle': {
          // AUTO_THROTTLE_ARM 是 toggle，没有「设为开」的版本。
          await probe.sendEvent('AUTO_THROTTLE_ARM');
          return '自动油门预位已切换。';
        }
        case 'target_altitude': {
          const v = Number(args.value);
          if (!Number.isFinite(v) || v < 0 || v > 60000) {
            return refused(`目标高度应在 0–60000 英尺之间，收到 ${String(args.value)}。`);
          }
          await probe.sendEvent('AP_ALT_VAR_SET_ENGLISH', Math.round(v));
          return `目标高度设到 ${Math.round(v)} 英尺。`;
        }
        case 'target_heading': {
          const v = Number(args.value);
          if (!Number.isFinite(v)) return refused('没有给出有效的航向。');
          const deg = ((Math.round(v) % 360) + 360) % 360;
          await probe.sendEvent('HEADING_BUG_SET', deg);
          return `目标航向设到 ${String(deg).padStart(3, '0')} 度。`;
        }
        case 'target_speed': {
          const v = Number(args.value);
          if (!Number.isFinite(v) || v < 60 || v > 500) {
            return refused(`目标速度应在 60–500 节之间，收到 ${String(args.value)}。`);
          }
          await probe.sendEvent('AP_SPD_VAR_SET', Math.round(v));
          return `目标速度设到 ${Math.round(v)} 节。`;
        }
        case 'target_vs': {
          const v = Number(args.value);
          if (!Number.isFinite(v) || Math.abs(v) > 6000) {
            return refused(`目标垂直速度应在 ±6000 英尺/分之间，收到 ${String(args.value)}。`);
          }
          await probe.sendEvent('AP_VS_VAR_SET_ENGLISH', Math.round(v));
          return `目标垂直速度设到 ${Math.round(v)} 英尺/分。`;
        }
        default:
          return refused(`不认识的目标「${target}」。`);
      }
    } catch (err) {
      return refused(`发操作失败：${(err as Error).message}`);
    }
  }

  private writeAllowed(): ToolOutcome | null {
    if (!this.opts.cfg.writeEnabled) {
      return refused('操作者没有打开「允许副驾动飞机」总闸，现在是只读。只能读，不能改。');
    }
    if (!this.probe || !this.connected) {
      return refused('还没连上模拟器，发不了操作。');
    }
    return null;
  }

  private async setRadio(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const target = String(args.target ?? '');
    const value = Number(args.value);
    if (!Number.isFinite(value)) return refused('没有给出有效的数值。');
    const gate = this.writeAllowed();
    if (gate) return gate;
    const probe = this.probe!;

    try {
      switch (target) {
        case 'com1':
        case 'com2': {
          if (!this.opts.cfg.writeRadio) return refused('操作者没有开放改 COM 频率的权限。');
          if (value < 118 || value > 137) return refused(`COM 频率应在 118–137 MHz 之间，收到 ${value}。`);
          // MSFS 只给 COM 备用频率的写入口，设完要再切一次主备。
          const suffix = target === 'com2' ? '2' : '';
          await probe.sendEvent(`COM${suffix}_STBY_RADIO_SET_HZ`, Math.round(value * 1_000_000));
          await probe.sendEvent(`COM${suffix}_STBY_RADIO_SWAP`);
          return `COM${suffix || '1'} 设到 ${value.toFixed(3)}，主备已切换。`;
        }
        case 'nav1':
        case 'nav2': {
          if (!this.opts.cfg.writeRadio) return refused('操作者没有开放改 NAV 频率的权限。');
          if (value < 108 || value > 118) return refused(`NAV 频率应在 108–118 MHz 之间，收到 ${value}。`);
          const idx = target === 'nav2' ? '2' : '1';
          await probe.sendEvent(`NAV${idx}_RADIO_SET_HZ`, Math.round(value * 1_000_000));
          return `NAV${idx} 设到 ${value.toFixed(2)}。`;
        }
        case 'transponder': {
          if (!this.opts.cfg.writeXpndr) return refused('操作者没有开放改应答机的权限。');
          const code = Math.round(value);
          if (code < 0 || code > 7777) return refused(`应答机码应是四位数字，收到 ${value}。`);
          await probe.sendEvent('XPNDR_SET', xpndrToBcd16(code));
          return `应答机设到 ${String(code).padStart(4, '0')}。`;
        }
        case 'altimeter': {
          if (!this.opts.cfg.writeBaro) return refused('操作者没有开放调气压基准的权限。');
          if (value < 28 || value > 31.5) return refused(`气压基准应在 28–31.5 英寸汞柱之间，收到 ${value}。`);
          const mb = value * 33.8639;
          await probe.sendEvent('KOHLSMAN_SET', Math.round(mb * 16));
          return `气压基准设到 ${value.toFixed(2)} 英寸汞柱（${Math.round(mb)} 百帕）。`;
        }
        default:
          return refused(`不认识的目标「${target}」。`);
      }
    } catch (err) {
      return refused(`发操作失败：${(err as Error).message}`);
    }
  }

  private async setSwitch(args: Record<string, unknown>): Promise<string | ToolOutcome> {
    const target = String(args.target ?? '');
    const on = args.on === true;
    const gate = this.writeAllowed();
    if (gate) return gate;
    const probe = this.probe!;

    try {
      if (target === 'gear') {
        if (!this.opts.cfg.writeGear) return refused('操作者没有开放收起落架的权限。');
        // 地面上收轮会直接把飞机压在跑道上，先拦住。
        if (!on && this.frame?.onGround) {
          return refused('飞机在地面上，不能收起落架。');
        }
        await probe.sendEvent('GEAR_SET', on ? 1 : 0);
        return on ? '起落架已放下。' : '起落架已收起。';
      }

      if (!this.opts.cfg.writeLights) return refused('操作者没有开放灯光的权限。');
      const prefixes: Record<string, string> = {
        landing_light: 'LANDING_LIGHTS',
        nav_light: 'NAV_LIGHTS',
        strobe_light: 'STROBES',
        taxi_light: 'TAXI_LIGHTS',
        beacon_light: 'BEACON_LIGHTS',
      };
      const prefix = prefixes[target];
      if (!prefix) return refused(`不认识的目标「${target}」。`);
      await probe.sendEvent(`${prefix}_${on ? 'ON' : 'OFF'}`);
      return `${target} 已${on ? '打开' : '关闭'}。`;
    } catch (err) {
      return refused(`发操作失败：${(err as Error).message}`);
    }
  }

  private async invokePanel(panel: string, method: string): Promise<unknown> {
    if (panel !== 'status') throw new Error(`unknown panel: ${panel}`);
    if (method === 'read') {
      return {
        connected: this.connected,
        error: this.lastError,
        phase: this.phase.current,
        paused: this.paused,
        writeEnabled: this.opts.cfg.writeEnabled,
        status: this.frame ? this.renderStatus() : this.notConnected(),
      };
    }
    if (method === 'reconnect') {
      await this.disconnect();
      this.lastError = '';
      await this.connect();
      return { connected: this.connected, error: this.lastError };
    }
    throw new Error(`unknown method: ${method}`);
  }
}

const XPNDR_STATES = ['关', '待机', '测试', '开', '高度报告', '地面'];

function xpndrStateLabel(state: number): string {
  const index = Math.round(state);
  return XPNDR_STATES[index] ?? `未知（${state}）`;
}

/** 应答机码 1200 → BCD 0x1200。 */
function xpndrToBcd16(code: number): number {
  const v = Math.abs(Math.round(code)) % 10000;
  return (
    ((Math.floor(v / 1000) & 0xf) << 12) |
    (((Math.floor(v / 100) % 10) & 0xf) << 8) |
    (((Math.floor(v / 10) % 10) & 0xf) << 4) |
    (v % 10 & 0xf)
  );
}
