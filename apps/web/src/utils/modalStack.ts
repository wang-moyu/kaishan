/**
 * 弹窗层级栈（模块级单例）。
 *
 * 注意：写在 `<script setup>` 里的「模块级」变量其实是每个组件实例一份，
 * 所以叠加弹窗需要的共享状态必须放在独立模块里：
 * - 判断「谁在最上面」，让 Esc 只关最上层那一个；
 * - 计数，让页面滚动只在最后一个弹窗关闭时解锁。
 */

const layers: object[] = [];

/** 打开一层弹窗（token 用每次实例化创建的空对象即可）。 */
export function pushModalLayer(token: object): void {
  layers.push(token);
}

/** 关闭一层弹窗。 */
export function popModalLayer(token: object): void {
  const index = layers.indexOf(token);
  if (index >= 0) {
    layers.splice(index, 1);
  }
}

/** 该 token 是否就是当前最上层的弹窗。 */
export function isTopModalLayer(token: object): boolean {
  return layers.length > 0 && layers[layers.length - 1] === token;
}

/** 当前打开的弹窗层数。 */
export function modalLayerCount(): number {
  return layers.length;
}
