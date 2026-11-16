import type { ConfigGroup } from 'cortico/core/types.ts';

/**
 * config.json 的 worlds.msfs-copilot 段。键扁平：WebUI 的配置接口写不了列表和对象。
 *
 * 写权限默认全关。副驾能读一切，但动飞机这件事要操作者一项一项打开。
 */
export interface MsfsCopilotConfigSection {
  enabled: boolean;
  /** 读一次遥测的间隔。 */
  pollMs: number;
  /** 报数用公制（米/公里每小时/百帕），默认航空单位。 */
  metric: boolean;
  /** 手动指定 SimConnect.dll；留空则自动探测。改后需重启。 */
  simconnectDll: string;

  // —— 主动播报的开关 ——
  /** 离地。 */
  takeoff: boolean;
  /** 到达巡航。 */
  cruise: boolean;
  /** 开始下降。 */
  descent: boolean;
  /** 进近建立：截获下滑道。 */
  approach: boolean;
  /** 接地。 */
  touchdown: boolean;
  /** 失速警告。 */
  stall: boolean;
  /** 超速警告。 */
  overspeed: boolean;
  /** 高度偏离选定高度。 */
  altitudeAlert: boolean;

  // —— 判定阈值 ——
  /** 离地高度高于它才算得上巡航，避免低空平飞被当成巡航。 */
  cruiseAltFt: number;
  /** 偏离选定高度多少英尺才告警。 */
  altitudeAlertFt: number;
  /** 进近判定：截获下滑道后多少秒内不重复报。 */
  approachCooldownSec: number;

  // —— 写权限 ——
  /** 写权限总闸。关着时一律只读。 */
  writeEnabled: boolean;
  /** 灯光。 */
  writeLights: boolean;
  /** 起落架收放。 */
  writeGear: boolean;
  /** COM/NAV 频率。 */
  writeRadio: boolean;
  /** 气压基准。 */
  writeBaro: boolean;
  /** 应答机码。 */
  writeXpndr: boolean;
  /** 自动驾驶：接通/断开、模式开关、目标高度/航向/速度/垂直速度。 */
  writeAp: boolean;
}

export const MSFS_COPILOT_DEFAULTS: MsfsCopilotConfigSection = {
  enabled: false,
  pollMs: 500,
  metric: false,
  simconnectDll: '',

  takeoff: true,
  cruise: true,
  descent: true,
  approach: true,
  touchdown: true,
  stall: true,
  overspeed: true,
  altitudeAlert: true,

  cruiseAltFt: 3000,
  altitudeAlertFt: 300,
  approachCooldownSec: 90,

  writeEnabled: false,
  writeLights: true,
  writeGear: true,
  writeRadio: true,
  writeBaro: true,
  writeXpndr: true,
  // 自动驾驶默认关：它能真的把飞机带走，不该跟灯光一个待遇。
  writeAp: false,
};

export const MSFS_COPILOT_CONFIG_GROUP: ConfigGroup = {
  id: 'world:msfs-copilot',
  owner: 'world:msfs-copilot',
  schema: {
    type: 'object',
    title: '飞行副驾',
    properties: {
      'worlds.msfs-copilot.pollMs': {
        type: 'integer',
        title: '遥测间隔',
        description: '隔多少毫秒读一次 SimConnect 数据。',
        minimum: 100,
        maximum: 5000,
        'x-suffix': '毫秒',
        'x-hot': true,
      },
      'worlds.msfs-copilot.metric': {
        type: 'boolean',
        title: '公制单位',
        description: '打开后用米、公里每小时、百帕报数；默认英尺、节、海里、英寸汞柱。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.simconnectDll': {
        type: 'string',
        title: 'SimConnect.dll',
        description: '留空则自动在游戏安装目录、Steam 库和 SDK 里找。填了就用填的那个。',
        'x-path': { kind: 'file', extensions: ['dll'] },
        'x-hot': false,
      },

      'worlds.msfs-copilot.takeoff': {
        type: 'boolean',
        title: '离地',
        description: '飞机离地时开口，带离地速度和抬轮姿态。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.cruise': {
        type: 'boolean',
        title: '到达巡航',
        description: '爬升结束、垂直速度回零时开口，带巡航高度和马赫。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.descent': {
        type: 'boolean',
        title: '开始下降',
        description: '垂直速度持续转负时开口，带当前高度和下降率。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.approach': {
        type: 'boolean',
        title: '进近建立',
        description: '截获下滑道时开口，带距离、高度和航向道偏差。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.touchdown': {
        type: 'boolean',
        title: '接地',
        description: '接地时开口，带下沉率、俯仰、坡度和接地航向。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.stall': {
        type: 'boolean',
        title: '失速警告',
        description: '失速警告响时开口，最高优先级。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.overspeed': {
        type: 'boolean',
        title: '超速警告',
        description: '超速警告响时开口，带当前马赫和空速。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.altitudeAlert': {
        type: 'boolean',
        title: '高度偏离',
        description: '偏离自动驾驶选定高度超过阈值时开口。',
        'x-hot': true,
      },

      'worlds.msfs-copilot.cruiseAltFt': {
        type: 'integer',
        title: '巡航判定高度',
        description: '离地高于这个高度、垂直速度平稳才算巡航。',
        minimum: 500,
        maximum: 20000,
        'x-suffix': '英尺',
        'x-hot': true,
      },
      'worlds.msfs-copilot.altitudeAlertFt': {
        type: 'integer',
        title: '高度偏离阈值',
        description: '偏离选定高度多少英尺才告警。',
        minimum: 50,
        maximum: 2000,
        'x-suffix': '英尺',
        'x-hot': true,
      },
      'worlds.msfs-copilot.approachCooldownSec': {
        type: 'integer',
        title: '进近提醒冷却',
        description: '同一次进近里隔多少秒才会再报一次。',
        minimum: 10,
        maximum: 600,
        'x-suffix': '秒',
        'x-hot': true,
      },

      'worlds.msfs-copilot.writeEnabled': {
        type: 'boolean',
        title: '允许副驾动飞机',
        description: '总闸。关着时副驾只读，任何操作请求都会被拒绝。',
        'x-warning': true,
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeLights': {
        type: 'boolean',
        title: '灯光',
        description: '着陆灯、航行灯、频闪、滑行灯、防撞灯。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeGear': {
        type: 'boolean',
        title: '起落架',
        description: '收放起落架。空中收轮、进近放轮是两回事，副驾会照做但会先说明当前高度。',
        'x-warning': true,
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeRadio': {
        type: 'boolean',
        title: 'COM / NAV 频率',
        description: '改 COM1/2 和 NAV1/2 的频率。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeBaro': {
        type: 'boolean',
        title: '气压基准',
        description: '调高度表拨正值。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeXpndr': {
        type: 'boolean',
        title: '应答机',
        description: '改应答机码。',
        'x-hot': true,
      },
      'worlds.msfs-copilot.writeAp': {
        type: 'boolean',
        title: '自动驾驶',
        description: '接通/断开自动驾驶、开关航向与高度保持、设目标高度/航向/速度/垂直速度。这一项能真的把飞机带走，默认关。',
        'x-warning': true,
        'x-hot': true,
      },
    },
  },
};
