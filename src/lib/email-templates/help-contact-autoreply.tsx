import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { TemplateEntry } from "./registry";

const LOGO_URL = "https://kovagpt.com/kova-logo.png";

interface Props {
  name?: string;
  topic?: string;
  variant?: "help" | "bug";
}

const Email = ({ name, topic, variant = "help" }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Thanks for reaching out to KovaGPT - we'll get back to you soon.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoWrap}>
          <Img src={LOGO_URL} width="48" height="48" alt="KovaGPT" style={logoImg} />
        </Section>
        <Heading style={h1}>Thanks{name ? `, ${name}` : ""} 👋</Heading>
        <Text style={p}>
          We received your {variant === "bug" ? "bug report" : "message"} and someone from the
          KovaGPT team will get back to you as soon as possible - usually within one business day.
        </Text>
        {topic ? (
          <Section style={card}>
            <Text style={label}>You wrote about</Text>
            <Text style={value}>{topic}</Text>
          </Section>
        ) : null}
        <Text style={p}>
          If you remember anything else that might help us, just reply to this email and it will be
          attached to your ticket.
        </Text>
        <Text style={signoff}>- The KovaGPT team</Text>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, unknown>) =>
    data.variant === "bug"
      ? "We got your bug report - KovaGPT support"
      : "We got your message - KovaGPT support",
  displayName: "Help / bug - auto-reply to user",
  previewData: { name: "Jane", topic: "Issue with image generation", variant: "help" },
} satisfies TemplateEntry;

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Inter, Arial, sans-serif",
  color: "#0a0a0a",
};
const container = { padding: "40px 28px", maxWidth: "560px" };
const h1 = { fontSize: "22px", margin: "0 0 16px 0", fontWeight: 600 };
const p = { fontSize: "15px", lineHeight: "1.55", margin: "0 0 16px 0" };
const card = {
  backgroundColor: "#f5f5f5",
  borderRadius: "10px",
  padding: "14px 16px",
  margin: "8px 0 20px 0",
};
const label = {
  fontSize: "11px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#737373",
  margin: "0 0 4px 0",
};
const value = { fontSize: "14px", margin: "0" };
const signoff = { fontSize: "14px", color: "#525252", marginTop: "24px" };
const logoWrap = { margin: "0 0 20px 0" };
const logoImg = { display: "block", borderRadius: "10px" };
