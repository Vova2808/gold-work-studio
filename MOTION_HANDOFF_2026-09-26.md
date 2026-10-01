# Motion / подробная карта — 26.09.2026

Последний запрос: сделать карту действительно подробной. Реализовано и отрендерено:
Natural Earth relief → городской OSM-план, реальные улицы/здания/вода/парки/подписи,
подписи разведены, маркер и контрастная подпись города, плавное движение.
Не спутниковая карта и не Google Earth Studio. Область по умолчанию 2,5 км вокруг
выбранного центра, публичный Overpass: один запрос, cache, без тайлов/массовой выгрузки.

Ключевой код: `documentary-map.ts`, `DocumentaryMotionGraphic.tsx`,
`DocumentaryMotionInspector.tsx`, shared `documentary-motion.ts`.
`Root.tsx` содержит однокадровую композицию GoldWorkMapRaster: SVG рисуется в PNG
2400×2400 один раз; PNG используется и в preview, и в export. Raster bundle временный,
raw OSM/SVG/PNG/metadata сохраняются в Documentary/Maps. Прерванный raster не теряет
готовый ответ сервера. Реальные clipped OSM geometry содержат null — не соединять
дороги через эти разрывы. Unknown/error не превращать в фальшивые улицы.

Денвер live: 16392 элемента / 4641 здание, запрос 3,235 с; 21,7 MB данных+подложек,
warm cache без fetch 13 ms. Шестисекундный 1080p пример:
`apps/desktop/captures/motion-map-render-20260926/Motion-demo.mp4`,
result.json: 55,038 с (bundle + 3 stills + render), 180 настоящих кадров.
Контейнер AAC 6,06 с из-за packet padding; production renderer ограничивает Final
по длительности таймлайна. Preview/stills были просмотрены.

Более ранняя часть этого же запроса: 8 reusable motion-композиций, bounded live
semantic plan 8 сцен, библиотека 90 review / 82 новых approved (не все 767!),
измеренные пики SFX/необрезанные хвосты. Подробности в актуальном начале ROADMAP.
Исходный проект и SS United States full-test не переделаны, Final не перезаписан.
Новый полный paid/TTS прогон не выполнялся; прежний Lumean key blocker остаётся.
Провайдеры, ключи, настройки оплаты не менялись.

Проверки: builds/types, узкие map/cache/motion/montage/coverage/SFX tests,
real local render, editor save/reopen fixture, isolated native main/preload/map/media
check `documentary-startup-check.mjs --motion-map` (использует скопированный raw OSM,
не делает новый запрос). Native результат в captures/motion-native-profile/result.json.
Сборка 20260926T121531Z-7589cbb03b-dirty. Native check прошёл: 7,135 с от готового raw
до PNG и успешного native media fetch, 2400 px / 5529331 bytes. QA процессы и свой Vite
5174 закрыты перед передачей. Чужой 4173 не трогался.

Не запускать full suite без запроса. Не удалять пользовательские медиа/C-backup/
gws-preview-audit-*; не трогать приложение на 4173. Большой dirty/untracked checkout
сохранён без reset/clean/staging. Старый goal tool заблокирован на прежнем общем
производстве, create_goal для нового scope был отклонён как unfinished; не выдавать
его за созданную/завершённую цель. Новая карта — завершённый отдельный инкремент.
