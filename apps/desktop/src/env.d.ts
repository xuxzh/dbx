/// <reference types="vite/client" />

declare module "dom-to-image-more" {
  const domtoimage: {
    toPng(node: HTMLElement, options?: Record<string, any>): Promise<string>;
    toBlob(node: HTMLElement, options?: Record<string, any>): Promise<Blob>;
  };
  export default domtoimage;
}
