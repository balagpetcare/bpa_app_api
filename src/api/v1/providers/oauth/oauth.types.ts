import type { AuthProvider } from "@prisma/client";

export type OAuthProviderKey = "GOOGLE" | "FACEBOOK";

export type VerifiedOAuthProfile = {
  provider: AuthProvider;
  providerKey: OAuthProviderKey;
  oauthSubject: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  pictureUrl: string | null;
};

export type OAuthTokenVerifier = {
  providerKey: OAuthProviderKey;
  verify(token: string): Promise<VerifiedOAuthProfile>;
};
