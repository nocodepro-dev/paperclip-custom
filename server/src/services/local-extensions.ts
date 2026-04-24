// Local Extensions — custom service exports not in upstream Paperclip
export { knowledgeService } from "./knowledge.js";
export { sopService } from "./sops.js";
export { sopConverterService } from "./sop-converter.js";
export { toolRequirementsService } from "./tool-requirements.js";
export { pipelineService } from "./pipelines.js";
export { workspacePortabilityService, resolveWorkspaceDir } from "./workspace-portability.js";
export * as workspaceGit from "./workspace-git.js";
export * as workspaceRuntimeLogs from "./workspace-runtime-logs.js";
