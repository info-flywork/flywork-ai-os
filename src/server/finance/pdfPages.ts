import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createCanvas } from "@napi-rs/canvas";

const MAX_PAGES = 4;
const MAX_EDGE = 2200;
const HEADER_FRACTION = 0.58;
const FOOTER_FRACTION = 0.42;
const HEADER_MIN_HEIGHT = 500;

type PdfjsModule = {
  getDocument: (src: Record<string, unknown>) => {
    promise: Promise<{
      numPages: number;
      getPage: (page: number) => Promise<{
        getViewport: (params: { scale: number }) => { width: number; height: number };
        render: (params: { canvas: unknown; viewport: { width: number; height: number } }) => { promise: Promise<void> };
      }>;
      destroy: () => Promise<void>;
    }>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  setVerbosityLevel?: (level: number) => void;
  VerbosityLevel?: { ERRORS: number };
};

export async function renderPdfPages(bytes: Buffer): Promise<Buffer[]> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  const root = path.dirname(createRequire(path.join(process.cwd(), "package.json")).resolve("pdfjs-dist/package.json"));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, "legacy/build/pdf.worker.mjs")).href;
  pdfjs.setVerbosityLevel?.(pdfjs.VerbosityLevel?.ERRORS ?? 0);
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  const task = pdfjs.getDocument({
    data,
    cMapUrl: path.join(root, "cmaps") + path.sep,
    cMapPacked: true,
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
    isEvalSupported: false,
    useWasm: false,
    disableFontFace: true,
  });
  const document = await task.promise;
  const pages: Buffer[] = [];
  try {
    const total = Math.min(document.numPages, MAX_PAGES);
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_EDGE / Math.max(base.width, base.height, 1));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
      await page.render({ canvas, viewport }).promise;
      if (pageNumber === 1 && base.height >= HEADER_MIN_HEIGHT) {
        const cropHeight = Math.max(1, Math.ceil(canvas.height * HEADER_FRACTION));
        const crop = createCanvas(canvas.width, cropHeight);
        crop.getContext("2d").drawImage(canvas, 0, 0, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
        const header = crop.toBuffer("image/png");
        if (header.subarray(0, 4).toString("hex") === "89504e47") {
          pages.push(header);
        }
        const footerHeight = Math.max(1, Math.ceil(canvas.height * FOOTER_FRACTION));
        const footer = createCanvas(canvas.width, footerHeight);
        footer.getContext("2d").drawImage(
          canvas,
          0,
          canvas.height - footerHeight,
          canvas.width,
          footerHeight,
          0,
          0,
          canvas.width,
          footerHeight,
        );
        const footerPng = footer.toBuffer("image/png");
        if (footerPng.subarray(0, 4).toString("hex") === "89504e47") {
          pages.push(footerPng);
        }
      }
      const png = canvas.toBuffer("image/png");
      if (png.subarray(0, 4).toString("hex") === "89504e47") {
        pages.push(png);
      }
    }
  } finally {
    await document.destroy();
  }
  return pages;
}
