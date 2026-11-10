import { access, copyFile, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWrite } from "./fs-utils.js";
import {projectJsonChunks} from './project-json.js';
import type { Project, Scene, StockAssetSource, StockMediaType } from "@gold-work/shared";

export interface StockAssetStorageSlot {
  /** Zero-based alternate index. Omit for the primary scene asset. */
  alternateIndex?: number;
}

function safeSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "untitled";
}

const writeAtomic = atomicWrite;

function createBmp(width: number, height: number, seed: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const output = Buffer.alloc(54 + pixelSize);
  output.write("BM", 0, "ascii");
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelSize, 34);

  const baseR = 45 + (seed % 90);
  const baseG = 30 + ((seed >> 3) % 70);
  const baseB = 65 + ((seed >> 7) % 100);
  for (let y = 0; y < height; y += 1) {
    const row = 54 + y * rowSize;
    for (let x = 0; x < width; x += 1) {
      const offset = row + x * 3;
      const light = Math.round(80 * (x / width) + 45 * (y / height));
      output[offset] = Math.min(255, baseB + light);
      output[offset + 1] = Math.min(255, baseG + Math.round(light * 0.75));
      output[offset + 2] = Math.min(255, baseR + Math.round(light * 0.55));
    }
  }
  return output;
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bitsPerSample = 16;
  const sampleCount = Math.max(1, Math.ceil(durationSeconds * sampleRate));
  const dataSize = sampleCount * channels * (bitsPerSample / 8);
  const output = Buffer.alloc(44 + dataSize);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataSize, 4);
  output.write("WAVE", 8, "ascii");
  output.write("fmt ", 12, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  output.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  output.writeUInt16LE(bitsPerSample, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataSize, 40);
  return output;
}

export class LocalProjectStorage {
  private snapshotWrites = new Map<string,{latest:Project;promise:Promise<string>}>();
  constructor(readonly rootPath: string, private readonly readProject?: (id: string) => Promise<Project | undefined>) {}

  projectDirectory(projectId: string): string {
    return join(this.rootPath, safeSegment(projectId));
  }

  sceneDirectory(project: Project, scene: Scene): string {
    const order = String(scene.order + 1).padStart(3, "0");
    return join(this.projectDirectory(project.id), "scenes", `${order}-${safeSegment(scene.id)}`);
  }

  finalPath(projectId: string): string {
    return join(this.projectDirectory(projectId), "Final.mp4");
  }

  channelCharacterDirectory(channelProfileId: string): string {
    return join(this.rootPath, ".channels", safeSegment(channelProfileId), "characters");
  }

  trashedProjectDirectory(trashId: string): string {
    return join(this.rootPath, ".trash", "projects", safeSegment(trashId));
  }

  sceneVideoPath(project: Project, scene: Scene): string {
    return join(this.sceneDirectory(project, scene), "scene.mp4");
  }

  async saveGeneratedImage(project: Project, scene: Scene, data: Buffer): Promise<string> {
    await this.ensureProject(project);
    const path = join(this.sceneDirectory(project, scene), "image.png");
    await writeAtomic(path, data);
    await writeAtomic(join(this.sceneDirectory(project, scene), "image-prompt.txt"), scene.imagePrompt);
    return path;
  }

