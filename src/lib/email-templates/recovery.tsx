import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BrandFooter, BrandHeader, styles } from "./_brand";

interface RecoveryEmailProps {
  siteName: string;
  confirmationUrl: string;
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your {siteName} password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Reset your password</Heading>
        <Text style={styles.text}>
          We received a request to reset the password for your {siteName} account. Click the button
          below to choose a new password. This link expires in 60 minutes.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmationUrl}>
            Reset password
          </Button>
        </Section>
        <Text style={styles.fallbackLabel}>Button not working? Use this link:</Text>
        <Link href={confirmationUrl} style={styles.fallbackLink}>
          {confirmationUrl}
        </Link>
        <Text style={{ ...styles.text, fontSize: "13px", color: "#6b7280", margin: "18px 0 0" }}>
          If you didn't request a password reset, you can safely ignore this email and your password
          will remain unchanged.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default RecoveryEmail;
