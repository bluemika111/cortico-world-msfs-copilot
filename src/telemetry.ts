/**
 * SimVar 清单与类型化解析。
 *
 * 单位按 SDK 文档逐条核对过，几处反直觉的地方写在行尾：
 * - `PLANE PITCH/BANK/HEADING DEGREES` 名字里带 DEGREES，单位其实是弧度。
 * - `VERTICAL SPEED` 是英尺/秒，不是英尺/分。
 * - `COM ACTIVE FREQUENCY` 默认单位是 BCD16 编码，这里显式要 MHz 拿浮点。
 *
 * 数组下标就是桥接回包里 values 的下标，顺序不能随手改：改了要同步 `V`。
 */
import type { SimVarSpec } from './probe/simconnect.ts';

const f64 = (name: string, unit: string): SimVarSpec => ({ name, unit, type: 'f64' });
const str = (name: string): SimVarSpec => ({ name, unit: '', type: 'str' });

export const SIMVARS: readonly SimVarSpec[] = [
  // —— 飞行状态 ——
  f64('PLANE LATITUDE', 'radians'),
  f64('PLANE LONGITUDE', 'radians'),
  f64('PLANE ALTITUDE', 'feet'),
  f64('PLANE ALT ABOVE GROUND', 'feet'),
  f64('PLANE PITCH DEGREES', 'radians'),
  f64('PLANE BANK DEGREES', 'radians'),
  f64('PLANE HEADING DEGREES TRUE', 'radians'),
  f64('AIRSPEED INDICATED', 'knots'),
  f64('AIRSPEED TRUE', 'knots'),
  f64('AIRSPEED MACH', 'mach'),
  f64('GROUND VELOCITY', 'knots'),
  f64('VERTICAL SPEED', 'feet per second'),
  f64('SIM ON GROUND', 'bool'),
  f64('PLANE IN PARKING STATE', 'bool'),
  f64('IS SLEW ACTIVE', 'bool'),

  // —— 告警 ——
  f64('STALL WARNING', 'bool'),
  f64('OVERSPEED WARNING', 'bool'),
  f64('STRUCTURAL ICE PCT', 'percent over 100'),

  // —— 自动驾驶 ——
  f64('AUTOPILOT MASTER', 'bool'),
  f64('AUTOPILOT HEADING LOCK', 'bool'),
  f64('AUTOPILOT ALTITUDE LOCK', 'bool'),
  f64('AUTOPILOT APPROACH HOLD', 'bool'),
  f64('AUTOPILOT NAV1 LOCK', 'bool'),
  f64('AUTOPILOT ALTITUDE LOCK VAR', 'feet'),
  f64('AUTOPILOT HEADING LOCK DIR', 'degrees'),
  f64('AUTOPILOT AIRSPEED HOLD VAR', 'knots'),
  f64('AUTOPILOT VERTICAL HOLD VAR', 'feet per minute'),

  // —— 无线电与导航 ——
  f64('COM ACTIVE FREQUENCY:1', 'MHz'),
  f64('COM ACTIVE FREQUENCY:2', 'MHz'),
  f64('NAV ACTIVE FREQUENCY:1', 'MHz'),
  f64('NAV ACTIVE FREQUENCY:2', 'MHz'),
  f64('TRANSPONDER CODE:1', 'number'),
  f64('TRANSPONDER STATE', 'number'),
  f64('NAV GS FLAG', 'bool'),
  f64('NAV LOCALIZER', 'degrees'),
  f64('NAV GLIDE SLOPE ERROR', 'degrees'),
  f64('NAV DME:1', 'nautical miles'),
  f64('NAV CDI:1', 'number'),
  f64('NAV TOFROM:1', 'number'),
  str('GPS WP NEXT ID'),
  f64('GPS WP DISTANCE', 'meters'),
  f64('GPS WP BEARING', 'radians'),
  f64('GPS GROUND SPEED', 'meters per second'),
  // 航路总量：全程长度、到下一航路点/到目的地的预计时间、下一航路点高度。
  f64('GPS FLIGHTPLAN TOTAL DISTANCE', 'meters'),
  f64('GPS WP ETE', 'seconds'),
  f64('GPS ETE', 'seconds'),
  f64('GPS WP NEXT ALT', 'meters'),

  // —— 天气与环境 ——
  f64('AMBIENT WIND VELOCITY', 'knots'),
  f64('AMBIENT WIND DIRECTION', 'degrees'),
  f64('AMBIENT TEMPERATURE', 'celsius'),
  f64('AMBIENT PRESSURE', 'inches of mercury'),
  f64('BAROMETER PRESSURE', 'millibars'),
  f64('AMBIENT VISIBILITY', 'meters'),
  f64('AMBIENT PRECIP STATE', 'number'),

  // —— 写操作要回读的状态 ——
  f64('LIGHT LANDING', 'bool'),
  f64('LIGHT NAV', 'bool'),
  f64('LIGHT STROBE', 'bool'),
  f64('LIGHT TAXI', 'bool'),
  f64('LIGHT BEACON', 'bool'),
  f64('GEAR HANDLE POSITION', 'percent over 100'),
  f64('GEAR CENTER POSITION', 'percent over 100'),
  f64('GEAR LEFT POSITION', 'percent over 100'),
  f64('GEAR RIGHT POSITION', 'percent over 100'),
  f64('KOHLSMAN SETTING HG:1', 'inches of mercury'),

  // —— 接地 ——
  f64('PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second'),
  f64('PLANE TOUCHDOWN PITCH DEGREES', 'degrees'),
  f64('PLANE TOUCHDOWN BANK DEGREES', 'degrees'),
  f64('PLANE TOUCHDOWN HEADING DEGREES MAGNETIC', 'degrees'),

  // —— 机型与仿真 ——
  str('TITLE'),
  // 注意：没有 SIMULATION RATE 这个 SimVar（SDK 里只有同名的「事件」）。
  // 早先按想当然加了一条，SimConnect 回 NAME_UNRECOGNIZED，整个定义连带失效。
  // 暂停或弹对话框时 MSFS 停更模拟；副驾据此判断「现在的读数是停住的」。
  f64('SIM DISABLED', 'bool'),
];

