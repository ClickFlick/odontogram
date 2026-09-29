declare module 'gltfpack' {
  export function init(wasm: Promise<BufferSource> | BufferSource): void;
  export function pack(
    args: string[],
    iface: {
      read(path: string): Uint8Array;
      write(path: string, data: Uint8Array): void;
    },
  ): Promise<string>;
}
