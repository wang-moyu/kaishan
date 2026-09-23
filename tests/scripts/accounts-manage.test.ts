import { describe, expect, it } from 'vitest';

import { parseArgs, sqlText } from '../../scripts/accounts/manage';

/**
 * 受控账号脚本的参数解析（P0-04）。
 *
 * 重点覆盖两个真实踩到的坑：
 * 1. `npm run accounts -- ...` 会把 `--account`、`--remote` 这类长参数当成 npm 自己的配置项吞掉，
 *    所以脚本必须支持位置参数（`create-user <账号>`）与环境变量形式的目标库选择；
 * 2. 被 npm 吞掉参数后剩下的裸 token（例如 `revoke-sessions nope2` 里的 nope2）必须报错，
 *    不能静默当成默认值执行。
 */
describe('受控账号脚本参数解析', () => {
  it('位置参数形式：账号可以直接跟在命令后面（npm run 传参的推荐写法）', () => {
    const options = parseArgs(['create-user', 'E2E-Controlled'], {});
    expect(options.command).toBe('create-user');
    expect(options.account).toBe('E2E-Controlled');
    expect(options.target).toBe('local');
    expect(options.confirmRemote).toBe(false);
  });

  it('flag 形式：--account X 与 --account=X 都接受（直接跑 tsx 时用）', () => {
    expect(parseArgs(['revoke-sessions', '--account', 'some-user'], {}).account).toBe('some-user');
    expect(parseArgs(['revoke-sessions', '--account=some-user'], {}).account).toBe('some-user');
  });

  it('目标库默认本地；只有显式 --remote / 环境变量才指向远程', () => {
    expect(parseArgs(['list-users'], {}).target).toBe('local');
    expect(parseArgs(['list-users', '--remote'], {}).target).toBe('remote');
    expect(parseArgs(['list-users'], { XIUXIAN_ACCOUNTS_TARGET: 'remote' }).target).toBe('remote');
  });

  it('远程必须显式确认：--confirm-remote 或 XIUXIAN_ACCOUNTS_CONFIRM_REMOTE=yes', () => {
    expect(parseArgs(['list-users', '--remote'], {}).confirmRemote).toBe(false);
    expect(parseArgs(['list-users', '--remote', '--confirm-remote'], {}).confirmRemote).toBe(true);
    expect(
      parseArgs(['list-users'], {
        XIUXIAN_ACCOUNTS_TARGET: 'remote',
        XIUXIAN_ACCOUNTS_CONFIRM_REMOTE: 'yes',
      }).confirmRemote,
    ).toBe(true);
  });

  it('create-user / revoke-sessions 缺少账号时直接报错，不落到默认值', () => {
    expect(() => parseArgs(['create-user'], {})).toThrow(/需要账号/u);
    expect(() => parseArgs(['revoke-sessions'], {})).toThrow(/需要账号/u);
  });

  it('未知参数与多余的位置参数都报错（防止 npm 吞参后被静默忽略）', () => {
    expect(() => parseArgs(['revoke-sessions', '--nope'], {})).toThrow(/无法识别的参数/u);
    expect(() => parseArgs(['revoke-sessions', 'a', 'b'], {})).toThrow(/多余的参数/u);
    // npm 吞掉 --account 后能把值留成裸 token：此时必须报错而不是当成账号
    expect(() => parseArgs(['list-users', 'leftover-token'], {})).toThrow(/多余的参数/u);
  });

  it('help 与未知命令', () => {
    expect(parseArgs([], {}).command).toBe('help');
    expect(parseArgs(['--help'], {}).command).toBe('help');
    expect(() => parseArgs(['delete-user', 'a'], {})).toThrow(/未知命令/u);
  });


  it('SQL 文本字面量转义单引号（脚本拼 SQL 的注入面）', () => {
    expect(sqlText('plain')).toBe("'plain'");
    expect(sqlText("o'brien")).toBe("'o''brien'");
    expect(sqlText("a''b")).toBe("'a''''b'");
  });
});
