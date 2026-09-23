import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AVATAR_FRAME_ASSET_DIR,
  AVATAR_FRAME_IDS,
  AVATAR_FRAME_OPTIONS,
  DEFAULT_AVATAR_FRAME_ID,
  avatarFrameOption,
  isAvatarFrameId,
  resolveAvatarFrameId,
} from '../../apps/web/src/utils/avatarFrames';

/**
 * 头像框白名单与回退规则（apps/web/src/utils/avatarFrames.ts）。
 *
 * 这里锁的是「只认固定 id」这条边界：接口与数据库都按白名单校验，
 * 前端不能因为拿到未知值就渲染任意 URL，图片加载失败也不能把占位/破图当成果。
 */
describe('头像框白名单', () => {
  it('正好是 classic + frame01–frame20 共 21 个固定 id', () => {
    expect(AVATAR_FRAME_IDS).toHaveLength(21);
    expect(AVATAR_FRAME_IDS[0]).toBe('classic');
    expect(AVATAR_FRAME_IDS.slice(1)).toEqual([
      'frame01',
      'frame02',
      'frame03',
      'frame04',
      'frame05',
      'frame06',
      'frame07',
      'frame08',
      'frame09',
      'frame10',
      'frame11',
      'frame12',
      'frame13',
      'frame14',
      'frame15',
      'frame16',
      'frame17',
      'frame18',
      'frame19',
      'frame20',
    ]);
    expect(DEFAULT_AVATAR_FRAME_ID).toBe('classic');
    expect(AVATAR_FRAME_IDS).toContain(DEFAULT_AVATAR_FRAME_ID);
  });

  it('选项与白名单一一对应，顺序一致', () => {
    expect(AVATAR_FRAME_OPTIONS.map((option) => option.id)).toEqual([...AVATAR_FRAME_IDS]);
  });

  it('只有 classic 没有图片，其余二十张都落在静态资源目录下', () => {
    for (const option of AVATAR_FRAME_OPTIONS) {
      if (option.id === 'classic') {
        expect(option.src).toBeNull();
        continue;
      }
      expect(option.src).toBe(`${AVATAR_FRAME_ASSET_DIR}/${option.id}.png`);
    }
    const sources = AVATAR_FRAME_OPTIONS.map((option) => option.src).filter(
      (src): src is string => src !== null,
    );
    expect(new Set(sources).size).toBe(sources.length);
  });

  it('标签非空且互不重复（选择器里能分辨每一个）', () => {
    const labels = AVATAR_FRAME_OPTIONS.map((option) => option.label);
    for (const label of labels) expect(label.trim()).not.toBe('');
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('头像框静态素材', () => {
  const assetDir = resolve('apps/web/public/avatar-frames');
  const expectedFiles = AVATAR_FRAME_IDS.filter((id) => id !== 'classic').map(
    (id) => `${id}.png`,
  );

  it('目录中恰好包含 frame01.png–frame20.png', () => {
    expect(readdirSync(assetDir).sort()).toEqual([...expectedFiles].sort());
  });

  it('二十张素材都是 256×256 的 8-bit RGBA PNG', () => {
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (const file of expectedFiles) {
      const bytes = readFileSync(resolve(assetDir, file));
      expect(bytes.subarray(0, 8), file).toEqual(pngSignature);
      expect(bytes.readUInt32BE(16), `${file} width`).toBe(256);
      expect(bytes.readUInt32BE(20), `${file} height`).toBe(256);
      expect(bytes[24], `${file} bit depth`).toBe(8);
      expect(bytes[25], `${file} PNG color type`).toBe(6);
    }
  });

  it('二十张素材互不相同（不存在复制同一张图充当多个样式）', () => {
    const digests = new Set(
      expectedFiles.map((file) =>
        createHash('sha256').update(readFileSync(resolve(assetDir, file))).digest('hex'),
      ),
    );
    expect(digests.size).toBe(expectedFiles.length);
  });
});

describe('isAvatarFrameId（只认白名单，拒绝任意 URL / 路径）', () => {
  it('接受白名单里的 21 个 id', () => {
    for (const id of AVATAR_FRAME_IDS) expect(isAvatarFrameId(id)).toBe(true);
  });

  it('拒绝 URL、路径、上传名、大小写变体与越界编号', () => {
    const rejected = [
      'https://evil.example/x.png',
      '//evil.example/x.png',
      '/avatar-frames/frame20.png',
      '../public/avatar-frames/frame01.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'frame21',
      'frame00',
      'frame1',
      'FRAME01',
      'Classic',
      'frame01.png',
      '',
      ' ',
      'frame01 ',
    ];
    for (const value of rejected) expect(isAvatarFrameId(value)).toBe(false);
    expect(isAvatarFrameId(null)).toBe(false);
    expect(isAvatarFrameId(undefined)).toBe(false);
    expect(isAvatarFrameId(1)).toBe(false);
    expect(isAvatarFrameId({ id: 'frame01' })).toBe(false);
  });
});

describe('回退规则（未知值 / 图片失败都回退 classic）', () => {
  it('未知值取到的是 classic 选项，不是 undefined', () => {
    expect(avatarFrameOption('frame99').id).toBe('classic');
    expect(avatarFrameOption(undefined).id).toBe('classic');
    expect(avatarFrameOption('frame01').id).toBe('frame01');
  });

  it('合法值原样保留，未知值回退 classic', () => {
    expect(resolveAvatarFrameId('frame07')).toBe('frame07');
    expect(resolveAvatarFrameId('classic')).toBe('classic');
    expect(resolveAvatarFrameId('frame07 ')).toBe('classic');
    expect(resolveAvatarFrameId(null)).toBe('classic');
    expect(resolveAvatarFrameId(undefined)).toBe('classic');
  });

  it('图片加载失败时回退 classic（素材没到位也不会渲染成破图）', () => {
    expect(resolveAvatarFrameId('frame03', true)).toBe('classic');
    expect(resolveAvatarFrameId('classic', true)).toBe('classic');
    expect(resolveAvatarFrameId('frame03', false)).toBe('frame03');
  });
});
