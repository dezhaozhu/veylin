import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const LANGUAGE_STORAGE_KEY = 'veylin-lang';

/** Map detector / browser codes to a supported app language. */
export function resolveAppLanguage(lang?: string | null): AppLanguage {
  const raw = (lang ?? '').trim().toLowerCase();
  if (raw === 'zh-cn' || raw === 'zh' || raw.startsWith('zh-')) return 'zh-CN';
  return 'en';
}

export function languageLabel(code: AppLanguage): string {
  return SUPPORTED_LANGUAGES.find((lang) => lang.code === code)?.label ?? SUPPORTED_LANGUAGES[0]!.label;
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zhCN },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh', 'zh-CN'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    react: {
      useSuspense: false,
    },
    // Help texts intentionally contain literal "{{ ... }}" template syntax
    // (workflow expression hints). Keep unmatched tokens verbatim instead of
    // dropping them.
    missingInterpolationHandler: (_text: string, value: unknown) =>
      Array.isArray(value) ? (value[0] as string) : String(value ?? ''),
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  });

i18n.on('languageChanged', (lng) => {
  const resolved = resolveAppLanguage(lng);
  if (typeof document !== 'undefined') document.documentElement.lang = resolved;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, resolved);
  } catch {
    // ignore quota / private mode
  }
});

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  const resolved = resolveAppLanguage(lang);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, resolved);
  } catch {
    // ignore quota / private mode
  }
  await i18n.changeLanguage(resolved);
  if (typeof document !== 'undefined') document.documentElement.lang = resolved;
}

export default i18n;
