import type {Project} from '@gold-work/shared';

/** Search evidence is fetched for one opened scene, never with every progress tick. */
export function projectForDisplay(project: Project): Project {
  return {...project, scenes: project.scenes.map(scene => scene.documentary ? {
    ...scene, documentary: {...scene.documentary, candidates: [],
      candidateCount: scene.documentary.candidateCount ?? scene.documentary.candidates.length,
      candidatesDeferred: true},
  } : scene)};
}

/** Covers project-returning IPC methods, including {project}, {projects} and trash. */
export function projectResultForDisplay(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(projectResultForDisplay);
  const object = value as Record<string, unknown>;
  if (Array.isArray(object.scenes) && object.settings && typeof object.id === 'string') return projectForDisplay(value as Project);
  if ('project' in object) return {...object, project: projectResultForDisplay(object.project)};
  if ('projects' in object) return {...object, projects: projectResultForDisplay(object.projects)};
  return value;
}
