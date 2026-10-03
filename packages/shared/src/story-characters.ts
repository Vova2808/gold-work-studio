import type { Project, Scene, StoryCharacter } from "./index.js";

export function sceneStoryCharacters(project: Project, scene: Scene): StoryCharacter[] {
  if (!project.storyCharacters) return [];
  if (scene.characterIds) return project.storyCharacters.filter(character => scene.characterIds!.includes(character.id));
  // Legacy or manually added shot: only exact word-boundary aliases, not substrings (Sam != sample).
  const words = new Set(scene.imagePrompt.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  return project.storyCharacters.filter(character => [character.name, ...character.aliases].some(alias => {
    const tokens = alias.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    return tokens.length > 0 && tokens.every(word => words.has(word));
  }));
}

export function storyCharacterIdentityKey(characters: StoryCharacter[]): string {
  return JSON.stringify(characters.map(character => [character.id, character.imagePath]));
}

export function sceneImageReferences(project: Project, scene: Scene): string[] {
  if (!project.storyCharacters) return project.settings.image.references.filter(Boolean).slice(0, 3);
  const cast = sceneStoryCharacters(project, scene);
  const missing = cast.filter(character => !character.imagePath || character.status === "generating");
  if (missing.length) throw new Error(`Сначала создайте образы: ${missing.map(character => character.name).join(", ")}`);
  const allPaths = new Set([project.characterReference?.imagePath, ...project.storyCharacters.map(character => character.imagePath)]);
  const extra = project.settings.image.references.filter(path => path.trim() && !allPaths.has(path));
  if (cast.length <= 3) return [...cast.map(character => character.imagePath!), ...extra].slice(0, 3);
  if (!project.storyCharacterSheet || project.storyCharacterSheet.identityKey !== storyCharacterIdentityKey(project.storyCharacters)) {
    throw new Error("Общий референс персонажей ещё не готов. Откройте сценарий и завершите подготовку образов.");
  }
  return [project.storyCharacterSheet.imagePath, ...extra].slice(0, 3);
}
