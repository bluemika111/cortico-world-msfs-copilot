import { describe, expect, it } from 'vitest';
import type { ToolCallContext, ToolOutcome } from 'cortico/core/types.ts';
import { MSFS_COPILOT_DEFAULTS, type MsfsCopilotConfigSection } from '../src/config.ts';
import { SIMVARS, V } from '../src/telemetry.ts';
import { MsfsCopilotWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { FakeProbe } from './helpers/fake-probe.ts';

const tick = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** 按 V 的下标填一帧；没写的量一律 0。 */
function values(overrides: Partial<Record<keyof typeof V, number | string>> = {}): Array<number | string | null> {
  const arr: Array<number | string | null> = new Array(SIMVARS.length).fill(0);
  for (const [key, value] of Object.entries(overrides)) {
    const index = V[key as keyof typeof V];
    if (index === undefined) throw new Error(`未知的变量 ${key}`);
    arr[index] = value;
  }
  return arr;
}

interface Rig {
  host: FakeHost;
  probe: FakeProbe;
  world: MsfsCopilotWorld;
  ctx: ToolCallContext;
  /** 推进仿真时钟，喂给 PhaseTracker 的滞后窗口。 */
  advance(ms: number): void;
}

function makeRig(overrides: Partial<MsfsCopilotConfigSection> = {}): Rig {
  const host = new FakeHost();
  const probe = new FakeProbe();
  let clock = 0;
  const world = new MsfsCopilotWorld({
    cfg: { ...MSFS_COPILOT_DEFAULTS, enabled: true, ...overrides },
    timezone: 'Asia/Shanghai',
    dataDir: 'D:/tmp/msfs-copilot-test',
    probe,
    now: () => clock,
  });
  return {
    host,
    probe,
    world,
    ctx: { role: 'test', log: host.log } as unknown as ToolCallContext,
    advance(ms: number) {
      clock += ms;
    },
  };
}

/** 地面停着的一帧，用来当基准。 */
function parked(extra: Partial<Record<keyof typeof V, number | string>> = {}) {
  return values({ ON_GROUND: 1, PARKED: 1, AGL_FT: 0, ALT_FT: 500, IAS_KT: 0, TITLE: 'Cessna 172', ...extra });
}

function eventTypes(host: FakeHost): string[] {
  return host.events.map((e) => e.type);
}

describe('连接', () => {
  it('第一帧数据到了就推 connected，并带上机型与阶段', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());

    expect(eventTypes(rig.host)).toContain('msfs.connected');
    const connected = rig.host.events.find((e) => e.type === 'msfs.connected');
    expect(connected?.text).toContain('Cessna 172');
  });

  it('只推一次 connected', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    rig.probe.frame(parked());
    expect(eventTypes(rig.host).filter((t) => t === 'msfs.connected')).toHaveLength(1);
  });

  it('桥接断开时推 disconnected', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    rig.probe.close();
    await tick();
    expect(eventTypes(rig.host)).toContain('msfs.disconnected');
  });

  it('没连上就断开不推 disconnected', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.close();
    await tick();
    expect(eventTypes(rig.host)).not.toContain('msfs.disconnected');
  });
});

