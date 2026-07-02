import { describe, expect, test } from "vitest";
import {
  FAL_QUEUE_BASE,
  falSubmitRequest,
  falStatusRequest,
  falResultRequest,
  parseFalSubmit,
  mapFalStatus,
  extractResultUrls,
  extractResultError,
  FAL_REST_BASE,
  falUploadInitiateRequest,
  parseFalUploadInitiate,
  isAllowedFalHost,
} from "../src/generation/fal-wire.js";
import { nextPollDelay } from "../src/generation/poll-schedule.js";

describe("FAL_QUEUE_BASE", () => {
  test("is the fal queue host", () => {
    expect(FAL_QUEUE_BASE).toBe("https://queue.fal.run");
  });
});

describe("falSubmitRequest", () => {
  test("builds the submit URL for a model endpoint", () => {
    const req = falSubmitRequest("fal-ai/veo3/fast", { prompt: "a cat" });
    expect(req.url).toBe("https://queue.fal.run/fal-ai/veo3/fast");
  });

  test("body is the JSON-encoded input", () => {
    const req = falSubmitRequest("fal-ai/veo3/fast", { prompt: "a cat" });
    expect(req.body).toBe(JSON.stringify({ prompt: "a cat" }));
  });
});

describe("falStatusRequest", () => {
  test("builds the status URL with the request id", () => {
    const req = falStatusRequest("fal-ai/veo3/fast", "abc123");
    expect(req.url).toBe("https://queue.fal.run/fal-ai/veo3/fast/requests/abc123/status");
  });
});

describe("falResultRequest", () => {
  test("builds the result URL with the request id", () => {
    const req = falResultRequest("fal-ai/veo3/fast", "abc123");
    expect(req.url).toBe("https://queue.fal.run/fal-ai/veo3/fast/requests/abc123");
  });
});

describe("parseFalSubmit", () => {
  test("reads request_id as jobId", () => {
    const result = parseFalSubmit({ request_id: "r1" });
    expect(result).toEqual({ jobId: "r1" });
  });

  test("missing request_id yields an error", () => {
    const result = parseFalSubmit({});
    expect("error" in result).toBe(true);
  });

  test("non-object input yields an error", () => {
    const result = parseFalSubmit(null);
    expect("error" in result).toBe(true);
  });
});

describe("mapFalStatus", () => {
  test("IN_QUEUE maps to queued", () => {
    expect(mapFalStatus({ status: "IN_QUEUE" })).toBe("queued");
  });

  test("IN_PROGRESS maps to running", () => {
    expect(mapFalStatus({ status: "IN_PROGRESS" })).toBe("running");
  });

  test("COMPLETED maps to completed", () => {
    expect(mapFalStatus({ status: "COMPLETED" })).toBe("completed");
  });

  test("anything else maps to unknown", () => {
    expect(mapFalStatus({ status: "ERROR" })).toBe("unknown");
    expect(mapFalStatus({})).toBe("unknown");
    expect(mapFalStatus(null)).toBe("unknown");
  });
});

describe("extractResultUrls", () => {
  test("{video:{url}} yields one url", () => {
    expect(extractResultUrls({ video: { url: "https://x/video.mp4" } })).toEqual(["https://x/video.mp4"]);
  });

  test("{images:[{url},{url}]} yields both urls in order", () => {
    const json = { images: [{ url: "https://x/1.png" }, { url: "https://x/2.png" }] };
    expect(extractResultUrls(json)).toEqual(["https://x/1.png", "https://x/2.png"]);
  });

  test("{audio:{url}} yields one url", () => {
    expect(extractResultUrls({ audio: { url: "https://x/audio.mp3" } })).toEqual(["https://x/audio.mp3"]);
  });

  test("{audio_file:{url}} yields one url", () => {
    expect(extractResultUrls({ audio_file: { url: "https://x/audio_file.mp3" } })).toEqual(["https://x/audio_file.mp3"]);
  });

  test("top-level {url} yields one url", () => {
    expect(extractResultUrls({ url: "x" })).toEqual(["x"]);
  });

  test("{} yields empty array", () => {
    expect(extractResultUrls({})).toEqual([]);
  });

  test("non-object json yields empty array", () => {
    expect(extractResultUrls(null)).toEqual([]);
    expect(extractResultUrls("nope")).toEqual([]);
  });

  test("video shape wins over other shapes when multiple present", () => {
    const json = { video: { url: "v" }, images: [{ url: "i" }] };
    expect(extractResultUrls(json)).toEqual(["v"]);
  });
});

