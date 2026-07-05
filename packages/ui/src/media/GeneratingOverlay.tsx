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
    case "transcribing":
      return "Transcribing...";
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
        // UI/GeneratingOverlay.swift Size.thumbnail.spacing (VStack spacing)
        gap: theme.spacing.smMd,
        background: theme.generating.overlayBg,
      }}
    >
      <span
        style={{
          fontSize: theme.fontSize.xs,
          fontWeight: theme.fontWeight.semibold,
          // Swift's .foregroundStyle(AppTheme.aiGradient) + ShimmerModifier — gradient-fill the text
          // and sweep a moving highlight across it, reusing the same recipe as AgentPanel's
          // streaming-indicator shimmer (M16E T1), not a plain opacity pulse.
          background: theme.gradients.ai,
          backgroundSize: "200% 100%",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          animation: `gradient-text-shimmer ${theme.anim.shimmerDuration} linear infinite`,
        }}
      >
        {label}
      </span>
      <div
        style={{
          // Size.thumbnail.barWidth/barHeight — Swift hardcodes an absolute bar size regardless of
          // the tile's own width, not a percentage of it.
          width: theme.generating.barW,
          height: theme.generating.barH,
          borderRadius: theme.radius.pill,
          background: theme.generating.track,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: 0,
            borderRadius: theme.radius.pill,
            background: theme.generating.fill,
            // --anim-progress-duration matches Swift GeneratingOverlay.progressDuration=45s — cosmetic easing, not real progress
            animation: `generating-progress-fill ${theme.anim.progressDuration} ease-out forwards`,
          }}
        />
      </div>
    </div>
  );
}
