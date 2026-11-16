/** 假桥接：不出进程，只把 World 关心的三件事（数据帧、系统事件、关闭）暴露成方法。 */
import type {
  ProbeHandlers,
  ProbeLike,
  SimVarSpec,
} from '../../src/probe/simconnect.ts';

export class FakeProbe implements ProbeLike {
  isOpen = false;
  isRunning = false;
  handlers: ProbeHandlers | null = null;
  /** 发出去的事件，按顺序。 */
  sent: Array<{ name: string; data: number }> = [];
  defined: Array<{ id: number; vars: readonly SimVarSpec[] }> = [];
  requested: Array<{ id: number; period: string; interval: number }> = [];
  subscribed: Array<{ id: number; name: string }> = [];
  stopped = false;

  async start(handlers: ProbeHandlers): Promise<void> {
    this.handlers = handlers;
    this.isOpen = true;
    this.isRunning = true;
  }

  async define(id: number, vars: readonly SimVarSpec[]): Promise<void> {
    this.defined.push({ id, vars });
  }

  async request(id: number, period: 'second' | 'frame' = 'second', interval = 1): Promise<void> {
    this.requested.push({ id, period, interval });
  }

  async subscribe(id: number, systemEvent: string): Promise<void> {
    this.subscribed.push({ id, name: systemEvent });
  }

  async sendEvent(name: string, data = 0): Promise<void> {
    this.sent.push({ name, data });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.isOpen = false;
    this.isRunning = false;
  }

  // —— 测试驱动 ——

  /** 推进一帧。 */
  frame(values: Array<number | string | null>): void {
    this.handlers?.onData?.(1, values);
  }

  /** 触发系统事件。 */
  systemEvent(name: string, data: number): void {
    this.handlers?.onEvent?.(name, data);
  }

  /** 模拟桥接关闭。 */
  close(): void {
    this.handlers?.onClosed?.();
  }

  /** 模拟运行期错误。 */
  fail(message: string): void {
    this.handlers?.onError?.(message);
  }
}
