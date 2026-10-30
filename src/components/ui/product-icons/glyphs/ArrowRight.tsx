// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphArrowRight = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="ArrowRight" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M18.707 12.707a1 1 0 0 0 0-1.414l-5-5a1 1 0 1 0-1.414 1.414L15.586 11H6a1 1 0 1 0 0 2h9.586l-3.293 3.293a1 1 0 0 0 1.414 1.414l5-5Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
