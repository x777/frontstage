import { useState } from "react";

export function useHover(): { hovered: boolean; hoverProps: { onMouseEnter(): void; onMouseLeave(): void } } {
  const [hovered, setHovered] = useState(false);
  return {
    hovered,
    hoverProps: {
      onMouseEnter: () => setHovered(true),
      onMouseLeave: () => setHovered(false),
    },
  };
}
