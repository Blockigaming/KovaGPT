/**
 * Literal OpenAI Apps SDK UI glyphs, MIT licensed, pinned to
 * 0f00143c7a639906f1621fe58e1b6be7b5bea46d.
 * See reference-icons.LICENSE and docs/ui-reference-icons.json for each source.
 * Existing logical names are semantic aliases; contextual product parity is not claimed.
 */
import { forwardRef, type ComponentType, type SVGProps } from "react";

export interface LucideProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: string | number;
  absoluteStrokeWidth?: boolean;
}
export type LucideIcon = ReturnType<typeof makeIcon>;
type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

function filledState({ fill, className, style }: LucideProps) {
  return (
    /(?:^|\s)fill-current(?:$|\s)/.test(className ?? "") ||
    (fill !== undefined && fill !== "none" && fill !== "transparent") ||
    (style?.fill !== undefined && style.fill !== "none" && style.fill !== "transparent")
  );
}

export function makeIcon(name: string, source: string, DefaultGlyph: Glyph, FilledGlyph?: Glyph) {
  const Icon = /* @__PURE__ */ forwardRef<SVGSVGElement, LucideProps>(function ReferenceIcon(
    { size = 24, width, height, absoluteStrokeWidth: _absoluteStrokeWidth, ...props },
    ref,
  ) {
    const GlyphComponent = FilledGlyph && filledState(props) ? FilledGlyph : DefaultGlyph;
    return (
      <GlyphComponent
        aria-hidden={props["aria-label"] || props["aria-labelledby"] ? undefined : true}
        focusable="false"
        width={width ?? size}
        height={height ?? size}
        data-product-icon={name}
        data-ui-reference={`chatgpt.sdk.icon.${source}`}
        {...props}
        ref={ref}
      />
    );
  });
  Icon.displayName = name;
  return Icon;
}

export function makeLoader(name: string) {
  const Icon = /* @__PURE__ */ forwardRef<SVGSVGElement, LucideProps>(
    function ReferenceLoadingIndicator(
      {
        size = 24,
        width,
        height,
        strokeWidth = 2,
        absoluteStrokeWidth: _absoluteStrokeWidth,
        className,
        children,
        ...props
      },
      ref,
    ) {
      // The captured SDK indicator already rotates. Do not rotate its SVG wrapper too.
      const classes = className
        ?.split(/\s+/)
        .filter((value) => value !== "animate-spin")
        .join(" ");
      const stroke =
        typeof strokeWidth === "number" || /^\d+(?:\.\d+)?$/.test(String(strokeWidth))
          ? `${strokeWidth}px`
          : strokeWidth;
      return (
        <svg
          aria-hidden={props["aria-label"] || props["aria-labelledby"] ? undefined : true}
          focusable="false"
          width={width ?? size}
          height={height ?? size}
          fill="none"
          data-product-icon={name}
          data-ui-reference="chatgpt.sdk.loading-indicator"
          className={classes}
          {...props}
          ref={ref}
        >
          <foreignObject width="100%" height="100%">
            <div
              className="kova-reference-loading-indicator"
              style={{ "--indicator-stroke": stroke } as React.CSSProperties}
            />
          </foreignObject>
          {children}
        </svg>
      );
    },
  );
  Icon.displayName = name;
  return Icon;
}
