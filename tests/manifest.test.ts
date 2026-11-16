import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MSFS_COPILOT } from '../src/definition.ts';
import { MSFS_COPILOT_CONFIG_GROUP, MSFS_COPILOT_DEFAULTS } from '../src/config.ts';
import { MSFS_COPILOT_TOOL_DECLS } from '../src/world.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('清单', () => {
  it('package.json 的 cortico 段完整', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      os?: string[];
      cortico?: { kind?: string; api?: number; describe?: string; locales?: Record<string, unknown> };
    };
    expect(pkg.cortico?.kind).toBe('world');
    expect(pkg.cortico?.api).toBe(6);
    expect(pkg.cortico?.describe).toBe('describe.json');
    expect(pkg.cortico?.locales?.zh).toBeDefined();
    expect(pkg.cortico?.locales?.en).toBeDefined();
    // SimConnect 与 csc 都是 Windows 专属，别的平台装不了。
    expect(pkg.os).toEqual(['win32']);
  });

  it('describe.json 与定义同步', () => {
    const saved = JSON.parse(readFileSync(join(root, 'describe.json'), 'utf8'));
    const live = JSON.parse(JSON.stringify(MSFS_COPILOT.describe));
    expect(saved).toEqual(live);
  });

  it('每个工具都有中英摘要', () => {
    const tools = MSFS_COPILOT.describe?.tools ?? [];
    expect(tools.length).toBe(MSFS_COPILOT_TOOL_DECLS.length);
    for (const tool of tools) {
      const summary = tool.summary;
      expect(summary).toBeDefined();
      if (typeof summary === 'string') {
        expect(summary.length).toBeGreaterThan(0);
      } else {
        expect(summary?.zh?.length).toBeGreaterThan(0);
        expect(summary?.en?.length).toBeGreaterThan(0);
      }
    }
  });

  it('工具名唯一，且都带标签', () => {
    const names = MSFS_COPILOT_TOOL_DECLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of MSFS_COPILOT_TOOL_DECLS) {
      expect(tool.tags.length).toBeGreaterThan(0);
    }
  });

  it('写操作工具都标 act', () => {
    for (const name of ['msfs_radio', 'msfs_switch']) {
      const tool = MSFS_COPILOT_TOOL_DECLS.find((t) => t.name === name);
      expect(tool?.tags).toContain('act');
    }
  });

  it('读工具都标 read', () => {
    for (const name of ['msfs_status', 'msfs_ap', 'msfs_nav', 'msfs_wx', 'msfs_alerts']) {
      const tool = MSFS_COPILOT_TOOL_DECLS.find((t) => t.name === name);
      expect(tool?.tags).toContain('read');
    }
  });

  it('事件都有中英描述', () => {
    const events = MSFS_COPILOT.describe?.events ?? [];
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.type.startsWith('msfs.')).toBe(true);
      const description = event.description;
      if (typeof description === 'string') {
        expect(description.length).toBeGreaterThan(0);
      } else {
        expect(description.zh.length).toBeGreaterThan(0);
        expect(description.en.length).toBeGreaterThan(0);
      }
    }
  });

  it('配置组的键与默认值一一对应', () => {
    const keys = Object.keys(MSFS_COPILOT_CONFIG_GROUP.schema.properties);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key.startsWith('worlds.msfs-copilot.')).toBe(true);
      const leaf = key.slice('worlds.msfs-copilot.'.length);
      expect(Object.prototype.hasOwnProperty.call(MSFS_COPILOT_DEFAULTS, leaf)).toBe(true);
    }
    // 反过来也查一遍，免得默认值里加了项却没写进 WebUI。
    // enabled 由框架管，不进配置组。
    for (const leaf of Object.keys(MSFS_COPILOT_DEFAULTS)) {
      if (leaf === 'enabled') continue;
      expect(keys).toContain(`worlds.msfs-copilot.${leaf}`);
    }
  });

  it('写权限默认全关', () => {
    expect(MSFS_COPILOT_DEFAULTS.writeEnabled).toBe(false);
  });
});
