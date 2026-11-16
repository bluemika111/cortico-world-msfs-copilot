/** 从定义里导出 describe.json。改了工具、事件或 ENV_PROMPT 之后重跑一次。 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MSFS_COPILOT } from '../src/definition.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'describe.json');

const describe = MSFS_COPILOT.describe;
if (!describe) throw new Error('MSFS_COPILOT 没有 describe，导不出 describe.json');

writeFileSync(target, `${JSON.stringify(describe, null, 2)}\n`, 'utf8');
console.log(`写了 ${target}`);