/** `SIMVARS` 的下标。写错一个数字就是读错一个量，所以集中在这里。 */
export const V = {
  LAT: 0,
  LON: 1,
  ALT_FT: 2,
  AGL_FT: 3,
  PITCH_RAD: 4,
  BANK_RAD: 5,
  HEADING_RAD: 6,
  IAS_KT: 7,
  TAS_KT: 8,
  MACH: 9,
  GS_KT: 10,
  VS_FPS: 11,
  ON_GROUND: 12,
  PARKED: 13,
  SLEW: 14,

  STALL: 15,
  OVERSPEED: 16,
  ICE_PCT: 17,

  AP_MASTER: 18,
  AP_HDG_LOCK: 19,
  AP_ALT_LOCK: 20,
  AP_APPR_HOLD: 21,
  AP_NAV1_LOCK: 22,
  AP_ALT_VAR_FT: 23,
  AP_HDG_DIR_DEG: 24,
  AP_SPD_VAR_KT: 25,
  AP_VS_VAR_FPM: 26,

  COM1_MHZ: 27,
  COM2_MHZ: 28,
  NAV1_MHZ: 29,
  NAV2_MHZ: 30,
  XPNDR_BCD: 31,
  XPNDR_STATE: 32,
  GS_FLAG: 33,
  LOC_COURSE_DEG: 34,
  GS_ERROR_DEG: 35,
  DME_NM: 36,
  CDI: 37,
  TOFROM: 38,
  GPS_NEXT_ID: 39,
  GPS_WP_DIST_M: 40,
  GPS_WP_BEARING_RAD: 41,
  GPS_GS_MPS: 42,
  GPS_TOTAL_M: 43,
  GPS_WP_ETE_S: 44,
  GPS_ETE_S: 45,
  GPS_WP_NEXT_ALT_M: 46,

  WIND_KT: 47,
  WIND_DIR_DEG: 48,
  TEMP_C: 49,
  AMBIENT_INHG: 50,
  BARO_MB: 51,
  VISIBILITY_M: 52,
  PRECIP: 53,

  LIGHT_LANDING: 54,
  LIGHT_NAV: 55,
  LIGHT_STROBE: 56,
  LIGHT_TAXI: 57,
  LIGHT_BEACON: 58,
  GEAR_HANDLE: 59,
  GEAR_CENTER: 60,
  GEAR_LEFT: 61,
  GEAR_RIGHT: 62,
  KOHLSMAN_INHG: 63,

  TD_VS_FPS: 64,
  TD_PITCH_DEG: 65,
  TD_BANK_DEG: 66,
  TD_HEADING_DEG: 67,

  TITLE: 68,
  SIM_DISABLED: 69,
} as const;

const RAD_TO_DEG = 180 / Math.PI;

/** BCD16 → 整数。应答机码 1200 在这条通道上回来的是 0x1200。 */
export function bcd16ToInt(raw: number): number {
  const v = Math.round(raw) & 0xffff;
  const d0 = v & 0xf;
  const d1 = (v >> 4) & 0xf;
  const d2 = (v >> 8) & 0xf;
  const d3 = (v >> 12) & 0xf;
  return d3 * 1000 + d2 * 100 + d1 * 10 + d0;
}

