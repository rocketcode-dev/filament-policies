import type { FrameworkMeta } from "filamentjs";

export type RefreshInterval =
  | number
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | "always"
  | "never";

export interface ResourceMetadata {
  readonly key: string;
  readonly byteLength: number;
  readonly lastModified?: Date;
  readonly contentType?: string;
  readonly etag?: string;
  readonly version?: string;
}

export interface ResourceStore {
  list(): Promise<readonly ResourceMetadata[]>;
  metadata(key: string): Promise<ResourceMetadata | undefined>;
  read(key: string, metadata: ResourceMetadata): Promise<Buffer>;
}

export interface Mount<A extends FrameworkMeta = FrameworkMeta> {
  readonly path: string;
  readonly store: ResourceStore;
  readonly refresh?: RefreshInterval;
  readonly cacheControl?: string;
  readonly metadata?: Partial<A>;
  readonly allowDotfiles?: boolean;
  readonly maxBytes?: number;
}

export interface SetupOptions<A extends FrameworkMeta = FrameworkMeta> {
  readonly mounts: readonly Mount<A>[];
  readonly now?: () => number;
  readonly onError?: (
    error: Error,
    resource: { readonly mount: string; readonly key: string },
  ) => void;
}

export interface SetupResult {
  readonly routes: readonly string[];
}

export interface FileSystemStoreOptions {
  readonly root: string;
  readonly followSymlinks?: boolean;
  readonly includeDotfiles?: boolean;
  readonly maxBytes?: number;
}
