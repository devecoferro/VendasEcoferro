import * as pdfjsLib from "pdfjs-dist";

interface ExtractedImage {
  dataUrl: string;
  pageNum: number;
  /** Y position on page (top of page = 0, increases downward) */
  yPosition: number;
  width: number;
  height: number;
}

/**
 * Extract embedded images from a PDF file using pdfjs-dist.
 * Tracks the vertical position of each image on the page so images
 * can be associated with the correct sale block.
 */
export async function extractImagesFromPdf(file: File): Promise<ExtractedImage[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allImages: ExtractedImage[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;
    const ops = await page.getOperatorList();

    // Track current transform matrix to determine image positions
    // The transform stack follows PDF graphics state
    const transformStack: number[][] = [];
    let currentTransform: number[] = [1, 0, 0, 1, 0, 0];

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];

      if (fn === pdfjsLib.OPS.save) {
        transformStack.push([...currentTransform]);
      } else if (fn === pdfjsLib.OPS.restore) {
        currentTransform = transformStack.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === pdfjsLib.OPS.transform) {
        const args = ops.argsArray[i];
        currentTransform = multiplyTransform(currentTransform, args);
      } else if (fn === pdfjsLib.OPS.paintImageXObject) {
        const imgName = ops.argsArray[i][0];
        try {
          const img = await new Promise<any>((resolve, reject) => {
            (page as any).objs.get(imgName, (obj: any) => {
              if (obj) resolve(obj);
              else reject(new Error("not found"));
            });
          });

          const dataUrl = imageDataToDataUrl(img);
          if (dataUrl) {
            // PDF Y-axis is bottom-up; convert to top-down
            const pdfY = currentTransform[5]; // ty in transform matrix
            const imgScaleY = Math.abs(currentTransform[3]); // scale Y from matrix
            const yFromTop = pageHeight - pdfY;

            allImages.push({
              dataUrl,
              pageNum,
              yPosition: yFromTop,
              width: img.width,
              height: img.height,
            });
          }
        } catch {
          // skip
        }
      }
    }

    page.cleanup();
  }

  // Sort by page then by vertical position (top to bottom)
  allImages.sort((a, b) => {
    if (a.pageNum !== b.pageNum) return a.pageNum - b.pageNum;
    return a.yPosition - b.yPosition;
  });

  return allImages;
}

/**
 * Given extracted images sorted by position and a count of sales,
 * return one "best" product image per sale slot.
 * 
 * Strategy: divide each page into equal vertical bands (one per sale on that page)
 * and assign each image to the nearest band. If multiple images land in the same band,
 * pick the largest one (most likely the product photo).
 */
export function associateImagesWith(
  images: ExtractedImage[],
  salesCount: number,
  salesPerPage: number = 5
): string[] {
  if (images.length === 0 || salesCount === 0) {
    return new Array(salesCount).fill("");
  }

  // Simple ordered association: filter to likely product images,
  // then assign one per sale in order.
  // Product images are typically square-ish and medium-sized.
  const productImages = images.filter((img) => {
    const aspectRatio = img.width / img.height;
    // Product photos are roughly square (0.5 to 2.0 aspect ratio)
    // and not tiny decorations
    return aspectRatio >= 0.3 && aspectRatio <= 3.0 && img.width >= 50 && img.height >= 50;
  });

  const result: string[] = [];
  for (let i = 0; i < salesCount; i++) {
    result.push(productImages[i]?.dataUrl || "");
  }
  return result;
}

/** Multiply two 2D affine transform matrices [a,b,c,d,e,f] */
function multiplyTransform(t1: number[], t2: number[]): number[] {
  return [
    t1[0] * t2[0] + t1[2] * t2[1],
    t1[1] * t2[0] + t1[3] * t2[1],
    t1[0] * t2[2] + t1[2] * t2[3],
    t1[1] * t2[2] + t1[3] * t2[3],
    t1[0] * t2[4] + t1[2] * t2[5] + t1[4],
    t1[1] * t2[4] + t1[3] * t2[5] + t1[5],
  ];
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

    if (kind === 1) {
      for (let j = 0; j < width * height; j++) {
        const v = data[j];
        imageData.data[j * 4] = v;
        imageData.data[j * 4 + 1] = v;
        imageData.data[j * 4 + 2] = v;
        imageData.data[j * 4 + 3] = 255;
      }
    } else if (kind === 2) {
      for (let j = 0; j < width * height; j++) {
        imageData.data[j * 4] = data[j * 3];
        imageData.data[j * 4 + 1] = data[j * 3 + 1];
        imageData.data[j * 4 + 2] = data[j * 3 + 2];
        imageData.data[j * 4 + 3] = 255;
      }
    } else if (kind === 3) {
      imageData.data.set(data);
    } else {
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
