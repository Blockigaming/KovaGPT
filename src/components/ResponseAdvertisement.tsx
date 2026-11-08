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
  googlefc?: {
    callbackQueue: { push: (entry: Record<string, () => void>) => unknown };
    showRevocationMessage?: () => void;
    usstatesoptout?: { openConfirmationDialog?: (callback: (optedOut: boolean) => void) => void };
  };
  __tcfapi?: TcfApi;
  adsbygoogle?: {
    push: (entry: Record<string, unknown>) => void;
    requestNonPersonalizedAds?: number;
  };
};
let scriptReady: Promise<void> | undefined;
function loadAdScript() {
  return (scriptReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
    if (!nonce) {
      reject(new Error("Advertising requires a fresh nonce-enabled document"));
      return;
    }
    script.nonce = nonce;
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
  const [consentReady, setConsentReady] = useState(false);
  const [gdprApplies, setGdprApplies] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [failed, setFailed] = useState(false);
  const unit = useRef<HTMLModElement>(null);
  const requested = useRef<HTMLModElement | null>(null);
  const privacyBlocked =
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const eligible = tier === "free" && status === "ready" && !privacyBlocked;
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    void getAdSenseConfiguration()
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
    const adWindow = window as AdWindow;
    const fc = (adWindow.googlefc ??= { callbackQueue: [] as Array<Record<string, () => void>> });
    let active = true;
    let listenerId: number | undefined;
    let api: TcfApi | undefined;
    const attachConsent = () => {
      if (!active || api) return;
      api = adWindow.__tcfapi;
      if (!api) return;
      try {
        api("addEventListener", 2, (data, success) => {
          if (!active) return;
          listenerId = data?.listenerId;
          setConsentReady(success && data?.cmpStatus === "loaded");
          setGdprApplies(data?.gdprApplies !== false);
          setConsented(hasAdSenseConsent(data, success));
        });
      } catch {
        setFailed(true);
      }
    };
    // Google's AdSense tag deploys its published CMP. Install the callback
    // before loading it; push no ad unit until the CMP has settled consent.
    try {
      fc.callbackQueue.push({ CONSENT_API_READY: attachConsent });
    } catch {
      setFailed(true);
      return;
    }
    attachConsent();
    const ads = (adWindow.adsbygoogle ??= [] as unknown as NonNullable<AdWindow["adsbygoogle"]>);
    ads.requestNonPersonalizedAds = 1;
    void loadAdScript().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      try {
        if (listenerId !== undefined && api) api("removeEventListener", 2, () => {}, listenerId);
      } catch {
        /* Vendor cleanup failure must not interrupt the conversation. */
      }
    };
  }, [eligible, enabled]);
  const show = eligible && enabled && consented && !failed;
  useEffect(() => {
    if (
      !show ||
      !unit.current ||
      requested.current === unit.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
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
  const canManageConsent = eligible && enabled && consentReady && !failed;
  if (!show && !canManageConsent) return null;
  return (
    <aside
      aria-label="Advertisement"
      className="my-6 overflow-hidden rounded-xl border border-border p-3"
      data-response-ad
    >
      {show && <p className="mb-3 text-xs text-muted-foreground">Advertisements</p>}
      {show && (
        <ins
          ref={unit}
          className="adsbygoogle"
          style={{ display: "block", minHeight: 100 }}
          data-ad-client="ca-pub-5973080139144902"
          data-ad-slot="4116284418"
          data-ad-format="auto"
          data-restrict-data-processing="1"
          data-tag-for-age-treatment="2"
          data-full-width-responsive="true"
        />
      )}
      {canManageConsent && (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2"
          onClick={() => {
            setConsented(false);
            const fc = (window as AdWindow).googlefc;
            try {
              fc?.callbackQueue.push({
                [gdprApplies ? "CONSENT_API_READY" : "INITIAL_US_STATES_OPT_OUT_DATA_READY"]:
                  () => {
                    if (gdprApplies) fc.showRevocationMessage?.();
                    else
                      fc.usstatesoptout?.openConfirmationDialog?.((optedOut) => {
                        if (!optedOut) setConsented(true);
                      });
                  },
              });
            } catch {
              setFailed(true);
            }
          }}
        >
          Privacy and cookie settings
        </button>
      )}
    </aside>
  );
}
