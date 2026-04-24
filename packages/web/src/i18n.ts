import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

void i18n.use(initReactI18next).init({
  fallbackLng: 'zh',
  lng: 'zh',
  resources: {},
  interpolation: {
    escapeValue: false,
  },
});

export { i18n };
export default i18n;
