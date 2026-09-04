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
import type { TemplateEntry } from "./registry";

interface Props {
  chatTitle?: string;
  senderName?: string;
  destinationUrl?: string;
}

const SharedChatEmail = ({
  chatTitle = "Shared chat",
  senderName = "A KovaGPT user",
  destinationUrl = "https://kovagpt.com/",
}: Props) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>
      {senderName} shared “{chatTitle}” with you
    </Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          A chat was shared with you
        </Heading>
        <Text className="kova-text" style={styles.text}>
          {senderName} shared the read-only KovaGPT snapshot “{chatTitle}” with you.
        </Text>
        <Text className="kova-text" style={styles.text}>
          Sign in with this email address, then open Library → Shared with me.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button className="kova-button" style={styles.button} href={destinationUrl}>
            Open KovaGPT
          </Button>
        </Section>
        <Text className="kova-muted" style={styles.fallbackLabel}>
          If the button does not work, copy and paste this link:
        </Text>
        <Link className="kova-link" style={styles.fallbackLink} href={destinationUrl}>
          {destinationUrl}
        </Link>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: SharedChatEmail,
  subject: (data: Record<string, unknown>) =>
    `${String(data.senderName || "A KovaGPT user").slice(0, 80)} shared a chat with you`,
  displayName: "Shared chat notification",
  previewData: {
    chatTitle: "Quarterly planning",
    senderName: "Alex",
    destinationUrl: "https://kovagpt.com/",
  },
} satisfies TemplateEntry;
