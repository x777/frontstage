// ISO-BMFF (mp4/mov/m4a) starts with a box whose type at bytes 4-8 is "ftyp". Used to detect
// audio generations that arrive as muxed video (e.g. mmaudio) so they can land under .mp4.
export function sniffIsoBmff(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
}
