import * as React from "react";
import { Body, Container, Heading, Html, Preview, Text } from "@react-email/components";
import { BrandFooter, BrandHeader, EmailHead, styles } from "./_brand";

interface ReauthenticationEmailProps {
  token: string;
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>Your KovaGPT verification code</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          Confirm it’s you
        </Heading>
        <Text className="kova-text" style={styles.text}>
          Enter this verification code in KovaGPT to continue. It expires shortly.
        </Text>
        <Text className="kova-code kova-text" style={styles.code}>
          {token}
        </Text>
        <Text className="kova-text" style={styles.text}>
          If you did not initiate this request, you can safely ignore this email.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default ReauthenticationEmail;
