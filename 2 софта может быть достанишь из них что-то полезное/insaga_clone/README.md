# insaga_clone

Локальная копия insaga.net — генерация историй с картинками, видео, озвучкой и монтажом.

## Быстрый старт

1. Установить [Node.js](https://nodejs.org/) (v18+) и [FFmpeg](https://ffmpeg.org/download.html)
2. Скопировать `.env.example` → `.env`, вписать свои ключи
3. Запустить:

```bash
npm install
npm run dev
```

4. Открыть http://localhost:3000

## Что внутри

| Модуль | Что делает | API ключ |
|---|---|---|
| Story (stage1/stage2) | Генерация персонажей, локаций, сцен | Gemini |
| Image gen | Картинки для персонажей и сцен | Gemini |
| Veo3 animation | Анимация картинок → видео | Gemini |
| Audio / TTS | Озвучка текста | ElevenLabs |
| Montaz / Assembly | Склейка видео + аудио + субтитры | Нет (FFmpeg) |
| Montaz / Graphics | Title card, lower third, end screen | Нет (FFmpeg) |
| Montaz / Music | Фоновая музыка | Нет (заглушка) |
| Montaz / Export | Финальный экспорт в mp4 | Нет (FFmpeg) |

## Структура

```
apps/api/src/
  routes/         — API эндпоинты
  services/       — Gemini, Veo, FFmpeg, imagegen
  store/          — in-memory state
apps/web/dist/    — фронтенд (собран)
packages/prompts/ — промпты для stage1/stage2
uploads/          — сгенерённые файлы
```

## API ключи

Берутся из `.env`:

- `GEMINI_API_KEY` — нужен для story, картинок, видео (stage1/stage2, image gen, Veo3)
- `ELEVENLABS_API_KEY` — нужен для озвучки (TTS)
- `OPENAI_API_KEY` — опционально, запасной бэкенд

Assembly и graphics работают **без ключей** — только FFmpeg.

## FFmpeg

Должен быть на PATH. Проверка:

```bash
ffmpeg -version
```

Если не установлен — качнуть с https://ffmpeg.org/download.html, положить в PATH.

## Эндпоинты (основные)

```
GET  /api/health                    — проверка
POST /api/story/generate            — сгенерировать историю (stage1 + stage2)
POST /api/audio/generate            — озвучить текст
POST /api/animation/veo3            — анимировать картинку
PUT  /api/montaz/projects/:id       — сохранить timeline
POST /api/montaz/projects/:id/assemble  — собрать видео
POST /api/montaz/projects/:id/export    — экспорт в mp4
POST /api/montaz/projects/:id/generate-graphics — title card / end screen
```

## Заглушки (не реализовано)

- Music generation (Suno AI) — возвращает тишину
- Lipsync (Wav2Lip/SadTalker) — возвращает заглушку
