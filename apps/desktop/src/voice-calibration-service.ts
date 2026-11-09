import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createVoiceCalibration,
  ttsLanguageCode,
  voiceCalibrationSampleText,
  type VoiceCalibrationRequest,
  type VoiceCalibrationSampleResult
} from "@gold-work/shared";
import { narrationSpeechDurationSeconds } from "./standard-renderer.js";

interface AnyModelSampleClient {
  ttsSample(voice: string, languageCode: string, cacheDir: string): Promise<string>;
}

interface VoicerSampleClient {
  ttsSample(templateUuid: string | undefined, languageCode: string, cacheDir: string): Promise<string>;
}

export interface VoiceCalibrationServiceOptions {
  measureDuration?: (path: string) => Promise<number>;
  now?: () => Date;
}

/**
 * Единственная backend-точка калибровки: синтезирует известную фразу тем же
 * провайдером/голосом, которым затем будет озвучен ролик, и измеряет сам MP3.
 */
export class VoiceCalibrationService {
  private readonly measureDuration: (path: string) => Promise<number>;
  private readonly now: () => Date;

  constructor(
    private readonly anyModel: AnyModelSampleClient,
    private readonly voicer: VoicerSampleClient,
    private readonly cacheDir: string,
    options: VoiceCalibrationServiceOptions = {}
  ) {
    this.measureDuration = options.measureDuration ?? narrationSpeechDurationSeconds;
    this.now = options.now ?? (() => new Date());
  }

  async calibrate(input: VoiceCalibrationRequest): Promise<VoiceCalibrationSampleResult> {
    const voice = input.voice?.trim();
    if (!voice) throw new Error("Сначала выберите конкретный голос и прослушайте тестовую фразу");
    if (input.provider !== "edge-tts" && input.provider !== "elevenlabs") {
      throw new Error("Неизвестный провайдер озвучки");
    }
    const languageCode = ttsLanguageCode(input.language);
    const sampleAudioBase64 = input.provider === "elevenlabs"
      ? await this.voicer.ttsSample(voice, languageCode, this.cacheDir)
      : await this.anyModel.ttsSample(voice, languageCode, this.cacheDir);
    const audio = Buffer.from(sampleAudioBase64, "base64");
    if (audio.byteLength < 32) throw new Error("Провайдер вернул пустую тестовую озвучку");

    await mkdir(this.cacheDir, { recursive: true });
    const identity = createHash("sha256")
      .update(`${input.provider}\0${voice}\0${languageCode}\0v1`)
      .digest("hex")
      .slice(0, 20);
    const measurementPath = join(this.cacheDir, `calibration-measure-${identity}.mp3`);
    await writeFile(measurementPath, audio);
    const audioDurationSeconds = await this.measureDuration(measurementPath);
    const calibration = createVoiceCalibration({
      provider: input.provider,
      voice,
      language: languageCode,
      sampleText: voiceCalibrationSampleText(languageCode),
      audioDurationSeconds,
      calibratedAt: this.now().toISOString()
    });
    return { calibration, sampleAudioBase64 };
  }
}
