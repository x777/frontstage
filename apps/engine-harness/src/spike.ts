async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  try {
    if (!navigator.gpu) { status.textContent = "no-webgpu"; return; }
    let adapter = await navigator.gpu.requestAdapter({ powerPreference: "low-power" });
    if (!adapter) adapter = await navigator.gpu.requestAdapter({ forceFallbackAdapter: true });
    if (!adapter) { status.textContent = "no-adapter"; return; }
    const device = await adapter.requestDevice();
    const fmt = navigator.gpu.getPreferredCanvasFormat();
    const ctx = canvas.getContext("webgpu")!;
    ctx.configure({ device, format: fmt, alphaMode: "opaque" });

    // Pass 1: clear canvas to red
    const enc1 = device.createCommandEncoder();
    const pass = enc1.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.end();
    device.queue.submit([enc1.finish()]);
    await device.queue.onSubmittedWorkDone();

    // Readback uses a separate 1x1 rgba8unorm texture (not the display canvas) — this proves the GPU path runs, not the display surface contents.
    // Pass 2: use rgba8unorm texture for pixel readback (avoids bgra format issues)
    const readTex = device.createTexture({
      size: [1, 1],
      format: "rgba8unorm",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const enc2 = device.createCommandEncoder();
    const pass2 = enc2.beginRenderPass({
      colorAttachments: [{
        view: readTex.createView(),
        clearValue: { r: 1, g: 0, b: 0, a: 1 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass2.end();
    const bytesPerRow = 256; // WebGPU requires bytesPerRow to be a multiple of 256
    const readback = device.createBuffer({ size: bytesPerRow, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc2.copyTextureToBuffer({ texture: readTex }, { buffer: readback, bytesPerRow }, [1, 1]);
    device.queue.submit([enc2.finish()]);
    await readback.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(readback.getMappedRange(0, 4));
    canvas.dataset["pixel"] = `${data[0]!},${data[1]!},${data[2]!},${data[3]!}`;
    readback.unmap();

    status.textContent = "ok";
  } catch (e) {
    status.textContent = "error: " + (e as Error).message;
  }
}
void main();
