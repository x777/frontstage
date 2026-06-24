import type { ImageRequest, ImageResult } from "./wire.js";

export function buildImageBody(req: ImageRequest): object {
  const content: unknown[] = [{ type: "text", text: req.prompt }];
  for (const img of req.referenceImages ?? []) {
    content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
  }
  return {
    model: req.model,
    modalities: ["image", "text"],
    stream: false,
    messages: [{ role: "user", content }],
  };
}

export function parseImageResponse(json: unknown): ImageResult {
  try {
    const j = json as Record<string, unknown>;
    const choices = j?.["choices"];
    if (!Array.isArray(choices) || choices.length === 0) return { images: [] };
    const message = (choices[0] as Record<string, unknown>)?.["message"] as Record<string, unknown> | undefined;
    if (!message) return { images: [] };
    const imgs = message["images"];
    if (!Array.isArray(imgs)) return { images: [] };
    const images: { base64: string; mediaType: string }[] = [];
    for (const img of imgs) {
      try {
        const imgRecord = img as Record<string, unknown>;
        const imageUrl = imgRecord?.["image_url"] as Record<string, unknown> | undefined;
        const url = imageUrl?.["url"] as string | undefined;
        if (typeof url !== "string" || !url.startsWith("data:")) continue;
        // data:<mediaType>;base64,<data>
        const withoutPrefix = url.slice(5); // strip "data:"
        const semicolonIdx = withoutPrefix.indexOf(";");
        if (semicolonIdx === -1) continue;
        const mediaType = withoutPrefix.slice(0, semicolonIdx);
        const afterSemicolon = withoutPrefix.slice(semicolonIdx + 1);
        if (!afterSemicolon.startsWith("base64,")) continue;
        const base64 = afterSemicolon.slice(7);
        images.push({ base64, mediaType });
      } catch {
        // skip malformed entries
      }
    }
    return { images };
  } catch {
    return { images: [] };
  }
}
