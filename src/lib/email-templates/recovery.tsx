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

interface RecoveryEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Reset your {siteName} password</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          Reset your password
        </Heading>
        <Text className="kova-text" style={styles.text}>
          We received a request to reset your {siteName} password. Use the secure link below to
          choose a new one.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button className="kova-button" style={styles.button} href={confirmationUrl}>
            Reset password
          </Button>
        </Section>
        <Text className="kova-text" style={styles.text}>
          If you did not request a password reset, you can safely ignore this email.
        </Text>
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

export default RecoveryEmail;
