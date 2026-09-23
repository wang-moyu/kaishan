/**
 * OpenRouter Decisions API 通用客户端（docs/V6-秘境探索重构.md 第 3 节）。
 *
 * 解耦：本文件不 import 任何游戏模块、不读配置、不碰数据库，只负责
 * 「一段上下文文本 + 若干结构化问题 → 结构化答案」这一次网络调用。
 * 因此它不只服务秘境探索，破境概率、随机事件、NPC 行为等场景都可以复用同一个 decide()。
 *
 * 调用方负责：
 *   - 取 key（`env.OPENROUTER_API_KEY`，wrangler secret 注入）；
 *   - 把游戏状态压成 state 文本、把判定规则写成 questions；
 *   - 失败时降级 —— 本模块只抛 `Error`（HTTP 失败 / 超时 / 网络错误 / 响应残缺），
 *     绝不自己「猜一个」结果，免得把随机兜底逻辑藏进基础设施层。
 */

/** 单次请求的默认超时（毫秒）：判定只是锦上添花，不能让玩家卡在等模型上。 */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Decisions API 端点（与模型 id 一起导出，便于调用方记录 / 断言）。 */
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

/** 默认决策模型 id。 */
export const DEFAULT_MODEL = '~typesafe/jev-latest';

/** noul 题型：返回 0~1 的概率。 */
export interface NoulQuestion {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
}

/** choice 题型：返回选中项 id + 各项概率分布。 */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** score 题型：返回 0~1 的分数（criteria 是从低到高的锚点描述）。 */
export interface ScoreQuestion {
  type: 'score';
  instructions: string;
  criteria: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** noul 题的回答。 */
export interface NoulAnswer {
  noul: number;
}

/** choice 题的回答：choice 是 criteria 的键之一。 */
export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
}

/** score 题的回答。 */
export interface ScoreAnswer {
  score: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** 请求体（问题键 → 问题；键即 answers 里的键）。 */
export interface DecisionsRequest {
  model: string;
  state: string;
  questions: Record<string, Question>;
}

/** 响应体：只取 answers（其余字段调用方用不到）。 */
export interface DecisionsResponse {
  answers: Record<string, Answer>;
}

/**
 * 调用 OpenRouter Decisions API。
 *
 * @param apiKey    OPENROUTER_API_KEY
 * @param state     给模型的上下文文本（由调用方组织，本层不理解其内容）
 * @param questions 结构化问题；键即返回对象里的键
 * @param model     决策模型 id，默认 DEFAULT_MODEL
 * @param timeoutMs 请求超时（毫秒），默认 DEFAULT_TIMEOUT_MS；workerd 支持 AbortSignal.timeout
 * @returns answers 对象（键与 questions 对应）
 * @throws Error    HTTP 非 2xx、超时、网络错误、响应缺少 answers —— 由调用方决定如何降级
 */
export async function decide(
  apiKey: string,
  state: string,
  questions: Record<string, Question>,
  model: string = DEFAULT_MODEL,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, Answer>> {
  const request: DecisionsRequest = { model, state, questions };

  let response: Response;
  try {
    response = await fetch(DECISIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      // 超时与网络失败一样落到下面的 catch：统一转成 Error，调用方只需一个 try/catch。
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `Decisions API 请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Decisions API ${String(response.status)}: ${text}`);
  }

  const data = await response.json<DecisionsResponse>();
  if (typeof data.answers !== 'object' || data.answers === null) {
    // 响应残缺按失败处理：让调用方走本地降级，而不是把 undefined 漏进业务判定。
    throw new Error('Decisions API 响应缺少 answers');
  }
  return data.answers;
}
