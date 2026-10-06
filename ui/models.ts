import type { SessionMeta } from "./host";

/** "claude-opus-5-5" or "claude-haiku-4-5-20251001" as "Opus 5.5" or "Haiku 4.5"; other ids as they are. */
export function modelName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (!match) return id;
  const [, family, major, minor] = match;
  return `${family[0].toUpperCase()}${family.slice(1)} ${major}${minor ? `.${minor}` : ""}`;
}

/** What the composer shows for the model: the picked one, or the one Claude resolved for the default. */
export function modelLabel(meta: SessionMeta): string {
  if (meta.model !== null) return meta.models.find((model) => model.value === meta.model)?.label ?? meta.model;
  return meta.active_model ? modelName(meta.active_model) : "Default";
}