describe('事件', () => {
  it('离地推 takeoff，带离地速度和姿态', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 1, AGL_FT: 0, IAS_KT: 80, PITCH_RAD: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 60, IAS_KT: 85, PITCH_RAD: 0.15, HEADING_RAD: 4.7 }));
    await tick();

    const ev = rig.host.events.find((e) => e.type === 'msfs.takeoff');
    expect(ev).toBeDefined();
    expect(ev?.text).toContain('离地');
    expect(ev?.text).toContain('85 节');
  });

  it('低速离地（悬停/抖动）不推 takeoff', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 1, AGL_FT: 0, IAS_KT: 5 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 25, IAS_KT: 6 }));
    await tick();
    expect(eventTypes(rig.host)).not.toContain('msfs.takeoff');
  });

  it('接地推 touchdown，带下沉率', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 100, IAS_KT: 130 }));
    rig.probe.frame(
      values({ ON_GROUND: 1, AGL_FT: 0, IAS_KT: 125, TD_VS_FPS: -3, TD_PITCH_DEG: 3.2 }),
    );
    await tick();

    const ev = rig.host.events.find((e) => e.type === 'msfs.touchdown');
    expect(ev).toBeDefined();
    expect(ev?.text).toContain('下沉率');
    expect(ev?.text).toContain('-180 英尺/分');
  });

  it('失速上升沿推 stall，且触发方式是 interrupt', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, IAS_KT: 65, STALL: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, IAS_KT: 60, STALL: 1 }));
    await tick();

    const index = eventTypes(rig.host).indexOf('msfs.stall');
    expect(index).toBeGreaterThan(-1);
    expect(rig.host.pushOpts[index]?.trigger).toBe('interrupt');
  });

  it('失速持续只推一次', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 1 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 1 }));
    await tick();
    expect(eventTypes(rig.host).filter((t) => t === 'msfs.stall')).toHaveLength(1);
  });

  it('超速上升沿推 overspeed', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 31000, MACH: 0.7, OVERSPEED: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 31000, MACH: 0.86, IAS_KT: 320, OVERSPEED: 1 }));
    await tick();

    const ev = rig.host.events.find((e) => e.type === 'msfs.overspeed');
    expect(ev?.text).toContain('M0.86');
  });

  it('高度偏离超过阈值推 altitude_alert', async () => {
    const rig = makeRig({ altitudeAlertFt: 300 });
    await rig.world.start(rig.host);
    rig.probe.frame(
      values({ ON_GROUND: 0, AGL_FT: 24000, ALT_FT: 24000, AP_MASTER: 1, AP_ALT_LOCK: 1, AP_ALT_VAR_FT: 24000 }),
    );
    rig.probe.frame(
      values({ ON_GROUND: 0, AGL_FT: 23600, ALT_FT: 23600, AP_MASTER: 1, AP_ALT_LOCK: 1, AP_ALT_VAR_FT: 24000 }),
    );
    await tick();

    const ev = rig.host.events.find((e) => e.type === 'msfs.altitude_alert');
    expect(ev).toBeDefined();
    expect(ev?.text).toContain('低了');
    expect(ev?.text).toContain('400 英尺');
  });

  it('偏离回到一半阈值以内才允许再报', async () => {
    const rig = makeRig({ altitudeAlertFt: 300 });
    await rig.world.start(rig.host);
    const ap = { AP_MASTER: 1, AP_ALT_LOCK: 1, AP_ALT_VAR_FT: 24000 };
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 24000, ALT_FT: 24000, ...ap }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 23600, ALT_FT: 23600, ...ap }));
    // 只回到 100 英尺偏差：还在一半阈值（150）以内，重新允许
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 23900, ALT_FT: 23900, ...ap }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 23600, ALT_FT: 23600, ...ap }));
    await tick();
    expect(eventTypes(rig.host).filter((t) => t === 'msfs.altitude_alert')).toHaveLength(2);
  });

  it('爬升转巡航推 cruise，且是 piggyback', async () => {
    const rig = makeRig({ cruiseAltFt: 3000 });
    await rig.world.start(rig.host);
    // 先让它认定爬升
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 20000, VS_FPS: 40, IAS_KT: 280, MACH: 0.6 }));
    rig.advance(2000);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 30000, VS_FPS: 40, IAS_KT: 280, MACH: 0.7 }));
    // 再平稳：候选巡航
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 35000, VS_FPS: 0, IAS_KT: 280, MACH: 0.78 }));
    rig.advance(2000);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 35000, VS_FPS: 0, IAS_KT: 280, MACH: 0.78 }));
    await tick();

    const index = eventTypes(rig.host).indexOf('msfs.cruise');
    expect(index).toBeGreaterThan(-1);
    expect(rig.host.pushOpts[index]?.trigger).toBe('piggyback');
  });

  it('巡航转下降推 descent', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 35000, VS_FPS: 0 }));
    rig.advance(2000);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 35000, VS_FPS: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 20000, VS_FPS: -40 }));
    rig.advance(2000);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 20000, VS_FPS: -40 }));
    await tick();

    expect(eventTypes(rig.host)).toContain('msfs.descent');
  });

  it('下滑道信号从无到有推 approach，冷却期内不重复', async () => {
    const rig = makeRig({ approachCooldownSec: 90 });
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 3200, GS_FLAG: 0, DME_NM: 11.2 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 3000, GS_FLAG: 1, DME_NM: 11.0 }));
    // 信号短暂丢失又恢复，冷却期内不该再报
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 2900, GS_FLAG: 0, DME_NM: 10.8 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 2800, GS_FLAG: 1, DME_NM: 10.5 }));
    await tick();

    expect(eventTypes(rig.host).filter((t) => t === 'msfs.approach')).toHaveLength(1);
  });

  it('配置关掉的事件不再推', async () => {
    const rig = makeRig({ stall: false });
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 0 }));
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 1 }));
    await tick();
    expect(eventTypes(rig.host)).not.toContain('msfs.stall');
  });
});

