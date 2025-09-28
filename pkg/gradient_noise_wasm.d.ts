/* tslint:disable */
/* eslint-disable */
export function main(): void;
export class GradientGenerator {
  free(): void;
  [Symbol.dispose](): void;
  constructor();
  update_params(params_json: string): void;
  generate_gradient_data(width: number, height: number): Uint8Array;
  apply_color_preset(preset_name: string): void;
  randomize_colors(seed: number): void;
  get_params_json(): string;
  randomize_with_advanced_rng(seed: number, creativity_level: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_gradientgenerator_free: (a: number, b: number) => void;
  readonly gradientgenerator_new: () => number;
  readonly gradientgenerator_update_params: (a: number, b: number, c: number, d: number) => void;
  readonly gradientgenerator_generate_gradient_data: (a: number, b: number, c: number, d: number) => void;
  readonly gradientgenerator_apply_color_preset: (a: number, b: number, c: number) => void;
  readonly gradientgenerator_randomize_colors: (a: number, b: number) => void;
  readonly gradientgenerator_get_params_json: (a: number, b: number) => void;
  readonly gradientgenerator_randomize_with_advanced_rng: (a: number, b: number, c: number) => void;
  readonly main: () => void;
  readonly __wbindgen_export_0: (a: number, b: number, c: number) => void;
  readonly __wbindgen_export_1: (a: number, b: number) => number;
  readonly __wbindgen_export_2: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
