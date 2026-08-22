export interface RedisKeyspaceOptions {
  readonly namespace?: string;
  readonly schemaVersion?: number;
}

const MAX_SEGMENT_LENGTH = 512;

function encodeSegment(value: string, label: string): string {
  if (value.length === 0) {
    throw new TypeError(`${label} must not be empty`);
  }
  if (value.length > MAX_SEGMENT_LENGTH) {
    throw new RangeError(
      `${label} must be at most ${MAX_SEGMENT_LENGTH} characters`,
    );
  }
  if (/\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must not contain control characters`);
  }
  return encodeURIComponent(value);
}

export class RedisKeyspace {
  readonly #prefix: string;

  constructor(options: RedisKeyspaceOptions = {}) {
    const namespace = encodeSegment(
      options.namespace ?? "filamentjs",
      "namespace",
    );
    const schemaVersion = options.schemaVersion ?? 1;
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new RangeError("schemaVersion must be a positive safe integer");
    }
    this.#prefix = `${namespace}:v${schemaVersion}`;
  }

  key(policy: string, ...segments: readonly string[]): string {
    const encoded = [
      this.#prefix,
      encodeSegment(policy, "policy"),
      ...segments.map((segment, index) =>
        encodeSegment(segment, `segment ${index}`),
      ),
    ];
    return encoded.join(":");
  }

  clusterKey(
    hashTag: string,
    policy: string,
    ...segments: readonly string[]
  ): string {
    const tag = encodeSegment(hashTag, "hashTag");
    const suffix = [
      encodeSegment(policy, "policy"),
      ...segments.map((segment, index) =>
        encodeSegment(segment, `segment ${index}`),
      ),
    ];
    return `${this.#prefix}:{${tag}}:${suffix.join(":")}`;
  }
}

export function createRedisKeyspace(
  options?: RedisKeyspaceOptions,
): RedisKeyspace {
  return new RedisKeyspace(options);
}