  async saveGeneratedAudio(project: Project, scene: Scene, data: Buffer): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "voice.mp3");
    await writeAtomic(path, data);
    await writeAtomic(join(directory, "narration.txt"), scene.narration);
    await this.writeSceneManifest(project, scene);
    return path;
  }

  /** Портрет главного героя проекта — используется как референс для всех сцен. */
  async saveStoryCharacterReference(project: Project, characterId: string, data: Buffer): Promise<string> {
    const directory = join(await this.ensureProject(project), "characters", safeSegment(characterId));
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${randomUUID()}.png`);
    await writeAtomic(path, data);
    return path;
  }

  async saveCharacterReference(project: Project, data: Buffer, character: { name: string; prompt: string; characterPrompt?: string; stylePrompt?: string; updatedAt: string }): Promise<string> {
    const directory = await this.ensureProject(project);
    const path = join(directory, "character.png");
    await writeAtomic(path, data);
    await writeAtomic(join(directory, "character.json"), JSON.stringify({ ...character, imagePath: path }, null, 2));
    return path;
  }

  /** Неизменяемая копия общей дорожки. Последующая перегенерация одной части
   * пишет её обычный voice-файл, не портя звук соседних частей. */
  async snapshotNarration(project: Project, scene: Scene): Promise<string> {
    if (!scene.audioPath) throw new Error("Нет готовой озвучки для разделения");
    const destination = join(this.projectDirectory(project.id), "narration-sources", safeSegment(scene.id), randomUUID(), basename(scene.audioPath));
    await mkdir(dirname(destination), {recursive: true});
    await copyFile(scene.audioPath, destination);
    return destination;
  }

  /** Новая версия героя не перезаписывает предыдущий reference канала. */
  async saveChannelCharacterReference(
    channelProfileId: string,
    versionId: string,
    data: Buffer,
    character: { name: string; prompt: string; characterPrompt?: string; stylePrompt?: string; updatedAt: string; sourceProjectId?: string }
  ): Promise<string> {
    const directory = this.channelCharacterDirectory(channelProfileId);
    await mkdir(directory, { recursive: true });
    const stem = safeSegment(versionId);
    const path = join(directory, `${stem}.png`);
    await writeAtomic(path, data);
    await writeAtomic(join(directory, `${stem}.json`), JSON.stringify({ ...character, versionId, channelProfileId, imagePath: path }, null, 2));
    return path;
  }

  /** Перемещает локальные файлы ролика во внутреннюю корзину без удаления. */
  async moveProjectToTrash(projectId: string, trashId: string): Promise<boolean> {
    const source = this.projectDirectory(projectId);
    const destination = this.trashedProjectDirectory(trashId);
    assertChildPath(this.rootPath, source);
    assertChildPath(join(this.rootPath, ".trash", "projects"), destination);
    if (!await pathExists(source)) return false;
    if (await pathExists(destination)) throw new Error("В корзине уже существуют файлы этого проекта");
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return true;
  }

  /** Возвращает файлы проекта; существующая папка никогда не перезаписывается. */
  async restoreProjectFromTrash(projectId: string, trashId: string): Promise<boolean> {
    const source = this.trashedProjectDirectory(trashId);
    const destination = this.projectDirectory(projectId);
    assertChildPath(join(this.rootPath, ".trash", "projects"), source);
    assertChildPath(this.rootPath, destination);
    if (!await pathExists(source)) return false;
    if (await pathExists(destination)) throw new Error("Нельзя восстановить файлы: папка проекта уже существует");
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
    return true;
  }

  /** Окончательно удаляет только проверенный путь внутри внутренней корзины. */
  async purgeTrashedProject(trashId: string): Promise<void> {
    const trashRoot = join(this.rootPath, ".trash", "projects");
    const target = this.trashedProjectDirectory(trashId);
    assertChildPath(trashRoot, target);
    await rm(target, { recursive: true, force: true });
  }

  async saveGeneratedVideo(project: Project, scene: Scene, data: Buffer): Promise<string> {
    await this.ensureProject(project);
    const path = this.sceneVideoPath(project, scene);
    await writeAtomic(path, data);
    return path;
  }

  /** Сохраняет только уже выбранный пользователем сток и отдельный файл атрибуции. */
  async saveStockAsset(
    project: Project,
    scene: Scene,
    mediaType: StockMediaType,
    data: Buffer,
    extension: string,
    source: StockAssetSource,
    slot: StockAssetStorageSlot = {}
  ): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const safeExtension = extension.toLowerCase().replace(/[^a-z0-9]/g, "");
    const allowed = mediaType === "image" ? ["jpg", "png", "webp"] : ["mp4", "webm", "mov"];
    if (!allowed.includes(safeExtension)) throw new Error("Неподдерживаемый формат стокового файла");
    const alternateIndex = slot.alternateIndex;
    if (alternateIndex !== undefined && (!Number.isInteger(alternateIndex) || alternateIndex < 0 || alternateIndex > 99)) {
      throw new Error("Некорректный индекс дополнительного stock-файла");
    }
    const prefix = alternateIndex === undefined
      ? "stock"
      : `stock-alt-${String(alternateIndex + 1).padStart(2, "0")}`;
    const path = join(directory, `${prefix}-${mediaType}.${safeExtension}`);
    await writeAtomic(path, data);
    await writeAtomic(join(directory, `${prefix}-source.json`), JSON.stringify(source, null, 2));
    return path;
  }

  async ensureProject(project: Project): Promise<string> {
    const active=this.snapshotWrites.get(project.id);
    if(active){
      // Several scene workers can reach backup after newer registry mutations.
      // Retain only the newest pending snapshot, not eight 20-MB copies waiting
      // to rewrite the same files. All callers await the durable final write.
      if(!project.updatedAt||!active.latest.updatedAt||project.updatedAt>=active.latest.updatedAt)active.latest=project;
      return active.promise;
    }
    const state={latest:project,promise:Promise.resolve('')};
    const run=async()=>{
      try{
        for(;;){
          const latest=state.latest;
          // Callers may arrive with a snapshot taken before a newer mutation.
          // Read the current full registry inside the serialized backup writer.
          const current = this.readProject ? await this.readProject(project.id) : latest;
          if (!current) throw new Error("Проект уже удалён: резервная копия не перезаписана.");
          const directory=await this.writeProjectSnapshot(current);
          if (this.readProject) {
            const after = await this.readProject(project.id);
            if (!after) throw new Error("Проект удалён во время записи резервной копии.");
            if (after.updatedAt !== current.updatedAt) {
              state.latest = after;
              continue;
            }
          }
          if(state.latest===latest)return directory;
        }
      }finally{if(this.snapshotWrites.get(project.id)===state)this.snapshotWrites.delete(project.id);}
    };
    // Publish the state before the first filesystem await.
    this.snapshotWrites.set(project.id,state);
    state.promise=run();
    return state.promise;
  }

  private async writeProjectSnapshot(project: Project): Promise<string> {
    const directory = this.projectDirectory(project.id);
    await mkdir(join(directory, "scenes"), { recursive: true });
    await writeAtomic(join(directory, "project.json"), projectJsonChunks(project), {allowCopyFallback: false, durable: true});
    const scenarioPath=join(directory,"scenario.json");
    const scenario=JSON.stringify(
        project.scenes.map(({ id, order, title, narration, imagePrompt, animationPrompt, durationSeconds }) => ({
          id,
          order,
          title,
          narration,
          imagePrompt,
          animationPrompt,
          durationSeconds
        })),
        null,
        2
      );
    // Read the current bytes on every backup: an external edit or a deleted
    // scenario must be restored even if this project's projection is unchanged.
    let unchanged=false;
    try{unchanged=(await readFile(scenarioPath)).equals(Buffer.from(scenario));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(!unchanged)await writeAtomic(scenarioPath,scenario,{allowCopyFallback:false,durable:true});
    return directory;
  }

  async createPlaceholderImage(project: Project, scene: Scene): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "image.bmp");
    const dimensions = project.aspectRatio === "9:16"
      ? [360, 640]
      : project.aspectRatio === "1:1"
        ? [512, 512]
        : [640, 360];
    const seed = [...`${project.id}:${scene.id}`].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    await writeAtomic(path, createBmp(dimensions[0] ?? 640, dimensions[1] ?? 360, seed));
    await writeAtomic(join(directory, "image-prompt.txt"), scene.imagePrompt);
    await this.writeSceneManifest(project, scene);
    return path;
  }

  async createPlaceholderAudio(project: Project, scene: Scene): Promise<string> {
    await this.ensureProject(project);
    const directory = this.sceneDirectory(project, scene);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "voice.wav");
    await writeAtomic(path, createSilentWav(scene.durationSeconds));
    await writeAtomic(join(directory, "narration.txt"), scene.narration);
    await this.writeSceneManifest(project, scene);
    return path;
  }

  async writeSceneManifest(project: Project, scene: Scene): Promise<void> {
    await writeAtomic(join(this.sceneDirectory(project, scene), "scene.json"), JSON.stringify(scene, null, 2));
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertChildPath(root: string, target: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const child = relative(resolvedRoot, resolvedTarget);
  if (!child || child.startsWith("..") || child.includes(":")) {
    throw new Error("Небезопасный путь внутренней корзины");
  }
}
