// Literal pinned SDK glyph; see ../../reference-icons.LICENSE.
import type { SVGProps } from "react";

export const GlyphLock = (props: SVGProps<SVGSVGElement>) => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <g data-sdk-geometry="Lock" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M12 4a4 4 0 0 0-4 4h8a4 4 0 0 0-4-4Zm-6 6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H6Zm0-2a6 6 0 1 1 12 0 3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Zm4 6a2 2 0 1 1 3 1.732V17a1 1 0 1 1-2 0v-1.268A2 2 0 0 1 10 14Z"
        clipRule="evenodd"
      />
    </g>
    {props.children}
  </svg>
);
