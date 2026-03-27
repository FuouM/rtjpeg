/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __RTJPEG_VERSION__: string;

declare module "*.wgsl?raw" {
  const source: string;
  export default source;
}
