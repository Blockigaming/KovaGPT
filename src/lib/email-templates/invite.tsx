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

interface InviteEmailProps {
  siteName: string;
  siteUrl: string;
  confirmationUrl: string;
}

export const InviteEmail = ({ siteName, confirmationUrl }: InviteEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>You have been invited to {siteName}</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          You’re invited
        </Heading>
        <Text className="kova-text" style={styles.text}>
          Accept your invitation to join {siteName} and finish setting up your account.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button className="kova-button" style={styles.button} href={confirmationUrl}>
            Accept invitation
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

export default InviteEmail;
