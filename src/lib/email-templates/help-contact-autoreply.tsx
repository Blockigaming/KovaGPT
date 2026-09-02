import * as React from "react";
import { Body, Container, Heading, Html, Preview, Section, Text } from "@react-email/components";
import { BrandFooter, BrandHeader, EmailHead, styles } from "./_brand";
import type { TemplateEntry } from "./registry";

interface Props {
  name?: string;
  topic?: string;
  variant?: "help" | "bug";
}

const Email = ({ name, topic, variant = "help" }: Props) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>We received your message and will get back to you soon.</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          Thanks{name ? `, ${name}` : ""}
        </Heading>
        <Text className="kova-text" style={styles.text}>
          We received your {variant === "bug" ? "bug report" : "message"}. Someone from Kova support
          will respond as soon as possible, usually within one business day.
        </Text>
        {topic ? (
          <Section className="kova-card" style={styles.card}>
            <Text className="kova-muted" style={styles.label}>
              Your topic
            </Text>
            <Text className="kova-text" style={{ ...styles.text, margin: 0 }}>
              {topic}
            </Text>
          </Section>
        ) : null}
        <Text className="kova-text" style={styles.text}>
          If there is anything else we should know, reply to this email and it will be added to your
          request.
        </Text>
        <Text
          className="kova-muted"
          style={{ ...styles.text, color: "#6e6e80", marginTop: "24px" }}
        >
          — Kova Support
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, unknown>) =>
    data.variant === "bug" ? "We received your Kova bug report" : "We received your Kova message",
  displayName: "Help / bug - auto-reply to user",
  previewData: {
    name: "Jane",
    topic: "Issue with image generation",
    variant: "help",
  },
} satisfies TemplateEntry;
