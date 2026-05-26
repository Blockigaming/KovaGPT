export function NovaLogo({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <div
      className={`${className} rounded-full flex items-center justify-center text-white font-bold`}
      style={{
        background:
          "conic-gradient(from 180deg at 50% 50%, oklch(0.7 0.18 200), oklch(0.65 0.2 280), oklch(0.7 0.18 330), oklch(0.7 0.18 200))",
      }}
      aria-label="Nova GPT"
    >
      <svg viewBox="0 0 24 24" fill="none" className="w-1/2 h-1/2">
        <path
          d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"
          fill="white"
        />
      </svg>
    </div>
  );
}
