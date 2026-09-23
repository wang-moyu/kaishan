/** 让测试可以直接 import 受控 SQL 文本（Vite 的 ?raw）。 */
declare module '*.sql?raw' {
  const content: string;
  export default content;
}
