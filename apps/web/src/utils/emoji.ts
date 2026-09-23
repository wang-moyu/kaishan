export interface EmojiDef {
  code: string;
  file: string;
  label: string;
}

export const EMOJI_LIST: EmojiDef[] = [
  { code: 'huaji', file: 'image_emoticon.png', label: '滑稽' },
  { code: 'kaixin', file: 'image_emoticon2.png', label: '真开心' },
  { code: 'haixiu', file: 'image_emoticon3.png', label: '害羞' },
  { code: 'xieyanxiao', file: 'image_emoticon4.png', label: '斜眼笑' },
  { code: 'daku', file: 'image_emoticon5.png', label: '大哭' },
  { code: 'ku', file: 'image_emoticon6.png', label: '酷' },
  { code: 'han', file: 'image_emoticon7.png', label: '汗' },
  { code: 'nu', file: 'image_emoticon8.png', label: '怒' },
  { code: 'weiqu', file: 'image_emoticon9.png', label: '委屈' },
  { code: 'yinxian', file: 'image_emoticon10.png', label: '阴险' },
  { code: 'hehe', file: 'image_emoticon11.png', label: '呵呵' },
  { code: 'bishi', file: 'image_emoticon12.png', label: '鄙视' },
  { code: 'guai', file: 'image_emoticon13.png', label: '乖' },
  { code: 'kelian', file: 'image_emoticon14.png', label: '可怜' },
  { code: 'wabi', file: 'image_emoticon15.png', label: '挖鼻' },
  { code: 'heixian', file: 'image_emoticon16.png', label: '黑线' },
  { code: 'wuzui', file: 'image_emoticon17.png', label: '捂嘴' },
  { code: 'jingya', file: 'image_emoticon18.png', label: '惊讶' },
  { code: 'yiwen', file: 'image_emoticon19.png', label: '疑问' },
  { code: 'tushe', file: 'image_emoticon20.png', label: '吐舌' },
  { code: 'xiaoku', file: 'image_emoticon21.png', label: '笑哭' },
  { code: 'xiaoyan', file: 'image_emoticon22.png', label: '笑眼' },
  { code: 'kuanghan', file: 'image_emoticon23.png', label: '狂汗' },
  { code: 'tian', file: 'image_emoticon24.png', label: '舔' },
  { code: 'outu', file: 'image_emoticon25.png', label: '呕吐' },
];

const EMOJI_MAP = new Map(EMOJI_LIST.map((e) => [e.code, e]));

export function emojiUrl(code: string): string | null {
  const def = EMOJI_MAP.get(code);
  return def ? `/emoji/${def.file}` : null;
}

const EMOJI_RE = /\[([a-z]+)\]/g;

export function renderEmoji(text: string): string {
  return text.replace(EMOJI_RE, (match, code: string) => {
    const url = emojiUrl(code);
    if (url === null) return match;
    return `<img class="chat-emoji" src="${url}" alt="[${code}]" />`;
  });
}

export function hasEmoji(text: string): boolean {
  return EMOJI_RE.test(text);
}
