import { describe, expect, it } from 'vitest';
import { PhaseTracker, classifyPhase, type PhaseInput } from '../src/phase.ts';

function input(overrides: Partial<PhaseInput> = {}): PhaseInput {
  return {
    onGround: false,
    parked: false,
    aglFt: 5000,
    iasKt: 250,
    vsFpm: 0,
    gearDown: false,
    ...overrides,
  };
}

describe('classifyPhase', () => {
  it('停着是 preflight', () => {
    expect(classifyPhase(input({ onGround: true, parked: true, aglFt: 0, iasKt: 0 }), 'preflight')).toBe('preflight');
  });

  it('地面低速是滑行', () => {
    expect(classifyPhase(input({ onGround: true, aglFt: 0, iasKt: 20 }), 'preflight')).toBe('taxi');
  });

  it('地面高速加速是起飞滑跑', () => {
    expect(classifyPhase(input({ onGround: true, aglFt: 0, iasKt: 80, vsFpm: 0 }), 'taxi')).toBe('takeoff');
  });

  it('起飞滑跑减速后回到滑行', () => {
    expect(classifyPhase(input({ onGround: true, aglFt: 0, iasKt: 20 }), 'takeoff')).toBe('taxi');
  });

  it('空中正爬升是 climb', () => {
    expect(classifyPhase(input({ aglFt: 5000, vsFpm: 1500 }), 'takeoff')).toBe('climb');
  });

  it('高空平稳是 cruise', () => {
    expect(classifyPhase(input({ aglFt: 35000, vsFpm: 0 }), 'climb')).toBe('cruise');
  });

  it('持续下沉是 descent', () => {
    expect(classifyPhase(input({ aglFt: 20000, vsFpm: -1500 }), 'cruise')).toBe('descent');
  });

  it('低空减速放轮是 approach', () => {
    expect(
      classifyPhase(input({ aglFt: 2000, vsFpm: -700, iasKt: 140, gearDown: true }), 'descent'),
    ).toBe('approach');
  });

  it('贴近地面是 landing', () => {
    expect(classifyPhase(input({ aglFt: 30, vsFpm: -700, iasKt: 130 }), 'approach')).toBe('landing');
  });

  it('接地后高速滑跑是 rollout', () => {
    expect(classifyPhase(input({ onGround: true, aglFt: 0, iasKt: 100 }), 'landing')).toBe('rollout');
  });

  it('爬升刚结束、垂直速度还没回零时留在 climb', () => {
    expect(classifyPhase(input({ aglFt: 30000, vsFpm: 200 }), 'climb')).toBe('climb');
  });
});

describe('PhaseTracker', () => {
  it('单帧抖动不改阶段，持续到滞后窗口才切换', () => {
    const tracker = new PhaseTracker('cruise', 0);
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 0);
    expect(tracker.current).toBe('cruise');
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 2000);
    expect(tracker.current).toBe('descent');
  });

  it('抖动回原值会清掉候选', () => {
    const tracker = new PhaseTracker('cruise', 0);
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 0);
    tracker.update(input({ aglFt: 35000, vsFpm: 0 }), 500);
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 1000);
    // 候选重新计时，到 1000+1200 才切换
    expect(tracker.current).toBe('cruise');
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 2300);
    expect(tracker.current).toBe('descent');
  });

  it('接地与滑跑立即切换', () => {
    const tracker = new PhaseTracker('landing', 0);
    tracker.update(input({ onGround: true, aglFt: 0, iasKt: 110 }), 100);
    expect(tracker.current).toBe('rollout');
  });

  it('进入时刻跟着阶段走', () => {
    const tracker = new PhaseTracker('cruise', 0);
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 0);
    tracker.update(input({ aglFt: 35000, vsFpm: -600 }), 2000);
    expect(tracker.since).toBe(2000);
  });
});
