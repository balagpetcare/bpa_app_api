import { OAuth2Client } from "google-auth-library";
import { AuthProvider } from "@prisma/client";
import type { OAuthTokenVerifier, VerifiedOAuthProfile } from "./oauth.types";

function getGoogleClientId(): string {
  return String(process.env.GOOGLE_CLIENT_ID || "").trim();
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(getGoogleClientId());
}

export const googleOAuthVerifier: OAuthTokenVerifier = {
  providerKey: "GOOGLE",

  async verify(idToken: string): Promise<VerifiedOAuthProfile> {
    const clientId = getGoogleClientId();
    if (!clientId) {
      throw new Error("GOOGLE_CLIENT_ID_MISSING");
    }

    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload) {
      throw new Error("INVALID_GOOGLE_TOKEN");
    }

    const sub = String(payload.sub || "").trim();
    const emailRaw = String(payload.email || "").trim().toLowerCase();
    if (!emailRaw || !sub) {
      throw new Error("GOOGLE_TOKEN_MISSING_EMAIL_OR_SUBJECT");
    }

    return {
      provider: AuthProvider.GOOGLE,
      providerKey: "GOOGLE",
      oauthSubject: sub,
      email: emailRaw,
      emailVerified: Boolean(payload.email_verified),
      displayName: payload.name ? String(payload.name).trim() : null,
      pictureUrl: payload.picture ? String(payload.picture).trim() : null,
    };
  },
};