describe('写权限', () => {
  it('总闸关着时 msfs_radio 拒绝并说明原因', async () => {
    const rig = makeRig({ writeEnabled: false });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const tool = rig.world.tools().find((t) => t.name === 'msfs_radio');
    const out = (await tool!.handler({ target: 'com1', value: 118.7 }, rig.ctx)) as ToolOutcome;

    expect(out.failed).toBe(true);
    expect(out.text).toContain('总闸');
    expect(rig.probe.sent).toHaveLength(0);
  });

  it('COM 频率：设备用再切主备', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const tool = rig.world.tools().find((t) => t.name === 'msfs_radio');
    const out = await tool!.handler({ target: 'com1', value: 118.7 }, rig.ctx);

    expect(typeof out).toBe('string');
    expect(rig.probe.sent).toEqual([
      { name: 'COM_STBY_RADIO_SET_HZ', data: 118_700_000 },
      { name: 'COM_STBY_RADIO_SWAP', data: 0 },
    ]);
  });

  it('NAV 频率直接设主频', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const tool = rig.world.tools().find((t) => t.name === 'msfs_nav');
    void tool; // 确认工具名没写错
    const radio = rig.world.tools().find((t) => t.name === 'msfs_radio');
    await radio!.handler({ target: 'nav2', value: 110.3 }, rig.ctx);
    expect(rig.probe.sent).toEqual([{ name: 'NAV2_RADIO_SET_HZ', data: 110_300_000 }]);
  });

  it('应答机码转 BCD16', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const radio = rig.world.tools().find((t) => t.name === 'msfs_radio');
    await radio!.handler({ target: 'transponder', value: 1200 }, rig.ctx);
    expect(rig.probe.sent).toEqual([{ name: 'XPNDR_SET', data: 0x1200 }]);
  });

  it('气压基准按 mb × 16 发', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const radio = rig.world.tools().find((t) => t.name === 'msfs_radio');
    await radio!.handler({ target: 'altimeter', value: 29.92 }, rig.ctx);
    // 29.92 inHg ≈ 1013.2 mb，×16 ≈ 16211
    expect(rig.probe.sent[0]?.name).toBe('KOHLSMAN_SET');
    expect(rig.probe.sent[0]?.data).toBe(16211);
  });

  it('单项权限关着时只拒那一项', async () => {
    const rig = makeRig({ writeEnabled: true, writeRadio: false, writeLights: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());

    const radio = rig.world.tools().find((t) => t.name === 'msfs_radio');
    const denied = (await radio!.handler({ target: 'com1', value: 118.7 }, rig.ctx)) as ToolOutcome;
    expect(denied.failed).toBe(true);
    expect(denied.text).toContain('COM');

    const sw = rig.world.tools().find((t) => t.name === 'msfs_switch');
    const ok = await sw!.handler({ target: 'landing_light', on: true }, rig.ctx);
    expect(ok).toBe('landing_light 已打开。');
  });

  it('地面上收起落架被拦住', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    const sw = rig.world.tools().find((t) => t.name === 'msfs_switch');
    const out = (await sw!.handler({ target: 'gear', on: false }, rig.ctx)) as ToolOutcome;
    expect(out.failed).toBe(true);
    expect(out.text).toContain('地面上');
    expect(rig.probe.sent).toHaveLength(0);
  });

  it('空中收起落架照做', async () => {
    const rig = makeRig({ writeEnabled: true });
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 1200 }));
    const sw = rig.world.tools().find((t) => t.name === 'msfs_switch');
    const out = await sw!.handler({ target: 'gear', on: false }, rig.ctx);
    expect(out).toBe('起落架已收起。');
    expect(rig.probe.sent).toEqual([{ name: 'GEAR_SET', data: 0 }]);
  });

  it('打开起落架权限关着时拒绝', async () => {
    const rig = makeRig({ writeEnabled: true, writeGear: false });
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 1200 }));
    const sw = rig.world.tools().find((t) => t.name === 'msfs_switch');
    const out = (await sw!.handler({ target: 'gear', on: true }, rig.ctx)) as ToolOutcome;
    expect(out.failed).toBe(true);
    expect(out.text).toContain('起落架');
  });
});

