import * as React from 'react'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from '@react-email/components'
import { BrandFooter, BrandHeader, styles } from './_brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your KovaGPT verification code</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <BrandHeader />
        <Heading style={styles.h1}>Confirm it's you</Heading>
        <Text style={styles.text}>
          Use the verification code below to confirm your identity in KovaGPT.
        </Text>
        <Text style={styles.code}>{token}</Text>
        <Text style={{ ...styles.text, fontSize: '13px', color: '#6b7280', margin: '0' }}>
          This code expires shortly. If you didn't request it, you can safely
          ignore this email.
        </Text>
        <BrandFooter />
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
