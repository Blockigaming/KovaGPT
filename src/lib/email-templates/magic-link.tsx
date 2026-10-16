import * as React from "react";
import {
  Body,
  Button,
  Container,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BrandFooter, BrandHeader, EmailHead, styles, brandColors } from "./_brand";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Sign in to {siteName}</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container
        className="kova-email-container"
        style={{
          ...styles.container,
          border: `1px solid ${brandColors.border}`,
          borderRadius: "18px",
        }}
      >
        <BrandHeader />
        <Text style={{ ...styles.label, color: "#7c3aed", marginBottom: "12px" }}>
          YOUR KOVA ACCOUNT
        </Text>
        <Heading className="kova-heading" style={{ ...styles.h1, fontSize: "28px" }}>
          Sign in to {siteName}
        </Heading>
        <Text className="kova-text" style={styles.text}>
          Welcome back. Use the button below to securely sign in and return to your saved work.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button
            className="kova-button"
            style={{
              ...styles.button,
              fontSize: "16px",
              lineHeight: "20px",
              padding: "16px 26px",
              borderRadius: "10px",
            }}
            href={confirmationUrl}
          >
            Continue to {siteName}
          </Button>
        </Section>
        <Text
          className="kova-muted"
          style={{ ...styles.text, color: brandColors.muted, fontSize: "14px" }}
        >
          This link expires shortly and works once. Open it in the browser where you want to use
          KovaGPT.
        </Text>
        <Text className="kova-muted" style={styles.fallbackLabel}>
          Button not opening?{" "}
          <Link
            className="kova-link"
            style={{ ...styles.link, color: "#7c3aed" }}
            href={confirmationUrl}
          >
            Open your secure sign-in link
          </Link>
          .
        </Text>
        <Text className="kova-muted" style={{ ...styles.fallbackLabel, marginTop: "20px" }}>
          If you did not request this email, you can ignore it. Your account has not been changed.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default MagicLinkEmail;