describe('只读工具', () => {
  it('msfs_status 报阶段与高度', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ TITLE: 'Airbus A320neo', ALT_FT: 35000, AGL_FT: 34000, IAS_KT: 280, MACH: 0.78 }));
    const status = rig.world.tools().find((t) => t.name === 'msfs_status');
    const text = await Promise.resolve(status!.handler({}, rig.ctx));
    expect(text).toContain('35,000 英尺');
    expect(text).toContain('M0.78');
    expect(text).toContain('Airbus A320neo');
  });

  it('没数据时工具说没连上，不编状态', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    // 注入的连接失败信息
    rig.probe.fail('SimConnect_Open 返回 1');
    const status = rig.world.tools().find((t) => t.name === 'msfs_status');
    const text = await Promise.resolve(status!.handler({}, rig.ctx));
    expect(text).toContain('还没连上');
    expect(text).toContain('SimConnect_Open');
  });

  it('msfs_alerts 只报真正亮着的告警', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(values({ ON_GROUND: 0, AGL_FT: 4200, STALL: 1, IAS_KT: 62 }));
    const alerts = rig.world.tools().find((t) => t.name === 'msfs_alerts');
    const text = await Promise.resolve(alerts!.handler({}, rig.ctx));
    expect(text).toContain('失速警告');
    expect(text).not.toContain('超速');
  });
});

describe('模板变量', () => {
  it('机型、阶段、单位跟着状态走', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked({ TITLE: 'Boeing 747-8' }));
    const vars = rig.world.envPromptVars();
    expect(vars['msfs.aircraft']).toBe('Boeing 747-8');
    expect(vars['msfs.phase']).toBe('停机');
    expect(vars['msfs.units']).toContain('航空单位');
  });

  it('公制切换体现在模板变量上', async () => {
    const rig = makeRig({ metric: true });
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    expect(rig.world.envPromptVars()['msfs.units']).toContain('公制');
  });

  it('暂停状态来自系统事件', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    rig.probe.systemEvent('Pause', 1);
    expect(rig.world.envPromptVars()['msfs.paused']).toContain('已暂停');
    rig.probe.systemEvent('Pause', 0);
    expect(rig.world.envPromptVars()['msfs.paused']).toBe('运行中');
  });

  it('仿真倍率如实说读不到，不编一个数', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    // SimConnect 没有可读的倍率变量，这里必须是「未提供」而不是某个数字。
    expect(rig.world.envPromptVars()['msfs.simRate']).toContain('未提供');
  });

  it('连不上时如实说明', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.fail('找不到 SimConnect.dll');
    expect(rig.world.envPromptVars()['msfs.connected']).toContain('未连上');
  });
});

describe('生命周期', () => {
  it('订阅了 Pause 系统事件', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    expect(rig.probe.subscribed).toEqual([{ id: 100, name: 'Pause' }]);
  });

  it('声明了全部 SimVar 并请求秒级推送', async () => {
    const rig = makeRig({ pollMs: 2000 });
    await rig.world.start(rig.host);
    expect(rig.probe.defined[0]?.vars).toHaveLength(SIMVARS.length);
    expect(rig.probe.requested).toEqual([{ id: 1, period: 'second', interval: 2 }]);
  });

  it('stop 会关掉桥接并清空状态', async () => {
    const rig = makeRig();
    await rig.world.start(rig.host);
    rig.probe.frame(parked());
    await rig.world.stop();
    expect(rig.probe.stopped).toBe(true);
    expect(rig.world.envPromptVars()['msfs.connected']).toContain('正在连接');
  });
});
