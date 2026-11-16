/** 包入口：默认导出 `WorldDefinition`，加载器按 `cortico.kind === 'world'` 认它。 */
import { MSFS_COPILOT } from './definition.ts';

export default MSFS_COPILOT;
export { MSFS_COPILOT };
export { MsfsCopilotWorld, MSFS_COPILOT_TOOL_DECLS } from './world.ts';
export { MSFS_COPILOT_DEFAULTS, MSFS_COPILOT_CONFIG_GROUP } from './config.ts';
export type { MsfsCopilotConfigSection } from './config.ts';
export { parseFrame, SIMVARS, bcd16ToInt, xpndrCode } from './telemetry.ts';
export type { TelemetryFrame } from './telemetry.ts';
export { PhaseTracker, classifyPhase, PHASE_LABELS } from './phase.ts';
export type { FlightPhase } from './phase.ts';
export { SimConnectProbe } from './probe/simconnect.ts';
export { locateSimConnectDll } from './probe/locate.ts';
