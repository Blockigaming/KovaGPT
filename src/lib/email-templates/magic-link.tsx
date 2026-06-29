import * as React from 'react'
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
} from '@react-email/components'
import { BrandFooter, BrandHeader, styles } from './_brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
}: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your sign-in link for {siteName}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Your sign-in link</Heading>
        <Text style={styles.text}>
          Click the button below to sign in to {siteName}. This link expires
          shortly and can only be used once.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button style={styles.button} href={confirmationUrl}>
            Sign in to KovaGPT
          </Button>
        </Section>
        <Text style={styles.fallbackLabel}>Button not working? Use this link:</Text>
        <Link href={confirmationUrl} style={styles.fallbackLink}>
          {confirmationUrl}
        </Link>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
