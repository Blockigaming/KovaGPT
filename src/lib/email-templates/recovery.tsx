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

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your {siteName} password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Reset your password</Heading>
        <Text style={styles.text}>
          Use the button below to choose a new password for your {siteName}
          {" "}account. This link expires shortly.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmationUrl}>
            Reset password
          </Button>
        </Section>
        <Text style={styles.fallbackLabel}>Or paste this link in your browser:</Text>
        <Link style={styles.fallbackLink} href={confirmationUrl}>
          {confirmationUrl}
        </Link>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default RecoveryEmail;
