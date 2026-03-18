import type { RojoProjectIndex, RobloxPathSpec } from './roblox/types.js';

export interface ImportResolutionContext {
  allFilePaths: Set<string>;
  allFileList: string[];
  normalizedFileList: string[];
  suffixIndex: SuffixIndex;
  resolveCache: Map<string, string | null>;
}

export interface TsconfigPaths {
  aliases: Map<string, string>;
  baseUrl: string;
}

export interface GoModuleConfig {
  modulePath: string;
}

export interface ComposerConfig {
  psr4: Map<string, string>;
}

export interface SwiftPackageConfig {
  targets: Map<string, string>;
}

export interface ImportLanguageConfigs {
  tsconfigPaths: TsconfigPaths | null;
  goModule: GoModuleConfig | null;
  composerConfig: ComposerConfig | null;
  swiftPackageConfig: SwiftPackageConfig | null;
  rojoProject: RojoProjectIndex | null;
}

export interface SuffixIndex {
  get(suffix: string): string | undefined;
  getInsensitive(suffix: string): string | undefined;
  getFilesInDir(dirSuffix: string, extension: string): string[];
}

export type { RojoProjectIndex, RobloxPathSpec };
