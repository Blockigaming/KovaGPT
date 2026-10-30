// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphChevronDown = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="ChevronDown" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M4.293 8.293a1 1 0 0 1 1.414 0L12 14.586l6.293-6.293a1 1 0 1 1 1.414 1.414l-7 7a1 1 0 0 1-1.414 0l-7-7a1 1 0 0 1 0-1.414Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
