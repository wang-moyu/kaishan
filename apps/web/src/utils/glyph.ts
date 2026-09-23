/**
 * 展示用的单字标记（圆形底 + 一个汉字），原先散在 SectScreen 里，天机录也要用同一套。
 */

const RESOURCE_GLYPHS: Record<string, string> = {
  spiritStone: '石',
  spiritualEnergy: '炁',
  herb: '药',
  ore: '矿',
};

/** 资源 id → 单字标记。 */
export function resourceGlyph(resourceId: string): string {
  return RESOURCE_GLYPHS[resourceId] ?? '灵';
}
