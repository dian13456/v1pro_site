export type SiteLocale = "zh-CN" | "en";
export type MessageValues = Record<string, string | number>;
export const LOCALE_STORAGE_KEY = "v1pro.locale";

export function detectLocale(saved: string | null, languages: readonly string[]): SiteLocale {
  if (saved === "en" || saved === "zh-CN") return saved;
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh-CN";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function interpolate(message: string, values?: MessageValues): string {
  return message.replace(/\{(\w+)\}/g, (match, key: string) => values?.[key] === undefined ? match : String(values[key]));
}

function templatePattern(template: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  let source = "";
  let cursor = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    source += template.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    source += "([\\s\\S]+?)";
    keys.push(match[1]);
    cursor = match.index! + match[0].length;
  }
  source += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function createTranslator(messages: Record<string, string>) {
  const reverse = new Map(Object.entries(messages).map(([zh, en]) => [en, zh]));
  // Specific sentences must win over short unit templates such as "{0}帧".
  const templates = Object.entries(messages).filter(([zh]) => /\{\w+\}/.test(zh))
    .sort(([a], [b]) => b.replace(/\{\w+\}/g, "").length - a.replace(/\{\w+\}/g, "").length)
    .map(([zh, en]) => ({ zh, en, zhPattern: templatePattern(zh), enPattern: templatePattern(en) }));
  return (locale: SiteLocale, source: string, english?: string, values?: MessageValues): string => {
    if (english !== undefined) return interpolate(locale === "en" ? english : source, values);
    const exact = locale === "en" ? messages[source] : reverse.get(source);
    if (exact !== undefined) return interpolate(exact, values);
    for (const template of templates) {
      const { pattern, keys } = locale === "en" ? template.zhPattern : template.enPattern;
      const match = source.match(pattern);
      if (match) {
        const extracted: MessageValues = Object.fromEntries(keys.map((key, index) => [key, match[index + 1]]));
        return interpolate(locale === "en" ? template.en : template.zh, { ...extracted, ...values });
      }
    }
    return interpolate(source, values);
  };
}
