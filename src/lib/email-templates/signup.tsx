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

interface SignupEmailProps {
  siteName: string;
  siteUrl: string;
  recipient: string;
  confirmationUrl: string;
}

export const SignupEmail = ({ siteName, recipient, confirmationUrl }: SignupEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your email for {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Confirm your email</Heading>
        <Text style={styles.text}>
          Thanks for joining {siteName}. Please confirm{" "}
          <Link href={`mailto:${recipient}`} style={styles.link}>
            {recipient}
          </Link>{" "}
          so we can finish setting up your account.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmationUrl}>
            Verify email
          </Button>
        </Section>
        <Text style={styles.fallbackLabel}>Button not working? Use this link:</Text>
        <Link href={confirmationUrl} style={styles.fallbackLink}>
          {confirmationUrl}
        </Link>
        <Text style={{ ...styles.text, fontSize: "13px", color: "#6b7280", margin: "18px 0 0" }}>
          If you didn't create a KovaGPT account, you can safely ignore this email.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default SignupEmail;