/** 应答机码 → 四位字符串，前导零保留。没读到有效码时返回空串。 */
export function xpndrCode(raw: number): string {
  const v = Math.round(raw);
  if (!Number.isFinite(v) || v <= 0) return '';
  // SDK 文档写单位是 BCD16，但 SimConnect 的单位表里没有这个名字（实测 no-data）。
  // 改用 number 之后，机模可能回十进制 1200，也可能回 BCD 编码的 0x1200，两种都认。
  const n = v > 7777 ? bcd16ToInt(v) : v;
  if (n < 0 || n > 7777) return '';
  return String(n).padStart(4, '0');
}

export interface AutopilotState {
  master: boolean;
  heading: boolean;
  altitude: boolean;
  approach: boolean;
  nav1: boolean;
  targetAltFt: number;
  targetHeadingDeg: number;
  targetSpeedKt: number;
  targetVsFpm: number;
}

export interface NavState {
  com1Mhz: number;
  com2Mhz: number;
  nav1Mhz: number;
  nav2Mhz: number;
  /** 四位应答机码；读不到时为空串。 */
  transponder: string;
  transponderState: number;
  /** 下滑道信号有效。 */
  gsFlag: boolean;
  localizerDeg: number;
  /** 偏离下滑道多少度，正负号有用。 */
  gsErrorDeg: number;
  dmeNm: number;
  cdi: number;
  toFrom: number;
  nextWaypoint: string;
  wpDistanceNm: number;
  wpBearingDeg: number;
  gpsGroundSpeedKt: number;
  /** 飞行计划全程长度（海里）。没装飞行计划时为 0。 */
  totalDistanceNm: number;
  /** 到下一航路点的预计时间（秒）。 */
  wpEteS: number;
  /** 到目的地的预计时间（秒）。 */
  eteS: number;
  /** 下一航路点的计划高度（英尺）。 */
  wpNextAltFt: number;
}

export interface WeatherState {
  windKt: number;
  windDirDeg: number;
  tempC: number;
  ambientInHg: number;
  baroMb: number;
  visibilityM: number;
  precip: number;
}

export interface GearState {
  handleDown: boolean;
  /** 三个轮子里最不放下的那个，0–1。 */
  lowest: number;
  center: number;
  left: number;
  right: number;
}

export interface LightsState {
  landing: boolean;
  nav: boolean;
  strobe: boolean;
  taxi: boolean;
  beacon: boolean;
}

export interface TouchdownState {
  /** 接地时的法向速度，英尺/秒。 */
  vsFps: number;
  pitchDeg: number;
  bankDeg: number;
  headingDeg: number;
}

export interface TelemetryFrame {
  lat: number;
  lon: number;
  altFt: number;
  aglFt: number;
  pitchDeg: number;
  bankDeg: number;
  headingDeg: number;
  iasKt: number;
  tasKt: number;
  mach: number;
  gsKt: number;
  /** 英尺/分，已经从英尺/秒换算过。 */
  vsFpm: number;
  onGround: boolean;
  parked: boolean;
  slew: boolean;
  stall: boolean;
  overspeed: boolean;
  /** 结构结冰百分比，0–100。 */
  icePct: number;
  ap: AutopilotState;
  nav: NavState;
  wx: WeatherState;
  gear: GearState;
  lights: LightsState;
  touchdown: TouchdownState;
  kohlsmanInHg: number;
  /** 机型名，来自 aircraft.cfg 的 title。 */
  title: string;
  /** 仿真倍率；读不到时为 1。 */
  simRate: number;
  /** 模拟被暂停或对话框挡住；这时读数是停住的。 */
  simDisabled: boolean;
}

