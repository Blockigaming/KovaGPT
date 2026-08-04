import * as React from "react";
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
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
    <Head />
    <Preview>
      {variant === "bug" ? "New bug report" : "New help request"} from {name}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={logoWrap}>
          <Img src={LOGO_URL} width="40" height="40" alt="KovaGPT" style={logoImg} />
        </Section>
        <Heading style={h1}>{variant === "bug" ? "🐞 Bug report" : "✉️ Help request"}</Heading>
        <Text style={meta}>
          From {name} &lt;{email}&gt;
        </Text>
        <Hr style={hr} />
        <Section>
          <Text style={label}>Topic</Text>
          <Text style={value}>{topic}</Text>
          <Text style={label}>Message</Text>
          <Text style={value}>{message}</Text>
        </Section>
        <Hr style={hr} />
        <Section>
          <Text style={small}>URL: {url || "-"}</Text>
          <Text style={small}>User agent: {userAgent || "-"}</Text>
        </Section>
      </Container>
    </Body>
  </Html>
);

export const template = {
  component: Email,
  subject: (data: Record<string, unknown>) =>
    `${data.variant === "bug" ? "[KovaGPT bug]" : "[KovaGPT help]"} ${data.topic || "New request"}`,
  displayName: "Help / bug - internal notification",
  to: "help@kovagpt.com",
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

const main = {
  backgroundColor: "#ffffff",
  fontFamily: "Inter, Arial, sans-serif",
  color: "#0a0a0a",
};
const container = { padding: "32px 28px", maxWidth: "560px" };
const h1 = { fontSize: "22px", margin: "0 0 8px 0", fontWeight: 600 };
const meta = { fontSize: "13px", color: "#525252", margin: "0 0 16px 0" };
const hr = { borderColor: "#e5e5e5", margin: "20px 0" };
const label = {
  fontSize: "11px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "#737373",
  margin: "12px 0 4px 0",
};
const value = { fontSize: "15px", margin: "0", lineHeight: "1.5", whiteSpace: "pre-wrap" as const };
const small = { fontSize: "12px", color: "#737373", margin: "4px 0" };
const logoWrap = { margin: "0 0 16px 0" };
const logoImg = { display: "block", borderRadius: "8px" };
