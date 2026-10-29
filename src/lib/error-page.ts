export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light dark; --background: #ffffff; --foreground: #0d0d0d; --muted-foreground: #5d5d5d; --border: #00000014; --primary: #0d0d0d; --primary-foreground: #ffffff; --ring: #0285ff; }
      * { box-sizing: border-box; }
      body { font: 16px/1.5 ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; background: var(--background); color: var(--foreground); display: grid; place-items: center; min-height: 100vh; min-height: 100dvh; margin: 0; padding: 24px 16px; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 32px; border: 1px solid var(--border); border-radius: 24px; overflow-wrap: anywhere; }
      h1 { font-size: 32px; font-weight: 600; line-height: 38px; letter-spacing: -0.02em; margin: 0; }
      p { color: var(--muted-foreground); font-size: 14px; line-height: 20px; margin: 12px 0 24px; }
      .actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
      a, button { display: inline-flex; align-items: center; justify-content: center; min-width: 0; max-width: 100%; min-height: 48px; padding: 12px 16px; border-radius: 9999px; font: inherit; font-size: 14px; font-weight: 500; line-height: 20px; cursor: pointer; text-decoration: none; border: 1px solid transparent; overflow-wrap: anywhere; transition: background-color 150ms ease; }
      a:focus-visible, button:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
      .primary { background: var(--primary); color: var(--primary-foreground); }
      .primary:hover { background: color-mix(in srgb, var(--primary) 90%, transparent); }
      .secondary { background: transparent; color: var(--foreground); border-color: var(--border); }
      .secondary:hover { background: color-mix(in srgb, var(--foreground) 5%, transparent); }
      @media (prefers-color-scheme: dark) { :root { --background: #212121; --foreground: #ffffff; --muted-foreground: #afafaf; --border: #ffffff1f; --primary: #ffffff; --primary-foreground: #0d0d0d; --ring: #339cff; } }
      @media (max-width: 480px) { .card { padding: 24px; } h1 { font-size: 28px; line-height: 34px; } }
      @media (prefers-reduced-motion: reduce) { a, button { transition: none; } }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>
    </div>
  </body>
</html>`;
}
