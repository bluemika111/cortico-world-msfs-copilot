/**
 * 桥接进程的生命周期与协议。
 *
 * 协议是行式的：stdin 每行一条 tab 分隔命令，stdout 每行一个 JSON。桥接 exe 的源码见
 * `bridge/SimConnectBridge.cs`，那边的文件头有完整命令与消息表。
 *
 * 这里只做三件事：拉起进程、把命令和响应配对、把主动推送的数据交给上层。
 * 飞行逻辑一律不进来。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** 一个 SimVar 的读法。字符串变量在数据块里占 256 字节，其余是 float64。 */
export interface SimVarSpec {
  name: string;
  unit: string;
  type: 'f64' | 'str';
}

export type SimConnectMessage =
  | { type: 'opened' }
  /** errors 非空表示有变量名或单位写错；桥接会一次报全，不中断。 */
  | { type: 'defined'; id: number; errors?: string[] }
  | { type: 'requested'; id: number }
  | { type: 'subscribed'; id: number }
  | { type: 'sent'; name: string }
  | { type: 'data'; id: number; values: Array<number | string | null> }
  | { type: 'event'; id: number; name: string; data: number }
  | { type: 'error'; message: string }
  | { type: 'quit' }
  | { type: 'closed' };

export type DataHandler = (id: number, values: Array<number | string | null>) => void;
export type EventHandler = (name: string, data: number) => void;

export interface ProbeHandlers {
  onData?: DataHandler;
  onEvent?: EventHandler;
  onError?: (message: string) => void;
  onQuit?: () => void;
  onClosed?: () => void;
}

export interface ProbeOptions {
  /** 桥接 exe 的绝对路径。 */
  exePath: string;
  /** SimConnect.dll 的绝对路径；桥接会先 SetDllDirectory 再 DllImport。 */
  dllPath: string;
  /** 单条命令的等待上限。 */
  timeoutMs?: number;
}

/**
 * World 只需要这几项能力。测试拿假实现替换掉真进程，飞行逻辑照样跑。
 */
export interface ProbeLike {
  readonly isOpen: boolean;
  readonly isRunning: boolean;
  start(handlers: ProbeHandlers): Promise<void>;
  define(id: number, vars: readonly SimVarSpec[]): Promise<void>;
  request(id: number, period?: 'second' | 'frame', interval?: number): Promise<void>;
  subscribe(id: number, systemEvent: string): Promise<void>;
  sendEvent(name: string, data?: number): Promise<void>;
  stop(): Promise<void>;
}

/** 一条命令。字段用 tab 拼，避免 JSON 解析进 C# 侧。 */
const TAB = '\t';

export class SimConnectProbe {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private handlers: ProbeHandlers = {};
  private readonly timeoutMs: number;
  /** 等待响应的命令，按发出顺序配对。 */
  private readonly pending: Array<{
    kinds: readonly string[];
    resolve: (msg: SimConnectMessage) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  private state: 'idle' | 'starting' | 'open' | 'closed' = 'idle';

  constructor(private readonly opts: ProbeOptions) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
  }

  get isOpen(): boolean {
    return this.state === 'open';
  }

  get isRunning(): boolean {
    return this.child !== null && this.state !== 'closed';
  }

