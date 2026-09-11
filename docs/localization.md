# Interface languages

The interface supports Simplified Chinese (`zh-CN`) and English (`en`). The first supported entry in the browser's language preferences selects the initial language. Other languages fall back to English. An explicit choice is saved under `v1pro.locale` and synchronized between tabs. Changing language does not reload or remount the application.

Use `useI18n()` in components that display translated text. `t(chinese, english?, values?)` and the standalone `translate` helper accept named or numbered `{placeholders}`. Feature dictionaries in `src/i18n/` also translate canonical server/device status messages at their display boundary. Keep service comparisons, USB protocol values, form values, resource IDs and API payload identifiers unchanged. Prefer complete sentences over fragments so English word order is correct.

Use `formatDate` and `formatNumber` for presentation. Prices remain CNY; event deadlines retain their stated China time zone. Display language does not change shipping availability, phone validation or payment methods.

Uploaded media titles, collection names, usernames, comments and product descriptions remain their original content. Generated remote AI replies use the backend's existing language policy; the English UI and local AI fallback do not translate arbitrary generated or user content. The statutory ICP registration identifier also remains unchanged.

Run `npm run test:i18n`, `npm run typecheck`, `npm run lint` and `npm run build`. Localization tests validate language preference order, fallback, interpolation, reversible status messages, specific-template precedence and dictionary placeholder parity. Browser regression checks should cover English/Chinese detection, persistence, switching without losing input or transfer state, and desktop/mobile layouts. Test USB interaction with explicit device selection; UI validation alone is not a physical device transfer test.
