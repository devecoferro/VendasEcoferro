import * as pdfjsLib from "pdfjs-dist";

/**
 * Extract embedded images from a PDF file using pdfjs-dist.
 * Returns an array of base64 data URLs for each image found, ordered by page and position.
 */
export async function extractImagesFromPdf(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const images: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const ops = await page.getOperatorList();
    const pageImages: string[] = [];

    for (let i = 0; i < ops.fnArray.length; i++) {
      // OPS.paintImageXObject = 85
      if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject) {
        const imgName = ops.argsArray[i][0];
        try {
          const img = await new Promise<any>((resolve, reject) => {
            (page as any).objs.get(imgName, (obj: any) => {
              if (obj) resolve(obj);
              else reject(new Error("Image object not found"));
            });
          });

          const dataUrl = imageDataToDataUrl(img);
          if (dataUrl) {
            pageImages.push(dataUrl);
          }
        } catch {
          // Skip images that can't be extracted
        }
      }
    }

    images.push(...pageImages);
    page.cleanup();
  }

  return images;
}

/**
 * Convert a pdfjs image object to a base64 data URL via an offscreen canvas.
 */
function imageDataToDataUrl(img: any): string | null {
  try {
    const { width, height, data, kind } = img;
    if (!width || !height || !data) return null;

    // Skip very small images (icons, bullets, decorations)
    if (width < 40 || height < 40) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    const imageData = ctx.createImageData(width, height);

    // kind 1 = GRAYSCALE, kind 2 = RGB, kind 3 = RGBA
    if (kind === 1) {
      // Grayscale → RGBA
      for (let j = 0; j < width * height; j++) {
        const v = data[j];
        imageData.data[j * 4] = v;
        imageData.data[j * 4 + 1] = v;
        imageData.data[j * 4 + 2] = v;
        imageData.data[j * 4 + 3] = 255;
      }
    } else if (kind === 2) {
      // RGB → RGBA
      for (let j = 0; j < width * height; j++) {
        imageData.data[j * 4] = data[j * 3];
        imageData.data[j * 4 + 1] = data[j * 3 + 1];
        imageData.data[j * 4 + 2] = data[j * 3 + 2];
        imageData.data[j * 4 + 3] = 255;
      }
    } else if (kind === 3) {
      // RGBA — copy directly
      imageData.data.set(data);
    } else {
      // Unknown kind — try treating as RGB
      if (data.length >= width * height * 3) {
        for (let j = 0; j < width * height; j++) {
          imageData.data[j * 4] = data[j * 3];
          imageData.data[j * 4 + 1] = data[j * 3 + 1];
          imageData.data[j * 4 + 2] = data[j * 3 + 2];
          imageData.data[j * 4 + 3] = 255;
        }
      } else {
        return null;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

/**
 * Render a specific page of a PDF as an image (fallback for scanned PDFs).
 * Crops out product image areas by rendering the full page.
 */
export async function renderPageAsImage(
  file: File,
  pageNum: number,
  scale: number = 1.5
): Promise<string | null> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;

    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    page.cleanup();
    return dataUrl;
  } catch {
    return null;
  }
}
