// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphDotsVertical = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="DotsVertical" fill="currentColor" stroke="none">
      <path d="M12 21a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0-7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm0-7a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z" />
    </g>
    {props.children}
  </svg>
);
