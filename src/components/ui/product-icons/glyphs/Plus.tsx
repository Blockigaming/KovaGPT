// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphPlus = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="Plus" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