describe("extractResultError", () => {
  test("reads error field", () => {
    expect(extractResultError({ error: "x" })).toBe("x");
  });

  test("reads detail field", () => {
    expect(extractResultError({ detail: "y" })).toBe("y");
  });

  test("reads message field", () => {
    expect(extractResultError({ message: "z" })).toBe("z");
  });

  test("no matching field yields undefined", () => {
    expect(extractResultError({})).toBeUndefined();
  });

  test("non-object json yields undefined", () => {
    expect(extractResultError(null)).toBeUndefined();
  });
});

describe("FAL_REST_BASE", () => {
  test("is the fal REST host", () => {
    expect(FAL_REST_BASE).toBe("https://rest.fal.ai");
  });
});

describe("falUploadInitiateRequest", () => {
  test("builds the initiate URL with the fal-cdn-v3 storage_type", () => {
    const req = falUploadInitiateRequest("image/png", "a.png");
    expect(req.url).toBe("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3");
  });

  test("body carries content_type and file_name", () => {
    const req = falUploadInitiateRequest("image/png", "a.png");
    expect(req.body).toBe(JSON.stringify({ content_type: "image/png", file_name: "a.png" }));
  });
});

describe("parseFalUploadInitiate", () => {
  test("reads upload_url/file_url", () => {
    const result = parseFalUploadInitiate({ upload_url: "https://u", file_url: "https://f" });
    expect(result).toEqual({ uploadUrl: "https://u", fileUrl: "https://f" });
  });

  test("missing upload_url yields an error", () => {
    expect("error" in parseFalUploadInitiate({ file_url: "https://f" })).toBe(true);
  });

  test("missing file_url yields an error", () => {
    expect("error" in parseFalUploadInitiate({ upload_url: "https://u" })).toBe(true);
  });

  test("non-object input yields an error", () => {
    expect("error" in parseFalUploadInitiate(null)).toBe(true);
  });
});

describe("isAllowedFalHost", () => {
  test("accepts fal.ai, fal.run, fal.media and their subdomains over https", () => {
    expect(isAllowedFalHost(new URL("https://rest.fal.ai/x"))).toBe(true);
    expect(isAllowedFalHost(new URL("https://fal.ai/x"))).toBe(true);
    expect(isAllowedFalHost(new URL("https://queue.fal.run/x"))).toBe(true);
    expect(isAllowedFalHost(new URL("https://fal.run/x"))).toBe(true);
    expect(isAllowedFalHost(new URL("https://v3.fal.media/x"))).toBe(true);
    expect(isAllowedFalHost(new URL("https://fal.media/x"))).toBe(true);
  });

  test("rejects an off-allowlist host", () => {
    expect(isAllowedFalHost(new URL("https://evil.com/x"))).toBe(false);
  });

  test("rejects http (non-https)", () => {
    expect(isAllowedFalHost(new URL("http://fal.media/x"))).toBe(false);
  });
});

describe("nextPollDelay", () => {
  test("undefined starts at 2000", () => {
    expect(nextPollDelay(undefined)).toBe(2000);
  });

  test("backoff sequence 2000 -> 3000 -> 4500 -> 6750 -> capped at 10000", () => {
    let delay: number | undefined = undefined;
    const seq: number[] = [];
    for (let i = 0; i < 6; i++) {
      delay = nextPollDelay(delay);
      seq.push(delay);
    }
    expect(seq).toEqual([2000, 3000, 4500, 6750, 10000, 10000]);
  });
});
