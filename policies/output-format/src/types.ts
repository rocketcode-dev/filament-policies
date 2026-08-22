export type Format = "json" | "yaml" | "jsonp";
export interface OutputFormatEndpointOptions {
  readonly enabled?: boolean;
  readonly allowed?: readonly Format[];
  readonly default?: Format;
  readonly jsonpCallbackQuery?: string;
}
export interface AppMeta {
  readonly outputFormat?: false | OutputFormatEndpointOptions;
}
export interface ContextMeta {
  outputFormat?: { readonly format: Format; readonly callback?: string };
}
export interface SetupOptions {
  readonly allowed?: readonly Format[];
  readonly default?: Format;
  readonly jsonpCallbackQuery?: string;
}
