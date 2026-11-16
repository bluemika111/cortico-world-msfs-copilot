import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { MSFS_COPILOT_DEFAULTS, type MsfsCopilotConfigSection } from './config.ts';
import { MSFS_COPILOT_TOOL_DECLS, MsfsCopilotWorld } from './world.ts';

export const MSFS_COPILOT: WorldDefinition<MsfsCopilotConfigSection> = {
  id: 'msfs-copilot',
  label: 'Flight Copilot',
  defaults: () => ({ ...MSFS_COPILOT_DEFAULTS }),
  create: (ctx) =>
    new MsfsCopilotWorld({
      cfg: ctx.cfg,
      timezone: ctx.timezone,
      dataDir: ctx.dataDir,
    }),
  // 只在 Windows 上能跑：SimConnect 是 Windows 原生库，桥接用 .NET Framework 的 csc 编译。
  describe: {
    tools: describeTools(MSFS_COPILOT_TOOL_DECLS, {
      msfs_status: {
        zh: '报出此刻的阶段、高度、空速、马赫、垂直速度、姿态、航向和地面状态。',
        en: 'Reports phase, altitude, airspeed, mach, vertical speed, attitude, heading and ground state right now.',
      },
      msfs_ap: {
        zh: '报出自动驾驶的接通状态、当前模式，以及选定的高度、航向、速度和垂直速度。',
        en: 'Reports autopilot engagement, active modes and the selected altitude, heading, speed and vertical speed.',
      },
      msfs_nav: {
        zh: '报出 COM/NAV 频率、应答机、下滑道与航向道偏差、DME 距离和下一个航路点。',
        en: 'Reports COM/NAV frequencies, transponder, glideslope and localizer deviation, DME and the next waypoint.',
      },
      msfs_wx: {
        zh: '报出风、外界温度、气压基准、能见度和降水。',
        en: 'Reports wind, outside temperature, altimeter setting, visibility and precipitation.',
      },
      msfs_alerts: {
        zh: '报出此刻哪些告警亮着：失速、超速、结冰、高度偏离和起落架状态。',
        en: 'Reports which warnings are active: stall, overspeed, icing, altitude deviation and gear state.',
      },
      msfs_radio: {
        zh: '设 COM/NAV 频率、应答机码或气压基准；操作者没开放的那一项会明确拒绝。',
        en: 'Sets COM/NAV frequency, transponder code or altimeter setting; refuses when the operator has not enabled it.',
      },
      msfs_switch: {
        zh: '开关灯光或收放起落架；操作者没开放的那一项会明确拒绝。',
        en: 'Flips lights or raises/lowers the gear; refuses when the operator has not enabled it.',
      },
      msfs_ap_set: {
        zh: '改自动驾驶：接通/断开、开关航向/高度/NAV/速度/垂直速度保持、自动油门预位，设目标高度/航向/速度/垂直速度；没开放权限时明确拒绝。',
        en: 'Changes the autopilot: engage/disengage, heading/altitude/nav/speed/vertical-speed hold, autothrottle arm, and target altitude/heading/speed/vertical speed; refuses when not enabled.',
      },
    }),
    events: [
      {
        type: 'msfs.connected',
        description: {
          zh: '连上 SimConnect 了，正文带机型与当前阶段。',
          en: 'SimConnect is connected; the text carries the aircraft title and current phase.',
        },
      },
      {
        type: 'msfs.disconnected',
        description: {
          zh: '和模拟器的连接断了，正文带原因。',
          en: 'The link to the simulator dropped; the text carries the reason.',
        },
      },
      {
        type: 'msfs.takeoff',
        description: {
          zh: '飞机离地，正文带离地速度、抬轮姿态和航向。',
          en: 'The aircraft lifted off; the text carries liftoff speed, rotation attitude and heading.',
        },
      },
      {
        type: 'msfs.cruise',
        description: {
          zh: '爬升结束进入巡航，正文带巡航高度、马赫和空速。',
          en: 'Climb ended and cruise began; the text carries cruise altitude, mach and airspeed.',
        },
      },
      {
        type: 'msfs.descent',
        description: {
          zh: '开始下降，正文带当前高度、下降率和空速。',
          en: 'Descent began; the text carries current altitude, descent rate and airspeed.',
        },
      },
      {
        type: 'msfs.approach',
        description: {
          zh: '截获下滑道，正文带距离、高度和航向道偏差。',
          en: 'The glideslope was captured; the text carries distance, altitude and localizer deviation.',
        },
      },
      {
        type: 'msfs.touchdown',
        description: {
          zh: '接地，正文带下沉率、接地俯仰、坡度和航向。',
          en: 'Touchdown; the text carries sink rate, touchdown pitch, bank and heading.',
        },
      },
      {
        type: 'msfs.stall',
        description: {
          zh: '失速警告响，正文带空速、俯仰和离地高度。',
          en: 'The stall warning fired; the text carries airspeed, pitch and height above ground.',
        },
      },
      {
        type: 'msfs.overspeed',
        description: {
          zh: '超速警告响，正文带马赫、空速和高度。',
          en: 'The overspeed warning fired; the text carries mach, airspeed and altitude.',
        },
      },
      {
        type: 'msfs.altitude_alert',
        description: {
          zh: '偏离自动驾驶选定高度，正文带选定值、实际值和偏差。',
          en: 'The aircraft drifted from the selected altitude; the text carries selected, actual and deviation.',
        },
      },
    ],
  },
};
