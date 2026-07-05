import { expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "../src/primitives/index.js";

test("Icon renders an svg with currentColor stroke at the requested size", () => {
  const r = render(<Icon name="folder" size={26} testid="ic" />);
  const svg = r.getByTestId("ic");
  expect(svg.tagName.toLowerCase()).toBe("svg");
  expect(svg.getAttribute("width")).toBe("26");
  expect(svg.getAttribute("stroke")).toBe("currentColor");
});

test("every declared IconName renders a non-empty path set", () => {
  const names = ["folder","captions","plus","sparkles","search","ellipsis","grid","list","x","chevron-right","chevron-down","play","pause","step-back","step-forward","eye","eye-off","lock","lock-open","volume","volume-off","grip","diamond","diamond-filled"] as const;
  for (const n of names) {
    const r = render(<Icon name={n} testid={`i-${n}`} />);
    expect(r.getByTestId(`i-${n}`).innerHTML.length).toBeGreaterThan(10);
  }
});
