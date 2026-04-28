import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { enUS } from './locales/en-US';
import { zhCN } from './locales/zh-CN';

export type Locale = 'zh-CN' | 'en-US';
export const I18N_LOCALE_STORAGE_KEY = 'haro:locale';

const catalogs: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
let staticLocale: Locale = readPersistedLocale() ?? 'zh-CN';

export function I18nProvider({ locale = 'zh-CN', children }: { locale?: Locale; children: ReactNode }) {
  const [currentLocale, setCurrentLocale] = useState<Locale>(() => readPersistedLocale() ?? locale);
  const value = useMemo<I18nContextValue>(() => ({
    locale: currentLocale,
    setLocale: (nextLocale) => {
      staticLocale = nextLocale;
      persistLocale(nextLocale);
      setCurrentLocale(nextLocale);
    },
    t: (key, values) => translate(currentLocale, key, values),
  }), [currentLocale]);
  staticLocale = currentLocale;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): (key: string, values?: Record<string, string | number>) => string {
  return useI18n().t;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    return {
      locale: staticLocale,
      setLocale: (nextLocale) => {
        staticLocale = nextLocale;
        persistLocale(nextLocale);
      },
      t: (key, values) => translate(staticLocale, key, values),
    };
  }
  return context;
}

export function getT(locale = staticLocale): (key: string, values?: Record<string, string | number>) => string {
  return (key, values) => translate(locale, key, values);
}

function translate(locale: Locale, key: string, values?: Record<string, string | number>): string {
  const template = catalogs[locale][key] ?? catalogs['en-US'][key] ?? key;
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
}

function readPersistedLocale(): Locale | null {
  try {
    const value = globalThis.localStorage?.getItem(I18N_LOCALE_STORAGE_KEY);
    return value === 'zh-CN' || value === 'en-US' ? value : null;
  } catch {
    return null;
  }
}

function persistLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(I18N_LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage failures.
  }
}
