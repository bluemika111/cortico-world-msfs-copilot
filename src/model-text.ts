/**
 * 事件正文。
 *
 * 只陈述事实：什么时候、什么值、和什么比。不判断该不该说话，也不替模型下结论。
 * 单位按操作者选的制式渲染。
 */
import type { TelemetryFrame } from './telemetry.ts';
import {
  formatAltitude,
  formatAttitude,
  formatHeading,
  formatMach,
  formatSpeed,
  formatVerticalSpeed,
  group,
  type UnitSystem,
} from './units.ts';

/** 离地：这一刻的速度、姿态和跑道朝向。 */
export function renderTakeoff(f: TelemetryFrame, units: UnitSystem): string {
  return [
    '离地了。',
    `离地速度 ${formatSpeed(f.iasKt, units)}，`,
    `抬轮姿态 ${formatAttitude(f.pitchDeg, f.bankDeg)}，`,
    `航向 ${formatHeading(f.headingDeg)}。`,
  ].join('');
}

/** 到达巡航：爬升结束的那一刻。 */
export function renderCruise(f: TelemetryFrame, units: UnitSystem): string {
  return [
    '爬升结束，进入巡航。',
    `高度 ${formatAltitude(f.altFt, units)}，`,
    `${formatMach(f.mach)}，`,
    `空速 ${formatSpeed(f.iasKt, units)}。`,
  ].join('');
}

/** 开始下降。 */
export function renderDescent(f: TelemetryFrame, units: UnitSystem): string {
  return [
    '开始下降。',
    `高度 ${formatAltitude(f.altFt, units)}，`,
    `下降率 ${formatVerticalSpeed(f.vsFpm, units)}，`,
    `空速 ${formatSpeed(f.iasKt, units)}。`,
  ].join('');
}

/** 进近建立：截获下滑道。 */
export function renderApproach(f: TelemetryFrame, units: UnitSystem): string {
  const cdi = f.nav.cdi;
  // CDI 是 ±127 的针偏，正负号表示左右；这里只说方向，不说具体几个点。
  const side = cdi > 6 ? '偏右' : cdi < -6 ? '偏左' : '居中';
  const parts = [
    '截获下滑道。',
    `距跑道 ${formatDistance(f.nav.dmeNm, units)}，`,
    `高度 ${formatAltitude(f.altFt, units)}，`,
    `航向道${side}`,
  ];
  if (Number.isFinite(f.nav.gsErrorDeg) && Math.abs(f.nav.gsErrorDeg) > 0.05) {
    parts.push(`，下滑道偏差 ${f.nav.gsErrorDeg > 0 ? '高' : '低'} ${Math.abs(f.nav.gsErrorDeg).toFixed(2)} 度`);
  }
  parts.push('。');
  return parts.join('');
}

/** 接地：PM 最该报的一条。 */
export function renderTouchdown(f: TelemetryFrame, units: UnitSystem): string {
  const td = f.touchdown;
  const fpm = td.vsFps * 60;
  const mps = td.vsFps * 0.3048;
  return [
    '接地。',
    `下沉率 ${formatVerticalSpeed(fpm, units)}（${mps.toFixed(1)} 米/秒），`,
    `接地俯仰 ${td.pitchDeg >= 0 ? '+' : ''}${td.pitchDeg.toFixed(1)} 度，`,
    `坡度 ${td.bankDeg.toFixed(1)} 度，`,
    `航向 ${formatHeading(td.headingDeg)}。`,
  ].join('');
}

/** 失速警告。最高优先级，先说结论。 */
export function renderStall(f: TelemetryFrame, units: UnitSystem): string {
  return [
    '失速警告响了。',
    `空速 ${formatSpeed(f.iasKt, units)}，`,
    `俯仰 ${f.pitchDeg >= 0 ? '+' : ''}${f.pitchDeg.toFixed(1)} 度，`,
    `高度 ${formatAltitude(f.aglFt, units)}（离地）。`,
  ].join('');
}

/** 超速警告。 */
export function renderOverspeed(f: TelemetryFrame, units: UnitSystem): string {
  return [
    '超速警告响了。',
    `${formatMach(f.mach)}，`,
    `空速 ${formatSpeed(f.iasKt, units)}，`,
    `高度 ${formatAltitude(f.altFt, units)}。`,
  ].join('');
}

/** 高度偏离：和自动驾驶选定高度比。 */
export function renderAltitudeAlert(
  f: TelemetryFrame,
  units: UnitSystem,
  targetAltFt: number,
): string {
  const diff = f.altFt - targetAltFt;
  const side = diff >= 0 ? '高了' : '低了';
  const parts = [
    '高度偏离。',
    `选定 ${formatAltitude(targetAltFt, units)}，`,
    `实际 ${formatAltitude(f.altFt, units)}，`,
    `${side} ${formatAltitude(Math.abs(diff), units)}`,
  ];
  if (f.ap.master) {
    parts.push('，自动驾驶接通着');
  }
  parts.push('。');
  return parts.join('');
}

/** 连上了。 */
export function renderConnected(f: TelemetryFrame, phaseLabel: string): string {
  const title = f.title || '未报机型';
  return `连上模拟器了。机型 ${title}，当前阶段 ${phaseLabel}。`;
}

/** 断了。 */
export function renderDisconnected(reason: string): string {
  return `和模拟器的连接断了：${reason}`;
}

/** 距离：海里优先；米制时换公里。 */
function formatDistance(nm: number, units: UnitSystem): string {
  if (!Number.isFinite(nm) || nm <= 0) return '未知距离';
  return units === 'metric'
    ? `${group(nm * 1.852, 1)} 公里`
    : `${group(nm, 1)} 海里`;
}