/** 读一个数；缺值、null、NaN 一律当 0，调用方不用到处判空。 */
function num(values: ReadonlyArray<number | string | null>, index: number): number {
  const v = values[index];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function bool(values: ReadonlyArray<number | string | null>, index: number): boolean {
  return num(values, index) > 0.5;
}

function text(values: ReadonlyArray<number | string | null>, index: number): string {
  const v = values[index];
  return typeof v === 'string' ? v.trim() : '';
}

/** 把桥接回包摊平成飞行状态。 */
export function parseFrame(values: ReadonlyArray<number | string | null>): TelemetryFrame {
  return {
    lat: num(values, V.LAT) * RAD_TO_DEG,
    lon: num(values, V.LON) * RAD_TO_DEG,
    altFt: num(values, V.ALT_FT),
    aglFt: num(values, V.AGL_FT),
    pitchDeg: num(values, V.PITCH_RAD) * RAD_TO_DEG,
    bankDeg: num(values, V.BANK_RAD) * RAD_TO_DEG,
    headingDeg: num(values, V.HEADING_RAD) * RAD_TO_DEG,
    iasKt: num(values, V.IAS_KT),
    tasKt: num(values, V.TAS_KT),
    mach: num(values, V.MACH),
    gsKt: num(values, V.GS_KT),
    vsFpm: num(values, V.VS_FPS) * 60,
    onGround: bool(values, V.ON_GROUND),
    parked: bool(values, V.PARKED),
    slew: bool(values, V.SLEW),
    stall: bool(values, V.STALL),
    overspeed: bool(values, V.OVERSPEED),
    icePct: num(values, V.ICE_PCT) * 100,
    ap: {
      master: bool(values, V.AP_MASTER),
      heading: bool(values, V.AP_HDG_LOCK),
      altitude: bool(values, V.AP_ALT_LOCK),
      approach: bool(values, V.AP_APPR_HOLD),
      nav1: bool(values, V.AP_NAV1_LOCK),
      targetAltFt: num(values, V.AP_ALT_VAR_FT),
      targetHeadingDeg: num(values, V.AP_HDG_DIR_DEG),
      targetSpeedKt: num(values, V.AP_SPD_VAR_KT),
      targetVsFpm: num(values, V.AP_VS_VAR_FPM),
    },
    nav: {
      com1Mhz: num(values, V.COM1_MHZ),
      com2Mhz: num(values, V.COM2_MHZ),
      nav1Mhz: num(values, V.NAV1_MHZ),
      nav2Mhz: num(values, V.NAV2_MHZ),
      transponder: xpndrCode(num(values, V.XPNDR_BCD)),
      transponderState: num(values, V.XPNDR_STATE),
      gsFlag: bool(values, V.GS_FLAG),
      localizerDeg: num(values, V.LOC_COURSE_DEG),
      gsErrorDeg: num(values, V.GS_ERROR_DEG),
      dmeNm: num(values, V.DME_NM),
      cdi: num(values, V.CDI),
      toFrom: num(values, V.TOFROM),
      nextWaypoint: text(values, V.GPS_NEXT_ID),
      wpDistanceNm: num(values, V.GPS_WP_DIST_M) / 1852,
      wpBearingDeg: num(values, V.GPS_WP_BEARING_RAD) * RAD_TO_DEG,
      gpsGroundSpeedKt: num(values, V.GPS_GS_MPS) * 1.943844,
      totalDistanceNm: num(values, V.GPS_TOTAL_M) / 1852,
      wpEteS: num(values, V.GPS_WP_ETE_S),
      eteS: num(values, V.GPS_ETE_S),
      wpNextAltFt: num(values, V.GPS_WP_NEXT_ALT_M) * 3.28084,
    },
    wx: {
      windKt: num(values, V.WIND_KT),
      windDirDeg: num(values, V.WIND_DIR_DEG),
      tempC: num(values, V.TEMP_C),
      ambientInHg: num(values, V.AMBIENT_INHG),
      baroMb: num(values, V.BARO_MB),
      visibilityM: num(values, V.VISIBILITY_M),
      precip: num(values, V.PRECIP),
    },
    gear: {
      handleDown: num(values, V.GEAR_HANDLE) > 0.5,
      lowest: Math.min(
        num(values, V.GEAR_CENTER),
        num(values, V.GEAR_LEFT),
        num(values, V.GEAR_RIGHT),
      ),
      center: num(values, V.GEAR_CENTER),
      left: num(values, V.GEAR_LEFT),
      right: num(values, V.GEAR_RIGHT),
    },
    lights: {
      landing: bool(values, V.LIGHT_LANDING),
      nav: bool(values, V.LIGHT_NAV),
      strobe: bool(values, V.LIGHT_STROBE),
      taxi: bool(values, V.LIGHT_TAXI),
      beacon: bool(values, V.LIGHT_BEACON),
    },
    touchdown: {
      vsFps: num(values, V.TD_VS_FPS),
      pitchDeg: num(values, V.TD_PITCH_DEG),
      bankDeg: num(values, V.TD_BANK_DEG),
      headingDeg: num(values, V.TD_HEADING_DEG),
    },
    kohlsmanInHg: num(values, V.KOHLSMAN_INHG),
    title: text(values, V.TITLE),
    // 没有可读的倍率变量；保留字段让上层不用到处判空。
    simRate: 1,
    simDisabled: bool(values, V.SIM_DISABLED),
  };
}
