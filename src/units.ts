/**
 * 单位换算与报数格式。
 *
 * 默认航空单位（英尺、节、海里、英寸汞柱），可切公制。只在渲染时换算，
 * 内部状态一律保持 SDK 原始单位，免得来回换算出累积误差。
 */
export type UnitSystem = 'aviation' | 'metric';

const FT_PER_M = 3.28084;
const M_PER_FT = 0.3048;
const KMH_PER_KT = 1.852;
const NM_PER_KM = 1 / 1.852;
const MPS_PER_FPM = 0.00508;
const KG_PER_LB = 0.45359237;
const HPA_PER_INHG = 33.8639;

/** 千分位。SIM 里高度动辄五位数，不分组读起来费劲。 */
export function group(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** 带符号的增减，用于垂直速度和下滑道偏差。 */
export function signed(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '—';
  const text = group(Math.abs(n), decimals);
  if (n > 0) return `+${text}`;
  if (n < 0) return `-${text}`;
  return text;
}

export function formatAltitude(ft: number, units: UnitSystem): string {
  if (!Number.isFinite(ft)) return '—';
  return units === 'metric'
    ? `${group(ft * M_PER_FT)} 米`
    : `${group(ft)} 英尺`;
}

/** 垂直速度。输入英尺/分。 */
export function formatVerticalSpeed(fpm: number, units: UnitSystem): string {
  if (!Number.isFinite(fpm)) return '—';
  return units === 'metric'
    ? `${signed(fpm * MPS_PER_FPM, 1)} 米/秒`
    : `${signed(fpm)} 英尺/分`;
}

/** 空速/地速。输入节。 */
export function formatSpeed(kt: number, units: UnitSystem): string {
  if (!Number.isFinite(kt)) return '—';
  return units === 'metric'
    ? `${group(kt * KMH_PER_KT)} 公里/小时`
    : `${group(kt)} 节`;
}

/** 距离。输入海里。 */
export function formatDistanceNm(nm: number, units: UnitSystem): string {
  if (!Number.isFinite(nm)) return '—';
  return units === 'metric'
    ? `${group(nm / NM_PER_KM, 1)} 公里`
    : `${group(nm, 1)} 海里`;
}

/** 马赫。两套单位都用马赫，只是小数位不同。 */
export function formatMach(mach: number): string {
  if (!Number.isFinite(mach) || mach <= 0) return '—';
  return `M${mach.toFixed(2)}`;
}

/** 气压基准。优先用英寸汞柱，公制给百帕。 */
export function formatPressure(inHg: number, units: UnitSystem): string {
  if (!Number.isFinite(inHg) || inHg <= 0) return '—';
  return units === 'metric'
    ? `${group(inHg * HPA_PER_INHG)} 百帕`
    : `${inHg.toFixed(2)} 英寸汞柱`;
}

/** 风。输入节与来向度数，输出「270 度 15 节」。 */
export function formatWind(kt: number, dirDeg: number, units: UnitSystem): string {
  if (!Number.isFinite(kt) || kt < 0.5) return '静风';
  const dir = Math.round(((dirDeg % 360) + 360) % 360);
  const speed = units === 'metric'
    ? `${group(kt * KMH_PER_KT)} 公里/小时`
    : `${group(kt)} 节`;
  return `${String(dir).padStart(3, '0')} 度 ${speed}`;
}

export function formatTemperature(c: number, _units: UnitSystem): string {
  if (!Number.isFinite(c)) return '—';
  return `${group(c)} 摄氏度`;
}

export function formatWeight(lb: number, units: UnitSystem): string {
  if (!Number.isFinite(lb)) return '—';
  return units === 'metric'
    ? `${group(lb * KG_PER_LB)} 公斤`
    : `${group(lb)} 磅`;
}

/** 姿态：俯仰、坡度、航向。航向永远三位数。 */
export function formatAttitude(pitchDeg: number, bankDeg: number): string {
  const pitch = `${signed(pitchDeg, 1)} 度`;
  const side = bankDeg > 0 ? '右' : bankDeg < 0 ? '左' : '';
  const bank = Math.abs(bankDeg) < 0.5 ? '机翼水平' : `${side} ${Math.abs(bankDeg).toFixed(0)} 度`;
  return `俯仰 ${pitch}，${bank}`;
}

export function formatHeading(deg: number): string {
  if (!Number.isFinite(deg)) return '—';
  const d = Math.round(((deg % 360) + 360) % 360);
  return `${String(d).padStart(3, '0')} 度`;
}

/** 时间跨度，用于「多久之前」。 */
export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  return `${min} 分 ${sec % 60} 秒`;
}

/** 时长：秒 → 「1 小时 20 分」。用于 ETE。 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}