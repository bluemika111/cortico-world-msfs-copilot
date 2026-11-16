/**
 * 飞行阶段推断。
 *
 * 没有哪条 SimVar 直接告诉你「现在是巡航」，只能从高度、垂直速度、空速、起落架和
 * 地面状态拼出来。这里用带滞后的状态机：单帧抖动不改阶段，免得爬升中遇到一阵下沉
 * 就在爬升和巡航之间反复横跳。
 */
export type FlightPhase =
  | 'preflight'
  | 'taxi'
  | 'takeoff'
  | 'climb'
  | 'cruise'
  | 'descent'
  | 'approach'
  | 'landing'
  | 'rollout';

export interface PhaseInput {
  onGround: boolean;
  parked: boolean;
  aglFt: number;
  iasKt: number;
  vsFpm: number;
  gearDown: boolean;
}

export const PHASE_LABELS: Record<FlightPhase, { zh: string; en: string }> = {
  preflight: { zh: '停机', en: 'parked' },
  taxi: { zh: '滑行', en: 'taxi' },
  takeoff: { zh: '起飞滑跑', en: 'takeoff roll' },
  climb: { zh: '爬升', en: 'climb' },
  cruise: { zh: '巡航', en: 'cruise' },
  descent: { zh: '下降', en: 'descent' },
  approach: { zh: '进近', en: 'approach' },
  landing: { zh: '着陆', en: 'landing' },
  rollout: { zh: '着陆滑跑', en: 'rollout' },
};

/** 阶段切换要持续多久才认。接地与离地由事件判定，不靠这个。 */
const HOLD_MS = 1200;

/** 判定「在地面上」的离地高度。有些机模的 SIM ON GROUND 在接地瞬间会抖。 */
const GROUND_AGL_FT = 20;

export function classifyPhase(input: PhaseInput, current: FlightPhase): FlightPhase {
  const ground = input.onGround || input.aglFt < GROUND_AGL_FT;

  if (ground) {
    // 起飞滑跑：还在跑道上加速，没离地。
    if (current === 'takeoff' && input.iasKt > 40) return 'takeoff';
    // 刚落地：接地后高速滑跑到减速。
    if ((current === 'landing' || current === 'rollout') && input.iasKt > 40) return 'rollout';
    if (input.parked || input.iasKt < 3) return 'preflight';
    if (input.iasKt > 55 && input.vsFpm >= 0) return 'takeoff';
    return 'taxi';
  }

  // 空中：先看最低的一档，再看速度趋势。
  if (input.aglFt < 50) return 'landing';
  if (input.gearDown && input.aglFt < 3000 && input.vsFpm < -200 && input.iasKt < 250) {
    return 'approach';
  }
  if (input.vsFpm > 500) return 'climb';
  if (input.vsFpm < -500) return 'descent';
  // 爬升/下降刚结束时别急着说「巡航」：垂直速度回零有个过程。
  if (current === 'climb' && input.vsFpm > 100) return 'climb';
  if (current === 'descent' && input.vsFpm < -100) return 'descent';
  return 'cruise';
}

/**
 * 带滞后的阶段跟踪器。`update` 每帧调一次，返回当前认定的阶段。
 */
export class PhaseTracker {
  private phase: FlightPhase;
  private candidate: FlightPhase | null = null;
  private candidateSince = 0;
  private enteredAt: number;

  constructor(initial: FlightPhase = 'preflight', now = 0) {
    this.phase = initial;
    this.enteredAt = now;
  }

  get current(): FlightPhase {
    return this.phase;
  }

  /** 进入当前阶段的时刻。 */
  get since(): number {
    return this.enteredAt;
  }

  update(input: PhaseInput, now: number): FlightPhase {
    const next = classifyPhase(input, this.phase);
    if (next === this.phase) {
      this.candidate = null;
      return this.phase;
    }
    // 接地与离地是瞬时的，别让它们等滞后窗口。
    const immediate = next === 'rollout' || next === 'landing';
    if (this.candidate !== next) {
      this.candidate = next;
      this.candidateSince = now;
      if (immediate) {
        this.commit(next, now);
      }
      return this.phase;
    }
    if (immediate || now - this.candidateSince >= HOLD_MS) {
      this.commit(next, now);
    }
    return this.phase;
  }

  private commit(next: FlightPhase, now: number): void {
    this.phase = next;
    this.enteredAt = now;
    this.candidate = null;
  }
}
