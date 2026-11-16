/**
 * 编译并缓存 SimConnect 桥接 exe。
 *
 * 用 Windows 自带的 .NET Framework csc.exe 现场编译，包里不预置二进制：
 * 包体积小，也不会被当成捆绑可执行文件；编译一次之后按 mtime 复用。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 编译产物文件名。放在 dataDir 下，不进包目录。 */
export const BRIDGE_EXE = 'msfs-bridge.exe';

export interface BuildResult {
  exePath: string | null;
  /** 这次是否真的调用了编译器。 */
  compiled: boolean;
  error?: string;
}

function findCsc(): string | null {
  const windir = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows';
  const candidates = [
    join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 确保桥接 exe 存在且不比源码旧。
 *
 * @param srcPath SimConnectBridge.cs 的绝对路径
 * @param outDir 产物目录（World 的 dataDir）
 */
export function ensureBridge(srcPath: string, outDir: string): BuildResult {
  const exePath = join(outDir, BRIDGE_EXE);

  if (existsSync(exePath) && mtime(exePath) >= mtime(srcPath)) {
    return { exePath, compiled: false };
  }

  const csc = findCsc();
  if (!csc) {
    return {
      exePath: null,
      compiled: false,
      error: '找不到 .NET Framework 编译器 csc.exe（%WINDIR%\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe）',
    };
  }

  try {
    mkdirSync(outDir, { recursive: true });
  } catch (err) {
    return { exePath: null, compiled: false, error: `创建桥接产物目录失败：${(err as Error).message}` };
  }

  const res = spawnSync(
    csc,
    ['/nologo', '/codepage:65001', '/target:exe', '/optimize+', `/out:${exePath}`, srcPath],
    { encoding: 'utf8', timeout: 60_000 },
  );

  if (res.error) {
    return { exePath: null, compiled: false, error: `调用 csc 失败：${res.error.message}` };
  }
  if (res.status !== 0 || !existsSync(exePath)) {
    const detail = (res.stdout ?? '').trim() || (res.stderr ?? '').trim() || `退出码 ${res.status}`;
    return { exePath: null, compiled: false, error: `编译桥接失败：${detail}` };
  }
  return { exePath, compiled: true };
}
