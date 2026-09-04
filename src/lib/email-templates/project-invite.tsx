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
  projectName?: string;
  inviterName?: string;
  role?: "editor" | "viewer";
  destinationUrl?: string;
}

const ProjectInviteEmail = ({
  projectName = "a KovaGPT project",
  inviterName = "A KovaGPT user",
  role = "editor",
  destinationUrl = "https://kovagpt.com/projects",
}: Props) => (
  <Html lang="en" dir="ltr">
    <EmailHead />
    <Preview>{inviterName} invited you to {projectName}</Preview>
    <Body className="kova-email-body" style={styles.main}>
      <Container className="kova-email-container" style={styles.container}>
        <BrandHeader />
        <Heading className="kova-heading" style={styles.h1}>
          You’re invited to a project
        </Heading>
        <Text className="kova-text" style={styles.text}>
          {inviterName} invited you to “{projectName}” as {role === "viewer" ? "a viewer" : "an editor"}.
        </Text>
        <Text className="kova-text" style={styles.text}>
          Sign in with this email address to review and accept the invitation.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button className="kova-button" style={styles.button} href={destinationUrl}>
            Review invitation
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
  component: ProjectInviteEmail,
  subject: (data: Record<string, unknown>) =>
    `Invitation to ${String(data.projectName || "a KovaGPT project").slice(0, 100)}`,
  displayName: "Project invitation",
  previewData: {
    projectName: "Product launch",
    inviterName: "Alex",
    role: "editor",
    destinationUrl: "https://kovagpt.com/projects",
  },
} satisfies TemplateEntry;
