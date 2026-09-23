/**
 * 展示格式化：接口里的资源/金额是最小单位十进制字符串（1 展示单位 = 1000 最小单位）。
 * 前端只做展示转换，绝不把格式化结果回传参与计算。
 */

const UNITS_PER_DISPLAY = 1000;

export function toDisplayUnits(minUnits: string | number): number {
  return Number(minUnits) / UNITS_PER_DISPLAY;
}

/** 资源数值：整数显示，非整数保留 1 位小数。 */
export function formatAmount(minUnits: string | number): string {
  const value = toDisplayUnits(minUnits);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 产量：每小时展示值。 */
export function formatRate(minUnitsPerHour: string | number): string {
  const value = toDisplayUnits(minUnitsPerHour);
  if (value === 0) {
    return '0';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 倍率显示：基点 → 百分比。 */
export function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(0)}%`;
}

/** 时间：本地时区的简短显示。 */
export function formatTime(iso: string | null): string {
  if (iso === null) {
    return '-';
  }
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}
