import * as React from "react";
import {
  Body,
  Container,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BrandFooter, BrandHeader, EmailHead, brandColors, styles } from "./_brand";
import type { TemplateEntry } from "./registry";

interface Props {
  name?: string;
  email?: string;
  topic?: string;
  message?: string;
  variant?: "help" | "bug";
  url?: string;
  userAgent?: string;
}

const Email = ({
  name = "Unknown",
  email = "unknown@example.com",
  topic = "(no subject)",
  message = "",
  variant = "help",
  url = "",
  userAgent = "",
}: Props) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>
      {variant === "bug" ? "New bug report" : "New help request"} from {name}
    </Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          {variant === "bug" ? "Bug report" : "Help request"}
        </Heading>
        <Text className="kova-muted" style={{ ...styles.text, color: brandColors.muted }}>
          From {name} &lt;{email}&gt;
        </Text>
        <Hr
          className="kova-divider"
          style={{ borderColor: brandColors.border, margin: "22px 0" }}
        />
        <Section>
          <Text className="kova-muted" style={styles.label}>
            Topic
          </Text>
          <Text className="kova-text" style={styles.text}>
            {topic}
          </Text>
          <Text className="kova-muted" style={styles.label}>
            Message
          </Text>
          <Text className="kova-text" style={{ ...styles.text, whiteSpace: "pre-wrap" }}>
            {message}
          </Text>
        </Section>
        <Hr
          className="kova-divider"
          style={{ borderColor: brandColors.border, margin: "22px 0" }}
        />
        <Text className="kova-muted" style={{ ...styles.footerText, wordBreak: "break-all" }}>
          URL: {url || "—"}
        </Text>
        <Text className="kova-muted" style={{ ...styles.footerText, wordBreak: "break-all" }}>
          User agent: {userAgent || "—"}
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, unknown>) =>
    `${data.variant === "bug" ? "[Kova bug]" : "[Kova help]"} ${data.topic || "New request"}`,
  displayName: "Help / bug - internal notification",
  to: "support@kovagpt.com",
  previewData: {
    name: "Jane Doe",
    email: "jane@example.com",
    topic: "Issue with image generation",
    message: "Hi team, when I try to generate an image …",
    variant: "help",
    url: "https://kovagpt.com/",
    userAgent: "Mozilla/5.0",
  },
} satisfies TemplateEntry;
