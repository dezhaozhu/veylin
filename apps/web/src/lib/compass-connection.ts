/**
 * Compass 连接在**应用级**,不在项目里。
 *
 * 用户指出的:添加服务器(连到哪)和授权(以谁的身份)是两件事,但都属于这个
 * 应用,不属于某一个项目。放在项目页上,等于每建一个项目就把同一件全局的事
 * 再问一遍;而项目标题下面本来就已经写着它用的数据源了。
 *
 * 这里是那一行的**措辞**:它在各种状态下该说什么。单独抽出来是为了能被测到 ——
 * 这类文案最容易在改动中悄悄退化成"连接失败"这种什么也没说的话。
 */
import { projectSourceLabel } from '@veylin/shared';

export type WhoAmI = {
  configured: boolean;
  username?: string | null;
  sources?: string[];
  error?: string;
};

export type CompassRowState = {
  /** 行下面那句话。 */
  subtitle: string;
  /** 这一行现在该给什么动作。 */
  action: 'connect' | 'reconnect' | 'manage';
};

export function describeCompassRow(who: WhoAmI | null): CompassRowState {
  if (!who || !who.configured) {
    return {
      subtitle: '还没连接 —— 连上之后,你在 Compass 有权限的数据源会出现在这里',
      action: 'connect',
    };
  }
  if (who.error) {
    // 连不上是**状态**,不是"没配置" —— 让人重连,而不是让他从头再连一遍。
    return { subtitle: who.error, action: 'reconnect' };
  }
  const who_ = who.username ?? '未知身份';
  if (!who.sources?.length) {
    // 这一种最该被说清楚:连上了、但什么也看不到。不说的话,人会以为是产品坏了。
    return {
      subtitle: `以 ${who_} 的身份连接 —— 但 Compass 没有给你任何数据源,你会看到空白`,
      action: 'manage',
    };
  }
  return {
    // 走显示名:个人工作区的 id 带一段防撞车的指纹,那是给机器看的。
    subtitle: `以 ${who_} 的身份连接 · 数据源:${who.sources.map(projectSourceLabel).join('、')}`,
    action: 'manage',
  };
}

/** 行上的按钮该写什么。 */
export function compassActionLabel(action: CompassRowState['action']): string {
  return action === 'connect' ? '连接' : action === 'reconnect' ? '重新连接' : '管理';
}
