declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "*.wasm" {
  const mod: WebAssembly.Module;
  export default mod;
}
