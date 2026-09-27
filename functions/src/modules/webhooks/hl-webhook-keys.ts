/**
 * HighLevel webhook public key from the marketplace Webhook Integration Guide.
 * Ed25519 verifies `x-ghl-signature`. HighLevel stopped sending the legacy
 * RSA `x-wh-signature` header on 2026-09-01.
 * This is a public key. HighLevel announces rotations; update this constant then.
 */
export const HL_WEBHOOK_ED25519_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;
