import * as React from "react";
import { Img, Section, Text } from "@react-email/components";

// Logo is served from the deployed KovaGPT domain so email clients can fetch it
// over a stable, branded URL (not a preview host).
<<<<<<< HEAD
export const KOVA_LOGO_URL = "https://kovagpt.com/email-logo.png";
export const KOVA_SITE_URL = "https://kovagpt.com";
=======
export const KOVA_LOGO_URL = 'https://kovagpt.com/email-logo.png'
export const KOVA_SITE_URL = 'https://kovagpt.com'
>>>>>>> origin/main

export const brandColors = {
  bg: "#ffffff",
  text: "#1a1a1a",
  muted: "#6b7280",
  border: "#e5e7eb",
  button: "#000000",
  buttonText: "#ffffff",
  link: "#2563eb",
};

export const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function BrandHeader() {
  return (
    <Section style={{ textAlign: "center", padding: "8px 0 24px" }}>
      <Img
        src={KOVA_LOGO_URL}
        width="56"
        height="56"
        alt="KovaGPT"
        style={{
          display: "inline-block",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
        }}
      />
      <Text
        style={{
          fontFamily: fontStack,
          fontSize: "14px",
          fontWeight: 600 as const,
          color: brandColors.text,
          letterSpacing: "-0.01em",
          margin: "10px 0 0",
        }}
      >
        KovaGPT
      </Text>
    </Section>
  );
}

export function BrandFooter() {
  return (
    <Section
      style={{
        borderTop: `1px solid ${brandColors.border}`,
        marginTop: "32px",
        paddingTop: "20px",
        textAlign: "center",
      }}
    >
      <Text
        style={{
          fontFamily: fontStack,
          fontSize: "11px",
          color: brandColors.muted,
          margin: "0 0 4px",
        }}
      >
        Sent by KovaGPT · {KOVA_SITE_URL.replace("https://", "")}
      </Text>
      <Text
        style={{
          fontFamily: fontStack,
          fontSize: "11px",
          color: brandColors.muted,
          margin: 0,
        }}
      >
        If you didn't request this email, you can safely ignore it.
      </Text>
    </Section>
  );
}

export const styles = {
  main: {
    backgroundColor: "#f6f7f9",
    fontFamily: fontStack,
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: brandColors.bg,
    border: `1px solid ${brandColors.border}`,
    borderRadius: "14px",
    maxWidth: "520px",
    margin: "0 auto",
    padding: "32px 32px 28px",
  },
  h1: {
    fontFamily: fontStack,
    fontSize: "22px",
    fontWeight: 700 as const,
    color: brandColors.text,
    letterSpacing: "-0.01em",
    margin: "0 0 14px",
    textAlign: "center" as const,
  },
  text: {
    fontFamily: fontStack,
    fontSize: "15px",
    lineHeight: "1.55",
    color: brandColors.text,
    margin: "0 0 18px",
  },
  buttonWrap: {
    textAlign: "center" as const,
    margin: "24px 0 18px",
  },
  button: {
    backgroundColor: brandColors.button,
    color: brandColors.buttonText,
    fontFamily: fontStack,
    fontSize: "15px",
    fontWeight: 600 as const,
    borderRadius: "10px",
    padding: "13px 26px",
    textDecoration: "none",
    display: "inline-block",
  },
  fallbackLabel: {
    fontFamily: fontStack,
    fontSize: "12px",
    color: brandColors.muted,
    margin: "4px 0 6px",
    textAlign: "center" as const,
  },
  fallbackLink: {
    fontFamily: fontStack,
    fontSize: "12px",
    color: brandColors.link,
    wordBreak: "break-all" as const,
    textAlign: "center" as const,
    display: "block",
    margin: "0 0 8px",
  },
  link: { color: brandColors.link, textDecoration: "underline" },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "26px",
    fontWeight: 700 as const,
    letterSpacing: "6px",
    color: brandColors.text,
    textAlign: "center" as const,
    background: "#f3f4f6",
    border: `1px solid ${brandColors.border}`,
    borderRadius: "10px",
    padding: "16px",
    margin: "0 0 18px",
  },
};
