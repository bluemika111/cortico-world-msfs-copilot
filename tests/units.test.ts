import { describe, expect, it } from 'vitest';
import {
  formatAltitude,
  formatAttitude,
  formatDistanceNm,
  formatHeading,
  formatMach,
  formatPressure,
  formatSpeed,
  formatVerticalSpeed,
  formatWind,
  group,
  signed,
} from '../src/units.ts';

describe('group / signed', () => {
  it('千分位分组', () => {
    expect(group(35000)).toBe('35,000');
    expect(group(1234.5, 1)).toBe('1,234.5');
  });

  it('非数给破折号', () => {
    expect(group(Number.NaN)).toBe('—');
  });

  it('带符号', () => {
    expect(signed(1200)).toBe('+1,200');
    expect(signed(-1800)).toBe('-1,800');
    expect(signed(0)).toBe('0');
  });
});

describe('formatAltitude', () => {
  it('航空单位报英尺', () => {
    expect(formatAltitude(35000, 'aviation')).toBe('35,000 英尺');
  });

  it('公制换米', () => {
    expect(formatAltitude(10000, 'metric')).toBe('3,048 米');
  });
});

describe('formatVerticalSpeed', () => {
  it('航空单位报英尺每分', () => {
    expect(formatVerticalSpeed(1200, 'aviation')).toBe('+1,200 英尺/分');
    expect(formatVerticalSpeed(-1800, 'aviation')).toBe('-1,800 英尺/分');
  });

  it('公制换米每秒', () => {
    expect(formatVerticalSpeed(300, 'metric')).toBe('+1.5 米/秒');
  });
});

describe('formatSpeed', () => {
  it('节', () => {
    expect(formatSpeed(250, 'aviation')).toBe('250 节');
  });

  it('公里每小时', () => {
    expect(formatSpeed(250, 'metric')).toBe('463 公里/小时');
  });
});

describe('formatDistanceNm', () => {
  it('海里', () => {
    expect(formatDistanceNm(12.4, 'aviation')).toBe('12.4 海里');
  });

  it('公里', () => {
    expect(formatDistanceNm(12.4, 'metric')).toBe('23.0 公里');
  });
});

describe('formatMach', () => {
  it('两位小数', () => {
    expect(formatMach(0.78)).toBe('M0.78');
  });

  it('零与无效值给破折号', () => {
    expect(formatMach(0)).toBe('—');
    expect(formatMach(Number.NaN)).toBe('—');
  });
});

describe('formatPressure', () => {
  it('英寸汞柱', () => {
    expect(formatPressure(29.92, 'aviation')).toBe('29.92 英寸汞柱');
  });

  it('百帕', () => {
    expect(formatPressure(29.92, 'metric')).toBe('1,013 百帕');
  });
});

describe('formatWind', () => {
  it('风向三位数补零', () => {
    expect(formatWind(15, 270, 'aviation')).toBe('270 度 15 节');
    expect(formatWind(8, 40, 'aviation')).toBe('040 度 8 节');
  });

  it('小于半节算静风', () => {
    expect(formatWind(0.3, 90, 'aviation')).toBe('静风');
  });

  it('公制换公里每小时', () => {
    expect(formatWind(10, 180, 'metric')).toBe('180 度 19 公里/小时');
  });
});

describe('formatAttitude / formatHeading', () => {
  it('俯仰带符号，坡度说左右', () => {
    expect(formatAttitude(8.5, -12)).toBe('俯仰 +8.5 度，左 12 度');
    expect(formatAttitude(-3, 20)).toBe('俯仰 -3.0 度，右 20 度');
  });

  it('接近零的坡度算机翼水平', () => {
    expect(formatAttitude(2, 0.2)).toBe('俯仰 +2.0 度，机翼水平');
  });

  it('航向取模并补零', () => {
    expect(formatHeading(268)).toBe('268 度');
    expect(formatHeading(-2)).toBe('358 度');
    expect(formatHeading(370)).toBe('010 度');
  });
});
