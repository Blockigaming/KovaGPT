import { useState } from "react";
import { Download } from "lucide-react";

const campaigns = [
  { name: "Chat", headline: "Make the next idea count.", prompt: "Help me plan a new project.", lines: ["Define the goal", "Organize the next steps", "Review the plan"] },
  { name: "Search", headline: "Explore with context.", prompt: "Compare two approaches.", lines: ["Find relevant sources", "Compare the evidence", "Review the findings"] },
  { name: "Projects", headline: "Keep ideas together.", prompt: "Organize my design project.", lines: ["Project instructions", "Reference files", "Related conversations"] },
  { name: "Create", headline: "Turn ideas into visuals.", prompt: "Design a geometric poster.", lines: ["Describe the concept", "Choose a direction", "Review the result"] },
] as const;

type Campaign = (typeof campaigns)[number];

function draw(ctx: CanvasRenderingContext2D, campaign: Campaign, progress: number) {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.scale(width / 640, height / 360);
  const gradient = ctx.createLinearGradient(0, 0, 640, 360);
  gradient.addColorStop(0, "#10111a");
  gradient.addColorStop(1, "#34355e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 640, 360);
  ctx.fillStyle = "#c0c4e9";
  ctx.font = "600 17px sans-serif";
  ctx.fillText("KovaGPT / " + campaign.name, 30, 34);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 30px sans-serif";
  ctx.fillText(campaign.headline, 30, 78);
  ctx.fillStyle = "#30354d";
  ctx.fillRect(30, 104, 580, 49);
  ctx.fillStyle = "#ffffff";
  ctx.font = "18px sans-serif";
  ctx.fillText(campaign.prompt, 46, 135);
  campaign.lines.forEach((line, index) => {
    const opacity = Math.max(0.25, Math.min(1, (progress * 4 - index) * 1.6));
    ctx.globalAlpha = opacity;
    ctx.fillStyle = "#202434";
    ctx.fillRect(30, 166 + index * 45, 580, 37);
    ctx.fillStyle = "#b9c5ff";
    ctx.font = "600 15px sans-serif";
    ctx.fillText("0" + (index + 1), 46, 190 + index * 45);
    ctx.fillStyle = "#ffffff";
    ctx.font = "17px sans-serif";
    ctx.fillText(line, 84, 190 + index * 45);
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#c0c4e9";
  ctx.font = "13px sans-serif";
  ctx.fillText("kovagpt.com  •  Illustrative workflow", 30, 337);
  ctx.restore();
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// GIF89a with a fixed 3-3-2 RGB palette and bounded 9-bit LZW dictionary.
function gif(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, campaign: Campaign) {
  const bytes: number[] = [];
  const byte = (...values: number[]) => { bytes.push(...values); };
  const word = (value: number) => byte(value & 255, (value >> 8) & 255);
  const ascii = (value: string) => { for (const char of value) byte(char.charCodeAt(0)); };
  ascii("GIF89a");
  word(canvas.width);
  word(canvas.height);
  byte(0xf7, 0, 0);
  for (let i = 0; i < 256; i++) {
    byte(Math.round((i >> 5) * 255 / 7), Math.round(((i >> 2) & 7) * 255 / 7), (i & 3) * 85);
  }
  byte(0x21, 0xff, 11);
  ascii("NETSCAPE2.0");
  byte(3, 1, 0, 0, 0);
  for (let frame = 0; frame < 16; frame++) {
    draw(ctx, campaign, Math.min(1, frame / 12));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const color = (index: number) =>
      (pixels[index] & 224) | ((pixels[index + 1] & 224) >> 3) | (pixels[index + 2] >> 6);
    byte(0x21, 0xf9, 4, 4);
    word(15);
    byte(0, 0, 0x2c);
    word(0); word(0); word(canvas.width); word(canvas.height);
    byte(0, 8);
    const packed: number[] = [];
    let bits = 0, buffer = 0;
    const emit = (code: number) => {
      buffer |= code << bits;
      bits += 9;
      while (bits >= 8) {
        packed.push(buffer & 255);
        buffer >>>= 8;
        bits -= 8;
      }
    };
    let dictionary = new Map<number, number>();
    let next = 258;
    emit(256);
    let prefix = color(0);
    for (let i = 4; i < pixels.length; i += 4) {
      const value = color(i);
      const key = prefix * 256 + value;
      const existing = dictionary.get(key);
      if (existing !== undefined) {
        prefix = existing;
        continue;
      }
      emit(prefix);
      if (next < 500) dictionary.set(key, next++);
      else {
        emit(256);
        dictionary = new Map();
        next = 258;
      }
      prefix = value;
    }
    emit(prefix);
    emit(257);
    if (bits) packed.push(buffer & 255);
    for (let offset = 0; offset < packed.length; offset += 255) {
      const block = packed.slice(offset, offset + 255);
      byte(block.length, ...block);
    }
    byte(0);
  }
  byte(0x3b);
  return new Blob([Uint8Array.from(bytes)], { type: "image/gif" });
}

export function CampaignMedia() {
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const campaign = campaigns[selected];

  async function exportMedia(format: "gif" | "video") {
    setBusy(true);
    setMessage("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = format === "gif" ? 480 : 640;
      canvas.height = format === "gif" ? 270 : 360;
      const ctx = canvas.getContext("2d", { willReadFrequently: format === "gif" });
      if (!ctx) throw new Error("Canvas unavailable.");
      const name = "kovagpt-" + campaign.name.toLowerCase();
      if (format === "gif") {
        download(gif(canvas, ctx, campaign), name + ".gif");
      } else {
        if (typeof MediaRecorder === "undefined" || !canvas.captureStream) {
          throw new Error("Video export is not supported in this browser. Try GIF instead.");
        }
        const mimeType = ["video/mp4", "video/webm;codecs=vp8", "video/webm"].find(
          (type) => MediaRecorder.isTypeSupported(type),
        );
        if (!mimeType) throw new Error("No supported video format. Try GIF instead.");
        const stream = canvas.captureStream(24);
        try {
          draw(ctx, campaign, 0);
          const recorder = new MediaRecorder(stream, { mimeType });
          const chunks: Blob[] = [];
          recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
          const result = new Promise<Blob>((resolve, reject) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
            recorder.onerror = () => reject(new Error("Video recording failed."));
          });
          recorder.start();
          const start = performance.now();
          await new Promise<void>((resolve) => {
            const tick = (now: number) => {
              const progress = Math.min(1, (now - start) / 3200);
              draw(ctx, campaign, progress);
              if (progress < 1) requestAnimationFrame(tick);
              else resolve();
            };
            requestAnimationFrame(tick);
          });
          if (recorder.state !== "inactive") recorder.stop();
          const blob = await result;
          if (!blob.size) throw new Error("No video was recorded.");
          download(blob, name + (mimeType.includes("mp4") ? ".mp4" : ".webm"));
        } finally {
          stream.getTracks().forEach((track) => track.stop());
        }
      }
      setMessage("Export created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="kova-marketing-showcase" aria-label="Campaign media">
      <h2>Campaign media.</h2>
      <p>Original KovaGPT motion assets for product announcements and promotional use.</p>
      <div className="kova-marketing-tabs">
        {campaigns.map((item, index) => (
          <button
            key={item.name}
            type="button"
            aria-pressed={selected === index}
            disabled={busy}
            onClick={() => setSelected(index)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="kova-campaign-preview" key={campaign.name}>
        <p>KovaGPT / {campaign.name}</p>
        <h3>{campaign.headline}</h3>
        <div className="kova-marketing-prompt">{campaign.prompt}</div>
        <ol className="kova-marketing-steps">
          {campaign.lines.map((line, index) => (
            <li key={line} style={{ animationDelay: index * 450 + "ms" }}>
              <span aria-hidden="true">0{index + 1}</span>{line}
            </li>
          ))}
        </ol>
        <small>kovagpt.com · Illustrative workflow</small>
      </div>
      <div className="kova-marketing-tabs mt-4">
        <button type="button" disabled={busy} onClick={() => void exportMedia("gif")}>
          <Download size={16} aria-hidden="true" /> Download GIF
        </button>
        <button type="button" disabled={busy} onClick={() => void exportMedia("video")}>
          <Download size={16} aria-hidden="true" /> Export video
        </button>
      </div>
      <p role="status">{busy ? "Rendering campaign asset…" : message}</p>
    </section>
  );
}
