import { describe, expect, it } from 'vitest';

import * as contracts from '@xiuxian/contracts';
import * as gameConfig from '@xiuxian/game-config';
import * as gameCore from '@xiuxian/game-core';

const workspacePackages = [
  { name: '@xiuxian/contracts', module: contracts },
  { name: '@xiuxian/game-core', module: gameCore },
  { name: '@xiuxian/game-config', module: gameConfig },
];

describe('工作区包导入（P0-01 冒烟）', () => {
  it('三个 packages 子包均可被解析，并导出自身包名', () => {
    for (const pkg of workspacePackages) {
      expect(pkg.module.PACKAGE_NAME).toBe(pkg.name);
    }
  });
});
