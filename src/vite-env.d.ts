/// <reference types="vite/client" />

// The Vite plugin rewrites these queries at load time. `?scene` yields a full
// scene description; `?project` wraps the config in bootstrap() and yields a
// live Project. Neither transform is visible to tsc, hence these declarations.

declare module "*?scene" {
  import type { FullSceneDescription } from "@motion-canvas/core";
  const scene: FullSceneDescription;
  export default scene;
}

declare module "*?project" {
  import type { Project } from "@motion-canvas/core";
  const project: Project;
  export default project;
}
