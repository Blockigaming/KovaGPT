import * as React from "react";
import { Column, Head, Img, Link, Row, Section, Text } from "@react-email/components";

export const KOVA_LOGO_URL = "https://kovagpt.com/kova-logo.png";
export const KOVA_SITE_URL = "https://kovagpt.com";

export const brandColors = {
  bg: "#ffffff",
  text: "#202123",
  muted: "#6e6e80",
  subtle: "#f7f7f8",
  border: "#e5e5e5",
  button: "#202123",
  buttonText: "#ffffff",
  link: "#2563eb",
};

export const fontStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const adaptiveCss = `
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .kova-email-body, .kova-email-container { background-color: #ffffff !important; }
  @media (prefers-color-scheme: dark) {
    .kova-email-body, .kova-email-container { background-color: #212121 !important; }
    .kova-email-container .kova-text,
    .kova-email-container .kova-heading,
    .kova-email-container .kova-brand { color: #ececec !important; }
    .kova-email-container .kova-muted { color: #b4b4b4 !important; }
    .kova-email-container .kova-link { color: #8ab4f8 !important; }
    .kova-email-container .kova-button { background-color: #ececec !important; color: #171717 !important; }
    .kova-email-container .kova-card,
    .kova-email-container .kova-code { background-color: #2f2f2f !important; border-color: #424242 !important; }
    .kova-email-container .kova-divider { border-color: #424242 !important; }
  }
  [data-ogsc] .kova-email-body,
  [data-ogsc] .kova-email-container { background-color: #212121 !important; }
  [data-ogsc] .kova-text,
  [data-ogsc] .kova-heading,
  [data-ogsc] .kova-brand { color: #ececec !important; }
  [data-ogsc] .kova-muted { color: #b4b4b4 !important; }
  [data-ogsc] .kova-link { color: #8ab4f8 !important; }
  [data-ogsc] .kova-button { background-color: #ececec !important; color: #171717 !important; }
  [data-ogsc] .kova-card,
  [data-ogsc] .kova-code { background-color: #2f2f2f !important; border-color: #424242 !important; }
  [data-ogsc] .kova-divider { border-color: #424242 !important; }
  @media only screen and (max-width: 620px) {
    .kova-email-container { padding-left: 22px !important; padding-right: 22px !important; }
  }
`;

export function EmailHead() {
  return (
    <Head>
      <meta name="color-scheme" content="light dark" />
      <meta name="supported-color-schemes" content="light dark" />
      <style>{adaptiveCss}</style>
    </Head>
  );
}

export function BrandHeader() {
  return (
    <Section style={{ padding: "0 0 32px" }}>
      <Row>
        <Column style={{ width: "36px", verticalAlign: "middle" }}>
          <Img
            src={KOVA_LOGO_URL}
            width="30"
            height="30"
            alt="KovaGPT"
            style={{
              display: "block",
              width: "30px",
              height: "30px",
              borderRadius: "50%",
            }}
          />
        </Column>
        <Column style={{ verticalAlign: "middle" }}>
          <Text
            className="kova-brand"
            style={{
              fontFamily: fontStack,
              fontSize: "18px",
              fontWeight: 600 as const,
              color: brandColors.text,
              letterSpacing: "-0.02em",
              margin: 0,
            }}
          >
            KovaGPT
          </Text>
        </Column>
      </Row>
    </Section>
  );
}

export function BrandFooter() {
  return (
    <Section
      className="kova-divider"
      style={{
        borderTop: `1px solid ${brandColors.border}`,
        marginTop: "36px",
        paddingTop: "22px",
      }}
    >
      <Text className="kova-muted" style={styles.footerText}>
        KovaGPT will never ask you to reply with your password or verification code.
      </Text>
      <Text className="kova-muted" style={styles.footerText}>
        <Link className="kova-link" href="mailto:support@kovagpt.com" style={styles.footerLink}>
          Support
        </Link>
        {"  ·  "}
        <Link className="kova-link" href={`${KOVA_SITE_URL}/privacy`} style={styles.footerLink}>
          Privacy
        </Link>
        {"  ·  "}
        <Link className="kova-link" href={`${KOVA_SITE_URL}/terms`} style={styles.footerLink}>
          Terms
        </Link>
      </Text>
      <Text className="kova-muted" style={styles.footerText}>
        © KovaGPT
      </Text>
    </Section>
  );
}

export const styles = {
  main: {
    backgroundColor: brandColors.bg,
    color: brandColors.text,
    fontFamily: fontStack,
    margin: 0,
    padding: "24px 0",
  },
  container: {
    backgroundColor: brandColors.bg,
    maxWidth: "560px",
    margin: "0 auto",
    padding: "36px 32px 40px",
  },
  h1: {
    fontFamily: fontStack,
    fontSize: "24px",
    lineHeight: "1.25",
    fontWeight: 600 as const,
    color: brandColors.text,
    letterSpacing: "-0.025em",
    margin: "0 0 18px",
    textAlign: "left" as const,
  },
  text: {
    fontFamily: fontStack,
    fontSize: "15px",
    lineHeight: "1.6",
    color: brandColors.text,
    margin: "0 0 18px",
  },
  buttonWrap: { margin: "26px 0 22px" },
  button: {
    backgroundColor: brandColors.button,
    color: brandColors.buttonText,
    fontFamily: fontStack,
    fontSize: "14px",
    lineHeight: "1",
    fontWeight: 600 as const,
    borderRadius: "6px",
    padding: "14px 22px",
    textDecoration: "none",
    display: "inline-block",
  },
  fallbackLabel: {
    fontFamily: fontStack,
    fontSize: "12px",
    lineHeight: "1.5",
    color: brandColors.muted,
    margin: "0 0 6px",
  },
  fallbackLink: {
    fontFamily: fontStack,
    fontSize: "12px",
    lineHeight: "1.5",
    color: brandColors.link,
    wordBreak: "break-all" as const,
    display: "block",
    margin: "0 0 8px",
  },
  link: { color: brandColors.link, textDecoration: "underline" },
  footerText: {
    fontFamily: fontStack,
    fontSize: "11px",
    lineHeight: "1.55",
    color: brandColors.muted,
    margin: "0 0 7px",
  },
  footerLink: { color: brandColors.muted, textDecoration: "underline" },
  card: {
    backgroundColor: brandColors.subtle,
    border: `1px solid ${brandColors.border}`,
    borderRadius: "8px",
    padding: "14px 16px",
    margin: "8px 0 22px",
  },
  label: {
    fontFamily: fontStack,
    fontSize: "11px",
    lineHeight: "1.5",
    fontWeight: 600 as const,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: brandColors.muted,
    margin: "0 0 4px",
  },
  code: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "26px",
    fontWeight: 700 as const,
    letterSpacing: "6px",
    color: brandColors.text,
    textAlign: "center" as const,
    backgroundColor: brandColors.subtle,
    border: `1px solid ${brandColors.border}`,
    borderRadius: "8px",
    padding: "16px",
    margin: "0 0 18px",
  },
};
