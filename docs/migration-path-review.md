# Перенос профиля и контрольного проекта Gold Work Studio на E:

Статический разбор базы 96229a3f1a67c3f7d002731d409886705abb77f5. Сборку, запуск и производственные операции выполняет пользователь.

## Профиль, хранилище и кэши

- Для запуска собранного приложения задайте `GWS_USER_DATA_DIR=E:\GoldWorkStudio\data\profile` и уберите PORTABLE_EXECUTABLE_DIR из окружения запуска. Portable-обёртка выставляет собственный PORTABLE_EXECUTABLE_DIR, и приложение выбирает `<каталог portable>\workspace` для своих данных, даже если Chromium получил отдельный userData. Прямой EXE из win-unpacked или из папки установки использует E-профиль. [main.ts](../apps/desktop/src/main.ts#L81), [выбор каталога](../apps/desktop/src/main.ts#L153).
- Создайте E:\GoldWorkStudio\data\workspace и новый profile\storage-location.json в UTF-8 без BOM с содержимым `{"activePath":"E:\\GoldWorkStudio\\data\\workspace"}`. Приложение создаст служебный profile\workspace и использует реальный путь activePath для projects, Library и Materials. В старом location activePath указывает в D:\GoldWorkStorage, retainedPath указывает на C:, а старый profile\workspace\Materials является junction на D:. Старый pendingPath или журнал переключения может запустить перенос на старте. Для готового каталога достаточно activePath. [workspace-storage.ts](../apps/desktop/src/workspace-storage.ts#L21), [перенос при старте](../apps/desktop/src/workspace-storage.ts#L117), [main.ts](../apps/desktop/src/main.ts#L1343).
- Кэш стоков и поиска хранится в profile\cache, образцы голоса в profile\tts-samples, часть кэшей медиа внутри workspace. Для отдельного E:\GoldWorkStudio\cache допустим junction из нового profile\cache в E:\GoldWorkStudio\cache\profile-cache, если путь в новом профиле свободен. В стандартной конфигурации Windows имена Cache и cache могут обозначать один каталог, в том числе для Chromium. Для системных временных файлов можно до запуска задать TEMP и TMP на заранее созданную папку на E:. Для YouTube отдельно действует сохранённый workDirPath либо GOLD_WORK_TEMP_DIR. Модели Whisper/CLIP/cutout используют LOCALAPPDATA\GoldWorkStudio\Models. GW_CHROME_PATH и YT_DLP_PATH относятся к отдельным бинарникам. [Кэш стоков](../apps/desktop/src/main.ts#L1318), [кэш поиска](../apps/desktop/src/main.ts#L1385), [YouTube](../apps/desktop/src/youtube-store.ts#L38), [браузер](../apps/desktop/src/remotion-montage-renderer.ts#L265), [Whisper](../apps/desktop/src/local-speech-recognition.ts#L11).
- Финальный файл приложения создаётся в `workspace\projects\<id>\Final.mp4`. E:\GoldWorkStudio\exports подходит для пользовательских копий после завершённого экспорта. Изменение outputPath в JSON не перенаправляет следующий экспорт. Плеер разрешает пути внутри профиля и workspace. [Путь результата](../apps/desktop/src/local-project-storage.ts#L85), [рендер](../apps/desktop/src/standard-renderer.ts#L756), [gw-media](../apps/desktop/src/main.ts#L1430).

## Что взять из старого профиля

Копировать закрытый профиль выборочно из C:\Users\rosup\AppData\Roaming\@gold-work\desktop. Настройки и учётные данные держать вне source и Git.

| Назначение | Перенос |
| --- | --- |
| Настройки и ключи | credentials\anymodel.json, voicer.json, google.json, stock.json, youtube.json и flow\accounts.json. Копировать шифротекст как есть под той же учётной записью Windows. Сохранённый в youtube.json cookiesFilePath указывает на отдельный существующий файл на D:. Скопировать его приватно и обновить только путь в новой копии. |
| Сессии Flow | Сохранить Local State и только соответствующие трём аккаунтам папки Partitions\flow-*, сверяя partition после удаления префикса persist:. Все три папки найдены. Копировать при закрытом приложении, включая сетевое хранилище cookies. Приём сохранённых сессий провайдером требует ручной проверки. |
| Каналы и герои | database\channel-profiles.json. Скопировать используемые портреты с сохранением структуры projects\.channels и перебазировать соответствующие characterVersions[].imagePath, primaryCharacter.imagePath и при сохранении истории deletedCharacterVersions[].imagePath. В активном JSON найдено 14 таких ссылок на файлы в C-профиле. channel-analytics.json и tts-samples можно сохранить для отслеживаемых каналов и готовых образцов голоса. |
| Интерфейс | Local Storage опционально для пресетов субтитров и размеров панелей. Session Storage хранит навигацию и последний проект, поэтому его оставить в старом профиле. |
| Старое состояние | Старые projects.json и корзину, повреждённые копии, queue.json и резервные очереди, старый storage-location.json, database\channel-profiles.json.trash и SQLite с WAL/SHM оставить в архиве. Текущие точки входа берут проекты, очередь и каналы из JSON. |

[Инициализация хранилищ](../apps/desktop/src/main.ts#L1307), [safeStorage](../apps/desktop/src/anymodel-store.ts#L120), [Flow partitions](../apps/desktop/src/flow-account-store.ts#L99), [папка портретов](../apps/desktop/src/local-project-storage.ts#L89), [пресеты редактора](../apps/renderer/src/App.tsx#L3953).

## Контрольный проект

1. Источник — E:\GoldWorkAudit-20261108\full-clean-03-resume-v25\small-control\final-project.json. Сохраните тот же объект с перебазированными локальными путями как E:\GoldWorkStudio\data\workspace\projects\audit-cutty-clean-v10-20261109\project.json и как единственную запись в E:\GoldWorkStudio\data\profile\projects.json. Реестр — массив, snapshot — объект. Оба в UTF-8 без BOM. Отдельный snapshot используется для восстановления, нормальный список читается из реестра. [Реестр](../apps/desktop/src/project-registry.ts#L13), [snapshot](../apps/desktop/src/local-project-storage.ts#L258), [восстановление при старте](../apps/desktop/src/main.ts#L1345).
2. Перебазируйте по точной карте скопированных файлов scenes[].audioPath, scenes[].documentary.timing.audioPath, scenes[].imagePath, scenes[].videoPath, scenes[].documentary.selected.localPath, scenes[].documentary.candidates[].localPath и settings.music.clips[].path. 109 уникальных файлов лежат под E:\GoldWorkAudit-20261108\full-clean-03\storage\projects\audit-cutty-clean-v10-20261109, ещё 85 — в том же audit-run вне папки проекта, 4 музыкальных файла — в D:\GoldWorkStorage. Сохраняйте относительную структуру папки проекта и раздельные подкаталоги для внешних кандидатов и музыки, чтобы исключить коллизии имён.
3. Сохраните 63 сцены и их audioPath, выбранные медиа, идентификаторы, тайминги, нарезку, происхождение, оценки, pin-флаги, статусы проекта failed и stockProduction failed/materials. Меняйте только конкретные файловые значения. URL, запросы провайдерам, идентификаторы, чексумы и статусы отправки сохраните. В актуальном снимке outputPath отсутствует. ID канала контрольного проекта отсутствует в 20 старых активных каналах и в найденных аудитных профилях. Ролик следует открывать из общего списка проектов, а привязку к каналу решать отдельно при необходимости.
4. Сохраните в recovery побайтно исходные project.json и scenario.json, актуальный small-control\final-project.json и small-control\scene-51-terminal-receipt.json, аудитные final-queue.json и profile\queue.json, а из корня проекта Documentary\Analysis (546 JSON), documentary-ai-query-plans и documentary-ai-fallback-plans (по одному JSON), Documentary\Plans, Documentary\Timing, Documentary\selection-budget.json. Сохраните существующие журналы восстановления и относящиеся к выбранным материалам sidecar-файлы. Пути в оригинальных записях, имена ключей и статусы request/provider сохранить. Для производственного продолжения сначала разберите применимость конкретных записей и восстановите нужные с исходной относительной структурой. Архивные файлы сами по себе не защищают новый профиль от повторной отправки. [Маркер перед отправкой](../apps/desktop/src/documentary-ai-query-planner.ts#L953), [обработка uncertain](../apps/desktop/src/documentary-ai-query-planner.ts#L1023), [контекст восстановления](../apps/desktop/src/documentary-plan-recovery.ts#L9).

## Ручная сборка и первый запуск

Команды ниже предназначены пользователю. Закройте старый экземпляр. Для перенесённого source используйте PowerShell.

~~~powershell
Set-Location -LiteralPath 'E:\GoldWorkStudio\source'
pnpm install --frozen-lockfile
pnpm build
~~~

Установка зависимостей нужна, если их ещё нет. Проект указывает Node.js 24.19.0 и pnpm 11.9.0. После успешной сборки в том же PowerShell:

~~~powershell
$env:GWS_USER_DATA_DIR = 'E:\GoldWorkStudio\data\profile'
Remove-Item Env:PORTABLE_EXECUTABLE_DIR -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
Remove-Item Env:GWS_BACKGROUND_TEST -ErrorAction SilentlyContinue
node .\scripts\launch-desktop.mjs
~~~

Для упаковки команда `pnpm installer` из того же source сама собирает приложение и создаёт установщик без публикации. После неё с теми же переменными можно выполнить `& 'E:\GoldWorkStudio\source\release\win-unpacked\Gold Work Studio.exe'` либо прямой EXE из выбранной папки установки. Запускайте один вариант за раз. E:\GoldWorkStudio-verified содержит прежнюю сборку. [README.md](../README.md#L19), [package.json](../package.json#L7), [упаковка](../apps/desktop/electron-builder.yml#L1), [launcher](../scripts/launch-desktop.mjs#L7).

Перед первым запуском в активном профиле queue.json должен отсутствовать или содержать `[]`. Очередь тикает каждые 500 мс. Для первой ручной проверки откройте новый экземпляр офлайн, подтвердите E-путь и пустую очередь. В настройках контрольного проекта → «Монтаж» смените «Формат видео» 16:9 → 1:1, сохраните и повторно откройте после закрытия приложения; затем верните 16:9. В Stock Documentary v2 нет поля переименования. Сам экран настроек при ElevenLabs может получать список шаблонов у провайдера; редактор может автоматически подготавливать локальные тайминги/изображения. Производство, продолжение, повтор платных запросов и экспорт оставить для отдельного ручного этапа. [Очередь](../apps/desktop/src/main.ts#L1405), [настройки](../apps/renderer/src/StockWorkflowSettings.tsx#L92), [сохранение](../apps/renderer/src/App.tsx#L1840), [получение шаблонов](../apps/renderer/src/App.tsx#L1811).
