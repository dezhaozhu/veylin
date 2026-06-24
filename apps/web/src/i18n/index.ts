import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
] as const;

export const LANGUAGE_STORAGE_KEY = 'veylin-lang';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      'zh-CN': { translation: zhCN },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'zh-CN'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
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

export default i18n;
