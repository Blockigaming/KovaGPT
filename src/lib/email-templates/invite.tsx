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

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
}

export const InviteEmail = ({ siteName, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You have been invited to {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>You have been invited</Heading>
        <Text style={styles.text}>
          Accept your invitation to join {siteName} and set up your account.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmationUrl}>
            Accept invitation
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

export default InviteEmail;
