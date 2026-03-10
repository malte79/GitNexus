export type RobloxRuntimeArea = 'shared' | 'client' | 'server' | 'other';

export interface RobloxPathSpec {
  rootKind: 'service' | 'script';
  serviceName?: string;
  parentDepth?: number;
  segments: string[];
  sourceText?: string;
}

export interface RojoMount {
  sourcePath: string;
  dataModelSegments: string[];
  runtimeArea: RobloxRuntimeArea;
}

export interface RojoMappedTarget {
  filePath: string;
  dataModelPath: string;
  dataModelSegments: string[];
  runtimeArea: RobloxRuntimeArea;
}

export interface RojoProjectIndex {
  projectFilePath: string;
  mounts: RojoMount[];
  getTargetsForFile(filePath: string): RojoMappedTarget[];
  resolveDataModelSegments(dataModelSegments: string[]): string[];
  getRuntimeAreaForPath(filePath: string): RobloxRuntimeArea | null;
}
