import type { ComponentType, ReactNode } from "react";

export type SidebarGlyph = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// Original navigation glyphs share an optical grid and a quiet, rounded stroke.
// Button/link labels carry the accessible names; branding lives outside this family.
function glyph(shape: ReactNode): SidebarGlyph {
  return function SidebarGlyphIcon(props) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        data-kova-navigation-glyph=""
        {...props}
      >
        {shape}
      </svg>
    );
  };
}

export const NewChatGlyph = glyph(
  <>
    <path d="M10 4.5H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25V14" />
    <path d="m11.5 14 1-3.5 5.6-5.6a1.7 1.7 0 0 1 2.4 2.4l-5.6 5.6-3.4 1.1Z" />
  </>,
);

export const LibraryGlyph = glyph(
  <>
    <path d="M12 6.3C9.9 4.8 6.8 4.1 3.5 4.8v13.8c3.3-.7 6.4 0 8.5 1.5 2.1-1.5 5.2-2.2 8.5-1.5V4.8c-3.3-.7-6.4 0-8.5 1.5Z" />
    <path d="M12 6.3v13.8" />
  </>,
);

export const ProjectsGlyph = glyph(
  <path d="M3.5 7.2V6A2 2 0 0 1 5.5 4h3.7c.6 0 1.1.2 1.5.6l1.8 1.8c.4.4.9.6 1.5.6h4.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.2Z" />,
);

export const ImagesGlyph = glyph(
  <>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" stroke="none" />
    <path d="m4 17 4.1-4.1a1.5 1.5 0 0 1 2.1 0l2.1 2.1 2.7-2.7a1.5 1.5 0 0 1 2.1 0l3.4 3.4" />
  </>,
);

export const TasksGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </>,
);

export const PluginsGlyph = glyph(
  <>
    <path d="M8.5 3.5v4m7-4v4M6.5 7.5h11V10a5.5 5.5 0 0 1-11 0V7.5Z" />
    <path d="M12 15.5v2a3 3 0 0 1-3 3H7.5" />
  </>,
);

export const SidebarGlyphIcon = glyph(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9 4.5v15" />
  </>,
);

export const SearchGlyph = glyph(
  <>
    <circle cx="10.75" cy="10.75" r="6.75" />
    <path d="m16 16 4.5 4.5" />
  </>,
);

export const SettingsGlyph = glyph(
  <>
    <path d="M10.4 4h3.2l.7 2.2 1.5.9 2.3-.5 1.6 2.8-1.6 1.7v1.8l1.6 1.7-1.6 2.8-2.3-.5-1.5.9-.7 2.2h-3.2l-.7-2.2-1.5-.9-2.3.5-1.6-2.8 1.6-1.7v-1.8L4.3 9.4l1.6-2.8 2.3.5 1.5-.9.7-2.2Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const MoreGlyph = glyph(
  <>
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </>,
);

export const CustomizeGlyph = glyph(
  <>
    <path d="M3.5 7.5H7m5 0h8.5m-17 9H12m5 0h3.5" />
    <circle cx="9.5" cy="7.5" r="2.5" />
    <circle cx="14.5" cy="16.5" r="2.5" />
  </>,
);
