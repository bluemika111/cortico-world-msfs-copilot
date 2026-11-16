/**
 * 找 SimConnect.dll。
 *
 * 目标机器上只有游戏、没有 SDK 是常态，所以不能只认 SDK 的路径。顺序按命中率排：
 * 操作者显式指定 → 环境变量 → 游戏安装目录（Store 版在 WindowsApps，Steam 版在库目录）→ SDK → PATH。
 *
 * 返回 null 不是错误：调用方据此给出一条能照着做的提示，而不是抛异常。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

export interface LocateResult {
  /** 找到的 DLL 绝对路径；没找到时为 null。 */
  path: string | null;
  /** 试过的位置，供诊断输出。 */
  tried: string[];
}

/** SimConnect 运行时文件名。64 位游戏找的是这个。 */
const DLL_NAME = 'SimConnect.dll';

/** 环境变量：操作者可以用它绕过自动探测。 */
export const DLL_ENV = 'MSFS_SIMCONNECT_DLL';

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** WindowsApps 里按包名前缀找。列目录名不需要提升权限，进目录才需要。 */
function scanWindowsApps(): string[] {
  const root = process.env.ProgramFiles ?? 'C:\\Program Files';
  const apps = join(root, 'WindowsApps');
  if (!existsSync(apps)) return [];
  let entries: string[];
  try {
    entries = readdirSync(apps);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('Microsoft.FlightSimulator_')) continue;
    if (!entry.includes('_x64__')) continue;
    out.push(join(apps, entry, DLL_NAME));
  }
  return out;
}

/** Steam 版：先看默认库，再从 libraryfolders.vdf 里捞其它盘。 */
function scanSteam(): string[] {
  const out: string[] = [];
  const roots = [
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)'], 'Steam') : null,
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Steam') : null,
  ].filter((v): v is string => v !== null);

  for (const root of roots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) {
      try {
        const text = readFileSync(vdf, 'utf8');
        // "path"		"D:\\SteamLibrary"
        for (const m of text.matchAll(/"path"\s+"([^"]+)"/g)) {
          const lib = m[1].replace(/\\\\/g, '\\');
          out.push(join(lib, 'steamapps', 'common', 'MicrosoftFlightSimulator', DLL_NAME));
        }
      } catch {
        /* 读不了就只试默认库 */
      }
    }
    out.push(join(root, 'steamapps', 'common', 'MicrosoftFlightSimulator', DLL_NAME));
  }
  return out;
}

/** 常见但不在上面几类里的位置。 */
function scanLoose(): string[] {
  const out: string[] = [];
  if (process.env.LOCALAPPDATA) {
    out.push(join(process.env.LOCALAPPDATA, 'Packages', 'Microsoft.FlightSimulator_8wekyb3d8bbwe', 'LocalCache', DLL_NAME));
  }
  if (process.env.ProgramData) {
    out.push(join(process.env.ProgramData, 'Microsoft Flight Simulator', DLL_NAME));
  }
  for (const drive of ['C:', 'D:', 'E:', 'F:']) {
    out.push(join(`${drive}\\`, 'MSFS SDK', 'SimConnect SDK', 'lib', DLL_NAME));
    out.push(join(`${drive}\\`, 'Microsoft Flight Simulator', DLL_NAME));
  }
  return out;
}

/**
 * 按顺序找 DLL。
 *
 * @param configured 操作者在配置里填的路径，优先级最高。
 * @param searchPath 额外的 PATH 候选项，测试注入用。
 */
export function locateSimConnectDll(configured?: string, searchPath?: string[]): LocateResult {
  const tried: string[] = [];

  const candidates: string[] = [];
  const push = (p: string | undefined | null) => {
    if (p) candidates.push(p);
  };

  push(configured?.trim());
  push(process.env[DLL_ENV]?.trim());
  for (const p of scanWindowsApps()) push(p);
  for (const p of scanSteam()) push(p);
  for (const p of scanLoose()) push(p);
  for (const p of searchPath ?? []) push(p);
  if (process.env.PATH) {
    for (const dir of process.env.PATH.split(';')) {
      if (dir.trim()) push(join(dir.trim(), DLL_NAME));
    }
  }

  for (const candidate of candidates) {
    const normalized = candidate;
    tried.push(normalized);
    if (isFile(normalized)) return { path: normalized, tried };
  }
  return { path: null, tried };
}

/** DLL 所在目录；桥接进程用它 SetDllDirectory 再 DllImport。 */
export function dllDirectory(dllPath: string): string {
  return dirname(dllPath);
}
