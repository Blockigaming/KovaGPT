// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphArrowLeft = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="ArrowLeft" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M5.293 12.707a1 1 0 0 1 0-1.414l5-5a1 1 0 1 1 1.414 1.414L8.414 11H18a1 1 0 1 1 0 2H8.414l3.293 3.293a1 1 0 0 1-1.414 1.414l-5-5Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
