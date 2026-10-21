# Standard consumer token reconciliation

The shared Button's default SVG size is20px. Standard Dialog mobile padding is24px, its Close remains44px with20px icon, and its footer adds8px to the existing16px parent gap. Dedicated fullscreen inspector/editor geometry remains explicitly scoped. Temporary Chat uses a semantic book for existing context rather than sparkle decoration. Phone toasts use the top-center region below the56px header (72px plus top safe area), maintaining16px side insets and avoiding overlap with expanded composers. Desktop toasts remain360px near the bottom right.

Projects loading uses its selected list structure or the same container-based1/2/3-column grid as populated cards, including shared gaps. Existing generic SkeletonGrid consumers preserve the original auto-fill default.

Source guards pass; affected native screenshots and toast/error interaction remain pending. These changes do not assert every consumer is already visually checked.
