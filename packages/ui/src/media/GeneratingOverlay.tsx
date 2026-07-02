import type { GenerationStatus } from "@palmier/core";
import { theme } from "../theme/theme.js";

export function generatingLabel(status: GenerationStatus): string {
  switch (status.kind) {
    case "preparing":
      return "Preparing...";
    case "downloading":
      return "Downloading...";
    case "rendering":
      return "Rendering...";
    default:
      return "Generating...";
  }
}


export function GeneratingOverlay({ label }: { label: string }) {
  return (
    <div
      data-testid="generating-overlay"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.xs,
        background: theme.generating.overlayBg,
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
          color: theme.text.primary,
          animation: `generating-shimmer ${theme.anim.shimmerDuration} ease-in-out infinite`,
        }}
      >
        {label}
      </span>
      <div
        style={{
          width: "60%",
          height: theme.borderWidth.thick,
          borderRadius: theme.radius.xs,
          background: theme.generating.track,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: 0,
            borderRadius: theme.radius.xs,
            background: theme.generating.fill,
            // --anim-progress-duration matches Swift GeneratingOverlay.progressDuration=45s — cosmetic easing, not real progress
            animation: `generating-progress-fill ${theme.anim.progressDuration} ease-out forwards`,
          }}
        />
      </div>
    </div>
  );
}
