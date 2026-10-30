// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphMenu = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="Menu" fill="currentColor" stroke="none">
      <path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm0 8a1 1 0 0 1 1-1h10a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z" />
    </g>
    {props.children}
  </svg>
);
