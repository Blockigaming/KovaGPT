import { useTier } from "@/hooks/useTier";
import { hasAdSenseConsent } from "@/lib/adsense-policy.mjs";
import { useEffect, useRef, useState } from "react";
import { getAdSenseConfiguration } from "@/lib/adsense.functions";

type Consent = {
  eventStatus?: string;
  cmpStatus?: string;
  gdprApplies?: boolean;
  purpose?: { consents?: Record<string, boolean> };
  vendor?: { consents?: Record<string, boolean> };
  listenerId?: number;
};
type TcfApi = (
  command: string,
  version: number,
  callback: (data: Consent, success: boolean) => void,
  parameter?: number,
) => void;
type AdWindow = Window & {
  __tcfapi?: TcfApi;
  adsbygoogle?: {
    push: (entry: Record<string, unknown>) => void;
    requestNonPersonalizedAds?: number;
  };
};
let configuration: ReturnType<typeof getAdSenseConfiguration> | undefined;
let scriptReady: Promise<void> | undefined;
function loadAdScript() {
  return (scriptReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    script.src =
      "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5973080139144902";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Ad unavailable"));
    document.head.append(script);
  }));
}

/** A separate presentation surface: never modifies prompts, response text, or exports. */
export function ResponseAdvertisement() {
  const { tier, status } = useTier();
  const [consented, setConsented] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const unit = useRef<HTMLModElement>(null);
  const requested = useRef<HTMLModElement | null>(null);
  const eligible = tier === "free" && status === "ready";
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    configuration ??= getAdSenseConfiguration();
    void configuration
      .then((value) => {
        if (active) setEnabled(value.enabled);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [eligible]);
  useEffect(() => {
    if (!eligible || !enabled) return;
    const api = (window as AdWindow).__tcfapi;
    // No certified CMP, no ads. Do not guess consent from locale or storage.
    if (!api) return;
    let active = true;
    let listenerId: number | undefined;
    api("addEventListener", 2, (data, success) => {
      if (!active) return;
      listenerId = data.listenerId;
      setConsented(hasAdSenseConsent(data, success));
    });
    return () => {
      active = false;
      if (listenerId !== undefined) api("removeEventListener", 2, () => {}, listenerId);
    };
  }, [eligible, enabled]);
  const show = eligible && enabled && consented && !failed;
  useEffect(() => {
    if (!show || !unit.current || requested.current === unit.current) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void loadAdScript()
          .then(() => {
            if (
              !active ||
              !unit.current ||
              requested.current === unit.current ||
              unit.current.clientWidth === 0
            )
              return;
            requested.current = unit.current;
            const ads = ((window as AdWindow).adsbygoogle ??= [] as unknown as NonNullable<
              AdWindow["adsbygoogle"]
            >);
            // Contextual/non-personalized delivery; no chat-derived targeting payload.
            ads.requestNonPersonalizedAds = 1;
            ads.push({});
          })
          .catch(() => {
            if (active) setFailed(true);
          });
      },
      { rootMargin: "100px" },
    );
    observer.observe(unit.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [show]);
  if (!show) return null;
  return (
    <aside
      aria-label="Advertisement"
      className="my-6 overflow-hidden rounded-xl border border-border p-3"
      data-response-ad
    >
      <p className="mb-3 text-xs text-muted-foreground">Advertisements</p>
      <ins
        ref={unit}
        className="adsbygoogle"
        style={{ display: "block", minHeight: 100 }}
        data-ad-client="ca-pub-5973080139144902"
        data-ad-slot="4116284418"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