  /**
   * 拉起桥接并等它连上模拟器。
   *
   * 连不上时抛出的错误已经是给人看的话：DLL 缺失、游戏没开、或者 SimConnect 返回码。
   */
  async start(handlers: ProbeHandlers): Promise<void> {
    if (this.child) throw new Error('桥接进程已在运行');
    this.handlers = handlers;
    this.state = 'starting';
    this.buffer = '';

    const child = spawn(this.opts.exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.onStdout(chunk));
    // 桥接把诊断写进 stdout 的 JSON；stderr 只在进程崩掉时才有内容。
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (text) this.handlers.onError?.(text);
    });
    child.on('exit', () => {
      this.state = 'closed';
      const error = new Error('桥接进程已退出');
      for (const entry of this.pending.splice(0)) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      this.handlers.onClosed?.();
    });
    child.on('error', (err) => {
      this.state = 'closed';
      for (const entry of this.pending.splice(0)) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
    });

    await this.command(`OPEN${TAB}${this.opts.dllPath}`, ['opened']);
    this.state = 'open';
  }

  /** 声明一组变量。id 同时用作 defineId 和 requestId。 */
  async define(id: number, vars: readonly SimVarSpec[]): Promise<void> {
    const fields: string[] = [`DEFINE${TAB}${id}`];
    for (const v of vars) fields.push(v.name, v.unit, v.type);
    const msg = await this.command(fields.join(TAB), ['defined']);
    // 名字或单位写错时 AddToDataDefinition 会返回非零；这里把清单抛出去，
    // 而不是等到数据全零才让人猜是哪一条。
    if (msg.type === 'defined' && msg.errors?.length) {
      throw new Error(`有 ${msg.errors.length} 个 SimVar 定义失败：${msg.errors.join('；')}`);
    }
  }

  async request(id: number, period: 'second' | 'frame' = 'second', interval = 1): Promise<void> {
    await this.command(`REQUEST${TAB}${id}${TAB}${period}${TAB}${interval}`, ['requested']);
  }

  async subscribe(id: number, systemEvent: string): Promise<void> {
    await this.command(`SUBSCRIBE${TAB}${id}${TAB}${systemEvent}`, ['subscribed']);
  }

  /** 发一个 SimConnect 事件。没开放的操作不应该走到这里，拦在上层。 */
  async sendEvent(name: string, data = 0): Promise<void> {
    await this.command(`EVENT${TAB}${name}${TAB}${data}`, ['sent']);
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    try {
      child.stdin.write(`CLOSE\n`);
    } catch {
      /* 进程可能已经没了 */
    }
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* 已经退出 */
        }
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
    this.state = 'closed';
  }

  private command(line: string, kinds: readonly string[]): Promise<SimConnectMessage> {
    const child = this.child;
    if (!child) return Promise.reject(new Error('桥接进程没有启动'));
    return new Promise<SimConnectMessage>((resolve, reject) => {
      const entry = {
        kinds,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.pending.indexOf(entry);
          if (index >= 0) this.pending.splice(index, 1);
          reject(new Error(`等待 ${kinds.join('/')} 超时（${this.timeoutMs} 毫秒）`));
        }, this.timeoutMs),
      };
      entry.timer.unref?.();
      this.pending.push(entry);
      try {
        child.stdin.write(`${line}\n`);
      } catch (err) {
        const index = this.pending.indexOf(entry);
        if (index >= 0) this.pending.splice(index, 1);
        clearTimeout(entry.timer);
        reject(err as Error);
      }
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let msg: SimConnectMessage;
      try {
        msg = JSON.parse(line) as SimConnectMessage;
      } catch {
        this.handlers.onError?.(`桥接输出了无法解析的一行：${line.slice(0, 200)}`);
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: SimConnectMessage): void {
    switch (msg.type) {
      case 'data':
        this.handlers.onData?.(msg.id, msg.values);
        return;
      case 'event':
        this.handlers.onEvent?.(msg.name, msg.data);
        return;
      case 'quit':
        this.state = 'closed';
        this.handlers.onQuit?.();
        return;
      case 'closed':
        this.state = 'closed';
        this.handlers.onClosed?.();
        return;
      case 'error': {
        // 挂在某条命令上的错误先交还给它；没人等就是运行期异常。
        const entry = this.pending.shift();
        if (entry) {
          clearTimeout(entry.timer);
          entry.reject(new Error(msg.message));
        } else {
          this.handlers.onError?.(msg.message);
        }
        return;
      }
      default: {
        const entry = this.pending.shift();
        if (entry) {
          clearTimeout(entry.timer);
          entry.resolve(msg);
        }
        return;
      }
    }
  }
}
