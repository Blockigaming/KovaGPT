import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import { BrandFooter, BrandHeader, styles } from "./_brand";

interface ReauthenticationEmailProps {
  token: string;
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your verification code</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Confirm reauthentication</Heading>
        <Text style={styles.text}>
          Enter this verification code to continue. It expires shortly.
        </Text>
        <Text style={styles.code}>{token}</Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export default ReauthenticationEmail;
