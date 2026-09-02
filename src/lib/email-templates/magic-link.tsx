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
import { BrandFooter, BrandHeader, EmailHead, styles } from "./_brand";

interface MagicLinkEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Sign in to {siteName}</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          Sign in to {siteName}
        </Heading>
        <Text className="kova-text" style={styles.text}>
          Use the secure link below to sign in. This link expires shortly and can only be used once.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button className="kova-button" style={styles.button} href={confirmationUrl}>
            Continue to {siteName}
          </Button>
        </Section>
        <Text className="kova-muted" style={styles.fallbackLabel}>
          If the button does not work, copy and paste this link:
        </Text>
        <Link className="kova-link" style={styles.fallbackLink} href={confirmationUrl}>
          {confirmationUrl}
        </Link>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default MagicLinkEmail;
