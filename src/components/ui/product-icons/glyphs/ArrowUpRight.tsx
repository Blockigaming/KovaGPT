// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphArrowUpRight = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="ArrowUpRight" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M16.243 6.757a1 1 0 0 1 1 1v7.072a1 1 0 0 1-2 0v-4.657L8.464 16.95a1 1 0 0 1-1.414-1.414l6.778-6.779H9.172a1 1 0 0 1 0-2h7.07Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
